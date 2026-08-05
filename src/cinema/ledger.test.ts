// The generation ledger.
//
// Tested against a fake fetch rather than a live Clickhouse: what matters here
// is that the SQL is well-formed, that a failed write does not take a render
// down with it, and that a prompt containing a quote cannot break the insert.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createClickhouseLedger,
	type LedgerRow,
	pendingCount,
	resetPending,
	SCHEMA,
} from "./ledger";

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
	at: "2026-01-01 00:00:00.000",
	graphId: "g1",
	nodeId: "n1",
	nodeKind: "character",
	model: "gemini-3.1-flash-image",
	prompt: "a dock worker",
	elapsedMs: 1200,
	ok: true,
	...over,
});

function ledgerWith(handler: (body: string) => { ok: boolean; text: string }) {
	const sent: string[] = [];
	global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
		const body = init?.body ?? "";
		sent.push(body);
		const result = handler(body);
		return {
			ok: result.ok,
			status: result.ok ? 200 : 500,
			text: async () => result.text,
		} as Response;
	}) as never;
	return { ledger: createClickhouseLedger({ url: "http://ch", user: "u", password: "p" }), sent };
}

beforeEach(() => resetPending());

describe("schema", () => {
	it("orders by graph then time, which is how every query scopes", () => {
		expect(SCHEMA).toContain("ORDER BY (graph_id, at)");
	});

	it("keeps accepted nullable, because unreviewed is not rejected", () => {
		// Folding "not yet judged" into false would make the prompt leaderboard
		// count every unreviewed take as a failure.
		expect(SCHEMA).toContain("accepted    Nullable(UInt8)");
	});
});

describe("record", () => {
	it("writes an insert", async () => {
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.record(row());
		expect(sent[0]).toContain("INSERT INTO generations");
		expect(sent[0]).toContain("'a dock worker'");
	});

	it("escapes a quote in the prompt rather than breaking the statement", async () => {
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.record(row({ prompt: "it's a wrap" }));
		expect(sent[0]).toContain("it\\'s a wrap");
	});

	it("writes failures too", async () => {
		// A ledger of only successes cannot answer "why does this keep getting
		// blocked", which is most of what it is for.
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.record(row({ ok: false, errorKind: "safety", error: "blocked" }));
		expect(sent[0]).toContain("'safety'");
	});

	it("holds a failed write instead of losing it", async () => {
		let fail = true;
		const { ledger, sent } = ledgerWith(() =>
			fail ? { ok: false, text: "down" } : { ok: true, text: "" },
		);
		await expect(ledger.record(row({ nodeId: "first" }))).rejects.toThrow();
		expect(pendingCount()).toBe(1);

		fail = false;
		await ledger.record(row({ nodeId: "second" }));
		// Both rows go in the retry, so a blip does not lose history.
		expect(sent[1]).toContain("first");
		expect(sent[1]).toContain("second");
		expect(pendingCount()).toBe(0);
	});

	it("writes NULL for an absent seed rather than a string", async () => {
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.record(row({ seed: undefined }));
		expect(sent[0]).toContain("NULL");
	});
});

describe("queries", () => {
	it("scopes takes to one node, newest first", async () => {
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.takesFor("g1", "n1");
		expect(sent[0]).toContain("graph_id = 'g1'");
		expect(sent[0]).toContain("node_id = 'n1'");
		expect(sent[0]).toContain("ORDER BY at DESC");
	});

	it("reads rows back", async () => {
		const { ledger } = ledgerWith(() => ({
			ok: true,
			text: JSON.stringify({
				at: "2026-01-01 00:00:00.000",
				graph_id: "g1",
				node_id: "n1",
				node_kind: "scene",
				model: "m",
				prompt: "p",
				seed: null,
				elapsed_ms: 900,
				ok: 1,
				error_kind: "",
				error: "",
				accepted: null,
				cost_usd: null,
			}),
		}));
		const rows = await ledger.takesFor("g1", "n1");
		expect(rows[0].nodeKind).toBe("scene");
		expect(rows[0].seed).toBeUndefined();
		expect(rows[0].accepted).toBeUndefined();
	});

	it("totals spend for the auto-mode ceiling", async () => {
		const { ledger } = ledgerWith(() => ({
			ok: true,
			text: JSON.stringify({ calls: 12, cost: 0.44 }),
		}));
		expect(await ledger.spentOn("g1")).toEqual({ calls: 12, costUsd: 0.44 });
	});

	it("reports nothing spent on a film with no rows", async () => {
		const { ledger } = ledgerWith(() => ({ ok: true, text: "" }));
		expect(await ledger.spentOn("g1")).toEqual({ calls: 0, costUsd: 0 });
	});
});
