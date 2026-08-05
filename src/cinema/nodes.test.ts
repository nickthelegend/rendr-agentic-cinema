// The graph's rules. These are mostly about what it refuses, because a node
// editor that silently drops a connection is worse than one that says no.

import { describe, expect, it } from "vitest";

import {
	ancestors,
	type CinemaGraph,
	type CinemaNode,
	connectionError,
	descendants,
	graphIssues,
	runOrder,
} from "./nodes";

const node = (id: string, kind: CinemaNode["kind"]): CinemaNode => ({
	id,
	kind,
	x: 0,
	y: 0,
	params: {},
	status: "idle",
});

const graph = (nodes: CinemaNode[], edges: Array<[string, string]> = []): CinemaGraph => ({
	id: "g",
	name: "Test",
	auto: false,
	nodes,
	edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to })),
});

describe("connecting", () => {
	it("lets a reference feed a character", () => {
		const g = graph([node("r", "reference"), node("c", "character")]);
		expect(connectionError(g, "r", "c")).toBeNull();
	});

	it("refuses a kind the target does not take, and names what it does", () => {
		const g = graph([node("s", "scene"), node("c", "character")]);
		const why = connectionError(g, "s", "c");
		expect(why).toContain("Reference");
	});

	it("refuses a self-connection", () => {
		const g = graph([node("c", "character")]);
		expect(connectionError(g, "c", "c")).toContain("feed itself");
	});

	it("refuses anything out of the timeline, which is terminal", () => {
		const g = graph([node("t", "timeline"), node("s", "scene")]);
		expect(connectionError(g, "t", "s")).toContain("terminal");
	});

	it("refuses feeding a node that takes no input", () => {
		const g = graph([node("t", "trait"), node("r", "reference")]);
		expect(connectionError(g, "t", "r")).toContain("no input");
	});

	it("refuses a duplicate wire", () => {
		const g = graph([node("r", "reference"), node("c", "character")], [["r", "c"]]);
		expect(connectionError(g, "r", "c")).toContain("Already connected");
	});

	it("refuses a loop", () => {
		// character → story → scene, then scene back to character.
		const g = graph(
			[node("c", "character"), node("st", "story"), node("sc", "scene")],
			[
				["c", "st"],
				["st", "sc"],
			],
		);
		// scene cannot feed character anyway, so check the cycle guard directly
		// on a pair that is otherwise legal: story → scene exists, scene → story.
		expect(connectionError(g, "sc", "st")).toBeTruthy();
	});
});

describe("run order", () => {
	it("puts a character before the scene that references it", () => {
		const g = graph(
			[node("c", "character"), node("sc", "scene"), node("t", "timeline")],
			[
				["c", "sc"],
				["sc", "t"],
			],
		);
		const order = runOrder(g)?.map((n) => n.id);
		expect(order?.indexOf("c")).toBeLessThan(order?.indexOf("sc") ?? -1);
		expect(order?.[order.length - 1]).toBe("t");
	});

	it("returns null on a loop", () => {
		const g: CinemaGraph = {
			...graph([node("a", "character"), node("b", "story")]),
			edges: [
				{ id: "1", from: "a", to: "b" },
				{ id: "2", from: "b", to: "a" },
			],
		};
		expect(runOrder(g)).toBeNull();
	});
});

describe("ancestors", () => {
	it("collects every character upstream of a scene", () => {
		// This is the binding the whole graph exists for: a scene has to know
		// which sheets to pass as image context, however far back they are.
		const g = graph(
			[
				node("ref", "reference"),
				node("c1", "character"),
				node("c2", "character"),
				node("st", "story"),
				node("sc", "scene"),
			],
			[
				["ref", "c1"],
				["c1", "st"],
				["c2", "st"],
				["st", "sc"],
			],
		);
		const found = ancestors(g, "sc")
			.filter((n) => n.kind === "character")
			.map((n) => n.id)
			.sort();
		expect(found).toEqual(["c1", "c2"]);
	});
});

describe("descendants", () => {
	it("names everything an edit invalidates", () => {
		// Changing a look does not only make the character stale — every scene
		// they appear in is wrong too, and leaving those looking fresh is how a
		// graph stops being trustworthy.
		const g = graph(
			[node("l", "look"), node("c", "character"), node("sc", "scene"), node("t", "timeline")],
			[
				["l", "c"],
				["c", "sc"],
				["sc", "t"],
			],
		);
		expect(descendants(g, "l").sort()).toEqual(["c", "sc", "t"]);
	});
});

describe("issues", () => {
	it("does not flag a node that carries its own text", () => {
		// The panel used to report "2 to fix" on a graph that ran to completion,
		// which is the fastest way to teach someone to ignore the count.
		const g = graph(
			[
				{ ...node("c", "character"), text: "A dock worker in her fifties." },
				node("t", "timeline"),
			],
			[["c", "t"]],
		);
		expect(g.nodes[0].text).toBeTruthy();
		expect(graphIssues(g).some((i) => i.nodeId === "c" && i.message.includes("no input"))).toBe(
			false,
		);
	});

	it("still flags one that is empty and unwired", () => {
		const g = graph([node("c", "character"), node("t", "timeline")], [["c", "t"]]);
		expect(graphIssues(g).some((i) => i.message.includes("nothing written"))).toBe(true);
	});

	it("says an empty graph needs a start", () => {
		expect(graphIssues(graph([]))[0].message).toContain("Empty graph");
	});

	it("flags a scene with nobody in it", () => {
		const g = graph([node("sc", "scene"), node("t", "timeline")], [["sc", "t"]]);
		expect(graphIssues(g).some((i) => i.message.includes("nobody is in it"))).toBe(true);
	});

	it("flags a graph that would never reach the editor", () => {
		const g = graph([node("c", "character"), node("sc", "scene")], [["c", "sc"]]);
		expect(graphIssues(g).some((i) => i.message.includes("No Timeline"))).toBe(true);
	});
});
