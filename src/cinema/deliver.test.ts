// Getting the film out.
//
// The CSV escaping gets the most attention here because dialogue is exactly the
// data that breaks naive CSV — it contains commas, quotes and newlines as a
// matter of course, and a shot list that corrupts on a line of speech is worse
// than no shot list at all.

import { describe, expect, it } from "vitest";

import {
	csv,
	csvField,
	exportFilm,
	failureBreakdown,
	importFilm,
	ledgerCsv,
	shotListCsv,
	summarise,
	timecode,
} from "./deliver";
import type { LedgerRow } from "./ledger";
import type { CinemaGraph, SceneSpec } from "./nodes";

const graph = (): CinemaGraph => ({
	id: "g1",
	name: "The Missed Train",
	auto: false,
	nodes: [
		{
			id: "c1",
			kind: "character",
			label: "Lead",
			text: "a dock worker",
			x: 0,
			y: 0,
			params: {},
			status: "ready",
		},
		{ id: "w1", kind: "world", text: "a port town", x: 10, y: 10, params: {}, status: "ready" },
	],
	edges: [{ id: "e1", from: "c1", to: "w1" }],
});

const scenes = (): SceneSpec[] => [
	{
		id: "s0",
		index: 0,
		characterIds: [],
		location: "a platform",
		timeOfDay: "night",
		camera: "wide establishing",
		action: "the platform empties",
		durationSeconds: 4,
	},
	{
		id: "s1",
		index: 1,
		characterIds: ["c1"],
		location: "a platform",
		timeOfDay: "night",
		camera: "close",
		action: "she reads the board",
		dialogue: 'She said, "wait" — and then, nothing.',
		durationSeconds: 3.5,
	},
];

describe("csvField", () => {
	it("leaves an ordinary value alone", () => {
		expect(csvField("wide establishing")).toBe("wide establishing");
		expect(csvField(4)).toBe("4");
	});

	it("writes an empty cell for nothing", () => {
		expect(csvField(undefined)).toBe("");
		expect(csvField(null)).toBe("");
	});

	it("quotes a value containing a comma", () => {
		expect(csvField("wide, static")).toBe('"wide, static"');
	});

	it("doubles an embedded quote", () => {
		expect(csvField('She said "wait"')).toBe('"She said ""wait"""');
	});

	it("quotes a value containing a newline", () => {
		expect(csvField("line one\nline two")).toBe('"line one\nline two"');
	});
});

describe("csv", () => {
	it("joins rows with CRLF, which is what spreadsheets expect", () => {
		expect(csv([["a", "b"], ["c"]])).toBe("a,b\r\nc");
	});
});

describe("timecode", () => {
	it("writes hh:mm:ss:ff", () => {
		expect(timecode(0)).toBe("00:00:00:00");
		expect(timecode(1.5, 30)).toBe("00:00:01:15");
		expect(timecode(61, 30)).toBe("00:01:01:00");
		expect(timecode(3661, 30)).toBe("01:01:01:00");
	});

	it("honours the project frame rate", () => {
		// The same instant is a different frame count at a different fps, and
		// getting this wrong drifts a shot list against the timeline it describes.
		expect(timecode(1.5, 60)).toBe("00:00:01:30");
		expect(timecode(1, 24)).toBe("00:00:01:00");
	});

	it("never writes a negative timecode", () => {
		expect(timecode(-5)).toBe("00:00:00:00");
	});
});

describe("shotListCsv", () => {
	it("has a header and one row per shot", () => {
		const lines = shotListCsv(graph(), scenes()).split("\r\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("Timecode in");
	});

	it("survives dialogue containing a comma and a quote", () => {
		// The exact data that breaks a naive shot list.
		const out = shotListCsv(graph(), scenes());
		expect(out).toContain('"She said, ""wait"" — and then, nothing."');
	});

	it("accumulates the timecode across shots", () => {
		const rows = shotListCsv(graph(), scenes()).split("\r\n");
		expect(rows[1]).toContain("00:00:00:00");
		// The second shot starts where the first ended: 4s in.
		expect(rows[2]).toContain("00:00:04:00");
	});

	it("names the cast rather than printing node ids", () => {
		expect(shotListCsv(graph(), scenes())).toContain("Lead");
	});

	it("orders by the story's index, not the order it was handed", () => {
		const backwards = [...scenes()].reverse();
		const rows = shotListCsv(graph(), backwards).split("\r\n");
		expect(rows[1]).toMatch(/^1,/);
		expect(rows[2]).toMatch(/^2,/);
	});
});

describe("failureBreakdown", () => {
	const row = (over: Partial<LedgerRow>): LedgerRow => ({
		at: "2026-01-01 00:00:00.000",
		graphId: "g1",
		nodeId: "n1",
		nodeKind: "scene",
		model: "m",
		prompt: "p",
		elapsedMs: 10,
		ok: true,
		...over,
	});

	it("ignores the calls that worked", () => {
		expect(failureBreakdown([row({ ok: true })])).toEqual([]);
	});

	it("groups by kind, commonest first", () => {
		// "eleven safety blocks" and "eleven quota errors" need completely
		// different responses; a flat list makes them look the same.
		const out = failureBreakdown([
			row({ ok: false, errorKind: "safety" }),
			row({ ok: false, errorKind: "quota" }),
			row({ ok: false, errorKind: "safety" }),
		]);
		expect(out).toEqual([
			{ kind: "safety", count: 2 },
			{ kind: "quota", count: 1 },
		]);
	});

	it("calls an unclassified failure unknown rather than dropping it", () => {
		expect(failureBreakdown([row({ ok: false })])).toEqual([{ kind: "unknown", count: 1 }]);
	});
});

describe("ledgerCsv", () => {
	it("writes a header even with no rows", () => {
		expect(ledgerCsv([])).toContain("Prompt");
	});

	it("distinguishes unjudged from discarded", () => {
		// Blank and "discarded" are different facts, and folding them together
		// is exactly the mistake the nullable column exists to prevent.
		const base: LedgerRow = {
			at: "2026-01-01 00:00:00.000",
			graphId: "g1",
			nodeId: "n1",
			nodeKind: "scene",
			model: "m",
			prompt: "p",
			elapsedMs: 10,
			ok: true,
		};
		const out = ledgerCsv([base, { ...base, accepted: false }, { ...base, accepted: true }]);
		const cells = out
			.split("\r\n")
			.slice(1)
			.map((line) => line.split(",").pop());
		expect(cells).toEqual(["", "discarded", "kept"]);
	});
});

describe("summarise", () => {
	it("reads the film back in one line", () => {
		expect(summarise(graph(), scenes())).toEqual({
			name: "The Missed Train",
			shots: 2,
			runtimeSeconds: 7.5,
			cast: ["Lead"],
			locations: ["a platform"],
		});
	});

	it("keeps locations in the order the film visits them", () => {
		// A route, not an index. Sorting them would throw the journey away.
		const travelling = [
			{ ...scenes()[0], location: "the coast" },
			{ ...scenes()[1], location: "a platform" },
		];
		expect(summarise(graph(), travelling).locations).toEqual(["the coast", "a platform"]);
	});
});

describe("export and import", () => {
	it("round-trips a film", () => {
		const out = importFilm(exportFilm(graph()), "g2");
		expect(out.error).toBeUndefined();
		expect(out.graph?.name).toBe("The Missed Train");
		expect(out.graph?.nodes).toHaveLength(2);
		expect(out.graph?.edges).toHaveLength(1);
	});

	it("carries no image bytes", () => {
		// A film someone sends is the decisions. Carrying stills turns a 20 KB
		// document into 40 MB of pictures that get regenerated anyway.
		const withUpload = graph();
		withUpload.nodes[0].params = { image: { base64: "AAAA", mimeType: "image/png" } };
		expect(exportFilm(withUpload)).not.toContain("AAAA");
	});

	it("arrives unrendered, so nothing claims a cast it never generated", () => {
		const out = importFilm(exportFilm(graph()), "g2");
		expect(out.graph?.nodes.every((node) => node.status === "idle")).toBe(true);
	});

	it("drops an edge whose node did not survive", () => {
		const json = JSON.stringify({
			format: "rendr-cinema/1",
			name: "Broken",
			nodes: [{ id: "a", kind: "world" }],
			edges: [{ from: "a", to: "ghost" }],
		});
		expect(importFilm(json, "g3").graph?.edges).toEqual([]);
	});

	it("explains a file that is not JSON", () => {
		expect(importFilm("not json at all", "g4").error).toMatch(/not JSON/);
	});

	it("refuses a format it does not know", () => {
		expect(importFilm(JSON.stringify({ format: "other/9" }), "g4").error).toMatch(
			/Unknown format/,
		);
	});

	it("refuses a film with no nodes", () => {
		const json = JSON.stringify({ format: "rendr-cinema/1", nodes: [] });
		expect(importFilm(json, "g4").error).toMatch(/no nodes/);
	});
});
