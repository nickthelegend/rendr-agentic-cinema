// The palette's ranking.
//
// The bar is that typing a few letters puts the thing you meant at the top. A
// palette that merely *contains* the answer somewhere in a list of forty is
// slower than the toolbar it replaces.

import { describe, expect, it } from "vitest";

import { type Command, rank } from "./commands";

const command = (name: string, group = "Film", keywords?: string): Command => ({
	id: name,
	name,
	group,
	keywords,
	run: () => {},
});

const all = (): Command[] => [
	command("Render"),
	command("Render and place on the timeline"),
	command("New Short film"),
	command("New Documentary"),
	command("Tidy the graph", "Canvas"),
	command("Shot list", "Export", "csv spreadsheet"),
	command("Consistency", "Report", "cast faces"),
];

describe("rank", () => {
	it("returns everything for an empty query", () => {
		expect(rank(all(), "  ")).toHaveLength(7);
	});

	it("puts an exact prefix first", () => {
		expect(rank(all(), "render")[0].name).toBe("Render");
	});

	it("prefers the shorter name on a tie", () => {
		// "Render" should beat "Render and place on the timeline".
		const out = rank(all(), "render").map((c) => c.name);
		expect(out[0]).toBe("Render");
		expect(out[1]).toBe("Render and place on the timeline");
	});

	it("matches a scattered subsequence", () => {
		// "nsf" is how somebody types "New Short film" in a hurry.
		expect(rank(all(), "nsf").map((c) => c.name)).toContain("New Short film");
	});

	it("does not match letters the entry does not contain", () => {
		// "New Short film" has no c in it, and a palette that matches anyway is
		// one that matches everything.
		expect(rank(all(), "nsc").map((c) => c.name)).not.toContain("New Short film");
	});

	it("matches hidden keywords without showing them", () => {
		expect(rank(all(), "csv")[0].name).toBe("Shot list");
	});

	it("matches the group", () => {
		expect(rank(all(), "canvas")[0].name).toBe("Tidy the graph");
	});

	it("drops what does not match at all", () => {
		expect(rank(all(), "zzzz")).toEqual([]);
	});

	it("is case-insensitive", () => {
		expect(rank(all(), "TIDY")[0].name).toBe("Tidy the graph");
	});

	it("ranks a name match above a keyword match", () => {
		const out = rank(all(), "cast");
		expect(out[0].name).toBe("Consistency");
	});
});
