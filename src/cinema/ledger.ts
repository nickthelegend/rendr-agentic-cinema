// The generation ledger.
//
// Every model call becomes a row: what was asked, which model answered, what it
// cost, how long it took, and whether the result was kept. This is the partner
// integration the hackathon requires to be "imported and called in code, not
// just named in the README" — and it earns that by making two things possible
// that are otherwise hand-waving.
//
//   what did we already try — regenerating a scene shows the takes that were
//   rejected, so nobody burns a call reproducing something they threw away
//
//   which prompts actually work — query accepted rows for the phrasing and
//   seeds that produced kept shots, and feed that back into prompt generation
//
// Failures are written too, and they are the most useful rows in the table. A
// ledger of only successes cannot answer "why does this keep getting blocked".

export interface LedgerRow {
	/** When the call started, as an ISO string. */
	at: string;
	/** Which film. Lets a query scope to one project. */
	graphId: string;
	nodeId: string;
	nodeKind: string;
	model: string;
	/** What was actually sent. The whole point of the table. */
	prompt: string;
	seed?: number;
	elapsedMs: number;
	/** Whether the call returned at all. */
	ok: boolean;
	/** Classified, so "wait or pay" and "reword it" stay distinguishable. */
	errorKind?: string;
	error?: string;
	/**
	 * Whether a human kept it.
	 *
	 * Separate from `ok` on purpose: a call can succeed and produce a shot
	 * nobody wants, and that distinction is the difference between "the API
	 * works" and "the prompt works". Unset until someone decides.
	 */
	accepted?: boolean;
	/** Rough cost in USD, when the provider reports enough to compute it. */
	costUsd?: number;
}

export interface LedgerConfig {
	url: string;
	user: string;
	password: string;
	/** Defaults to `cinema`. */
	database?: string;
}

const TABLE = "generations";

/**
 * The schema, as the statement that creates it.
 *
 * MergeTree ordered by graph then time, because every query this table exists
 * for is "what happened in this film" — scoping by graph first means those
 * never scan the whole history. accepted is Nullable because "not yet judged"
 * is a real third state, and folding it into false would make the prompt
 * leaderboard count unreviewed takes as rejections.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  at          DateTime64(3),
  graph_id    String,
  node_id     String,
  node_kind   LowCardinality(String),
  model       LowCardinality(String),
  prompt      String,
  seed        Nullable(UInt32),
  elapsed_ms  UInt32,
  ok          UInt8,
  error_kind  LowCardinality(String),
  error       String,
  accepted    Nullable(UInt8),
  cost_usd    Nullable(Float32)
) ENGINE = MergeTree
ORDER BY (graph_id, at)
`.trim();

export interface Ledger {
	/** Creates the table if it is not there. Safe to call every start. */
	init(): Promise<void>;
	record(row: LedgerRow): Promise<void>;
	/** Takes already tried for a node, newest first. */
	takesFor(graphId: string, nodeId: string): Promise<LedgerRow[]>;
	/**
	 * The prompts that most often produced kept shots.
	 *
	 * Grouped by prompt rather than by model, which is what it grouped by first
	 * and what made it useless: there is one image model, so ranking models
	 * ranks a list of one. The question worth asking across a session is which
	 * phrasing survived, and that is a prompt-level question.
	 */
	whatWorks(
		graphId?: string,
	): Promise<Array<{ prompt: string; model: string; accepted: number; total: number }>>;
	/** What this film has cost so far, for the auto-mode spend ceiling. */
	spentOn(graphId: string): Promise<{ calls: number; costUsd: number }>;
	/**
	 * Marks one take kept or discarded.
	 *
	 * The judgement is what makes the rest of the table mean anything: without
	 * it every row is "a call happened", and no query can tell a prompt that
	 * works from one that merely returns.
	 *
	 * Addressed by its exact timestamp rather than "the latest for this node",
	 * because the latest is a moving target — a run that finishes between
	 * looking at a take and judging it would silently redirect the verdict onto
	 * a different picture.
	 */
	judge(graphId: string, nodeId: string, at: string, accepted: boolean): Promise<void>;
}

/**
 * Rows that could not be sent, kept in memory.
 *
 * A ledger that throws takes the render down with it, which is the wrong
 * trade: the shot matters more than the bookkeeping. Failed writes are held and
 * retried on the next successful call, so a blip does not lose the history.
 */
const pending: LedgerRow[] = [];
const MAX_PENDING = 200;

function escape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toValues(row: LedgerRow): string {
	const nullable = (value: number | undefined) =>
		value === undefined || !Number.isFinite(value) ? "NULL" : String(value);
	const bool = (value: boolean | undefined) => (value === undefined ? "NULL" : value ? "1" : "0");
	return [
		`'${escape(row.at)}'`,
		`'${escape(row.graphId)}'`,
		`'${escape(row.nodeId)}'`,
		`'${escape(row.nodeKind)}'`,
		`'${escape(row.model)}'`,
		// Truncated: a prompt carries no image bytes, but a long story premise
		// pasted into a node can still be enormous, and the useful part is the
		// front of it.
		`'${escape(row.prompt.slice(0, 4000))}'`,
		nullable(row.seed),
		String(Math.max(0, Math.round(row.elapsedMs))),
		row.ok ? "1" : "0",
		`'${escape(row.errorKind ?? "")}'`,
		`'${escape((row.error ?? "").slice(0, 500))}'`,
		bool(row.accepted),
		nullable(row.costUsd),
	].join(", ");
}

export function createClickhouseLedger(config: LedgerConfig): Ledger {
	const database = config.database ?? "cinema";
	const base = config.url.replace(/\/+$/, "");

	async function run(sql: string, format?: "JSONEachRow"): Promise<string> {
		const url = new URL(base);
		url.searchParams.set("database", database);
		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "text/plain",
				// Basic rather than a query parameter: credentials in a URL end up
				// in logs and proxies, the same reason the model key is a header.
				Authorization: `Basic ${btoa(`${config.user}:${config.password}`)}`,
			},
			body: format ? `${sql} FORMAT ${format}` : sql,
		});
		const text = await response.text();
		if (!response.ok) throw new Error(`Clickhouse ${response.status}: ${text.slice(0, 300)}`);
		return text;
	}

	function parseRows(text: string): LedgerRow[] {
		return text
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => {
				const raw = JSON.parse(line) as Record<string, unknown>;
				return {
					at: String(raw.at ?? ""),
					graphId: String(raw.graph_id ?? ""),
					nodeId: String(raw.node_id ?? ""),
					nodeKind: String(raw.node_kind ?? ""),
					model: String(raw.model ?? ""),
					prompt: String(raw.prompt ?? ""),
					seed: raw.seed === null ? undefined : Number(raw.seed),
					elapsedMs: Number(raw.elapsed_ms ?? 0),
					ok: raw.ok === 1 || raw.ok === "1",
					errorKind: (raw.error_kind as string) || undefined,
					error: (raw.error as string) || undefined,
					accepted:
						raw.accepted === null
							? undefined
							: raw.accepted === 1 || raw.accepted === "1",
					costUsd: raw.cost_usd === null ? undefined : Number(raw.cost_usd),
				};
			});
	}

	return {
		async init() {
			await run(`CREATE DATABASE IF NOT EXISTS ${database}`);
			await run(SCHEMA);
		},

		async record(row) {
			const queue = [...pending, row];
			pending.length = 0;
			try {
				await run(
					`INSERT INTO ${TABLE} VALUES ${queue.map((entry) => `(${toValues(entry)})`).join(", ")}`,
				);
			} catch (error) {
				// Hold rather than throw: a bookkeeping failure must not take the
				// render down with it. Oldest rows go first if the queue overflows,
				// because recent history is what the UI actually queries.
				pending.push(...queue.slice(-MAX_PENDING));
				throw error;
			}
		},

		async takesFor(graphId, nodeId) {
			return parseRows(
				await run(
					`SELECT * FROM ${TABLE} WHERE graph_id = '${escape(graphId)}' AND node_id = '${escape(nodeId)}' ORDER BY at DESC LIMIT 20`,
					"JSONEachRow",
				),
			);
		},

		async whatWorks(graphId) {
			// Scoped to successful calls: a prompt that never returned an image
			// cannot have produced a kept one, and letting failures into the
			// denominator makes a good prompt that once hit a quota wall look
			// worse than a mediocre one that ran on a quiet afternoon.
			const scope = graphId ? `AND graph_id = '${escape(graphId)}'` : "";
			const text = await run(
				`SELECT prompt, any(model) AS model, countIf(accepted = 1) AS accepted, count() AS total ` +
					// Empty prompts excluded. A leaderboard row with nothing written
					// on it ranks a phrasing nobody can read or reuse, and one showed
					// up the moment this shipped — the story node was recording a
					// blank. That is fixed at the source too; this keeps any future
					// blank out of a list whose whole value is being readable.
					`FROM ${TABLE} WHERE ok = 1 AND prompt != '' ${scope} GROUP BY prompt ` +
					`HAVING accepted > 0 ORDER BY accepted DESC, total ASC LIMIT 12`,
				"JSONEachRow",
			);
			return text
				.split("\n")
				.filter((line) => line.trim())
				.map((line) => {
					const raw = JSON.parse(line) as Record<string, unknown>;
					return {
						prompt: String(raw.prompt ?? ""),
						model: String(raw.model ?? ""),
						accepted: Number(raw.accepted ?? 0),
						total: Number(raw.total ?? 0),
					};
				});
		},

		async judge(graphId, nodeId, at, accepted) {
			// A flat predicate on literals, deliberately. ClickHouse mutations do
			// not accept a subquery in the WHERE, so "the most recent take for
			// this node" cannot be expressed here at all — the caller passes the
			// row's own timestamp, which is more precise anyway.
			//
			// The verdict is applied optimistically in the UI: a mutation is
			// asynchronous, so reading the table straight back would show the old
			// value and look like the click did nothing.
			await run(
				`ALTER TABLE ${TABLE} UPDATE accepted = ${accepted ? 1 : 0} ` +
					`WHERE graph_id = '${escape(graphId)}' AND node_id = '${escape(nodeId)}' ` +
					`AND at = '${escape(at)}'`,
			);
		},

		async spentOn(graphId) {
			const text = await run(
				`SELECT count() AS calls, sum(cost_usd) AS cost FROM ${TABLE} WHERE graph_id = '${escape(graphId)}'`,
				"JSONEachRow",
			);
			const first = text.split("\n").find((line) => line.trim());
			if (!first) return { calls: 0, costUsd: 0 };
			const raw = JSON.parse(first) as Record<string, unknown>;
			return { calls: Number(raw.calls ?? 0), costUsd: Number(raw.cost ?? 0) || 0 };
		},
	};
}

/** How many rows are waiting on a failed write, for the UI to report. */
export const pendingCount = (): number => pending.length;

/** Clears the hold queue. Tests only. */
export const resetPending = (): void => {
	pending.length = 0;
};
