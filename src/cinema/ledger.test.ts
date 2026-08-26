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

describe("judge", () => {
	it("addresses one row by its exact timestamp", async () => {
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.judge("g1", "n1", "2026-08-06 11:02:03.400", true);
		expect(sent[0]).toContain("UPDATE accepted = 1");
		expect(sent[0]).toContain("node_id = 'n1'");
		expect(sent[0]).toContain("at = '2026-08-06 11:02:03.400'");
	});

	it("never uses a subquery, which mutations reject", async () => {
		// The predicate has to be flat literals. ClickHouse refuses a SELECT
		// inside an ALTER ... UPDATE, so "the newest take for this node" cannot be
		// expressed here at all — a version that reads well and throws on a real
		// server is worse than none.
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.judge("g1", "n1", "2026-08-06 11:02:03.400", false);
		expect(sent[0]).not.toContain("SELECT");
		expect(sent[0]).toContain("UPDATE accepted = 0");
	});

	it("escapes a graph id containing a quote", async () => {
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.judge("o'brien", "n1", "2026-08-06 11:02:03.400", true);
		expect(sent[0]).toContain("graph_id = 'o\\'brien'");
	});

	it("a verdict that fails to save rejects, so the UI can revert it", async () => {
		const { ledger } = ledgerWith(() => ({ ok: false, text: "read only" }));
		await expect(ledger.judge("g1", "n1", "2026-08-06 11:02:03.400", true)).rejects.toThrow(
			/500/,
		);
	});
});

describe("whatWorks", () => {
	// This query had no test at all, which is how it survived being wrong: it
	// grouped by model, and there is one image model, so the "prompt
	// leaderboard" was a ranked list of length one that never mentioned a
	// prompt.
	it("ranks prompts, not models", async () => {
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.whatWorks("g1");
		expect(sent[0]).toContain("GROUP BY prompt");
		expect(sent[0]).not.toContain("GROUP BY model");
	});

	it("counts only calls that returned", async () => {
		// A prompt that never produced an image cannot have produced a kept one,
		// and letting failures into the denominator makes a good prompt that once
		// hit a quota wall score worse than a mediocre one that ran on a quiet
		// afternoon.
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.whatWorks("g1");
		expect(sent[0]).toContain("ok = 1");
		expect(sent[0]).toContain("HAVING accepted > 0");
	});

	it("scopes to one film when asked, and across films when not", async () => {
		const { ledger, sent } = ledgerWith(() => ({ ok: true, text: "" }));
		await ledger.whatWorks("g1");
		await ledger.whatWorks();
		expect(sent[0]).toContain("graph_id = 'g1'");
		expect(sent[1]).not.toContain("graph_id");
	});

	it("reads the rows back", async () => {
		const { ledger } = ledgerWith(() => ({
			ok: true,
			text: [
				JSON.stringify({
					prompt: "wide establishing, static",
					model: "gemini-3.1-flash-image",
					accepted: 3,
					total: 4,
				}),
				JSON.stringify({ prompt: "close on hands", model: "x", accepted: 1, total: 1 }),
			].join("\n"),
		}));
		const rows = await ledger.whatWorks("g1");
		expect(rows).toHaveLength(2);
		expect(rows[0].prompt).toBe("wide establishing, static");
		expect(rows[0].accepted).toBe(3);
		expect(rows[0].total).toBe(4);
	});
});

describe("spentOn", () => {
	it("reports zero for a film that has run nothing", async () => {
		// The auto-mode spend ceiling reads this. A film with no rows must come
		// back as zero rather than NaN, or the first comparison against a budget
		// is false and the guard opens.
		const { ledger } = ledgerWith(() => ({ ok: true, text: "" }));
		expect(await ledger.spentOn("g1")).toEqual({ calls: 0, costUsd: 0 });
	});

	it("treats a null cost sum as zero", async () => {
		// Clickhouse returns NULL for sum() over no non-null values, and
		// Number(null) is 0 but Number(undefined) is NaN — worth pinning, because
		// a NaN ceiling compares false against everything.
		const { ledger } = ledgerWith(() => ({
			ok: true,
			text: JSON.stringify({ calls: 5, cost: null }),
		}));
		expect(await ledger.spentOn("g1")).toEqual({ calls: 5, costUsd: 0 });
	});
});

describe("where statements are sent", () => {
	it("uses an absolute Clickhouse URL as given", async () => {
		let seen = "";
		global.fetch = vi.fn(async (url: unknown) => {
			seen = String(url);
			return { ok: true, status: 200, text: async () => "" } as Response;
		}) as never;
		await createClickhouseLedger({ url: "http://ch:8123", user: "u", password: "p" }).init();
		expect(seen).toContain("http://ch:8123");
		expect(seen).toContain("database=cinema");
	});

	it("resolves a same-origin path against the page", async () => {
		// The hosted build points at its own server, which holds the credential.
		// `new URL("/ch")` throws without a base, so this is worth pinning.
		let seen = "";
		global.fetch = vi.fn(async (url: unknown) => {
			seen = String(url);
			return { ok: true, status: 200, text: async () => "" } as Response;
		}) as never;
		await createClickhouseLedger({ url: "/ch" }).init();
		expect(seen).toMatch(/^https?:\/\/[^/]+\/ch\?database=cinema$/);
	});

	it("sends no Authorization header when a proxy holds the credential", async () => {
		let headers: Record<string, string> = {};
		global.fetch = vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
			headers = init?.headers ?? {};
			return { ok: true, status: 200, text: async () => "" } as Response;
		}) as never;
		await createClickhouseLedger({ url: "/ch" }).init();
		expect(headers.Authorization).toBeUndefined();
	});

	it("still sends one when given a user", async () => {
		let headers: Record<string, string> = {};
		global.fetch = vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
			headers = init?.headers ?? {};
			return { ok: true, status: 200, text: async () => "" } as Response;
		}) as never;
		await createClickhouseLedger({ url: "http://ch", user: "u", password: "p" }).init();
		expect(headers.Authorization).toMatch(/^Basic /);
	});
});
