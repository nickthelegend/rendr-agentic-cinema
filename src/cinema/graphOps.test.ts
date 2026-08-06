// Graph operations.
//
// All pure, so all cheap to test properly. The cases that matter are the ones
// where an operation could plausibly do the *almost* right thing — a duplicate
// that carries the original's render, a layout that puts a node left of its own
// input, a re-run that forgets what it invalidated.

import { describe, expect, it } from "vitest";

import {
	autoLayout,
	duplicateNode,
	findNodes,
	PALETTE_GROUPS,
	preflight,
	removeNodes,
	TEMPLATES,
	withDownstream,
} from "./graphOps";
import type { CinemaGraph, CinemaNode } from "./nodes";

const node = (
	id: string,
	kind: CinemaNode["kind"],
	over: Partial<CinemaNode> = {},
): CinemaNode => ({
	id,
	kind,
	x: 0,
	y: 0,
	params: {},
	status: "idle",
	...over,
});

const graph = (nodes: CinemaNode[], edges: Array<[string, string]> = []): CinemaGraph => ({
	id: "g",
	name: "T",
	auto: false,
	nodes,
	edges: edges.map(([from, to], index) => ({ id: `e${index}`, from, to })),
});

const chain = (): CinemaGraph =>
	graph(
		[
			node("c", "character", { label: "Lead", text: "a dock worker", status: "ready" }),
			node("w", "world", { text: "a port town", status: "ready" }),
			node("s", "story", { text: "she misses the train", status: "ready" }),
			node("sc", "scene", { label: "Shot 1", params: { sceneIndex: 0 } }),
			node("t", "timeline"),
		],
		[
			["c", "s"],
			["w", "s"],
			["s", "sc"],
			["sc", "t"],
		],
	);

describe("duplicateNode", () => {
	it("copies the wires feeding it", () => {
		// The whole reason to duplicate a scene is to try it again against the
		// same story. Without the inbound edge it arrives as an empty box.
		const out = duplicateNode(chain(), "sc");
		const copy = out.nodes.find((entry) => entry.label === "Shot 1 copy");
		expect(copy).toBeDefined();
		expect(out.edges.some((edge) => edge.from === "s" && edge.to === copy?.id)).toBe(true);
	});

	it("does not copy the wires leaving it", () => {
		// A duplicate that also fed the timeline would silently double the cut.
		const out = duplicateNode(chain(), "sc");
		const copy = out.nodes.find((entry) => entry.label === "Shot 1 copy");
		expect(out.edges.some((edge) => edge.from === copy?.id)).toBe(false);
	});

	it("arrives unrendered", () => {
		const ready = chain();
		const out = duplicateNode(ready, "c");
		const copy = out.nodes.find((entry) => entry.label === "Lead copy");
		expect(copy?.status).toBe("idle");
		expect(copy?.output).toBeUndefined();
	});

	it("carries the params, which are the settings worth copying", () => {
		const out = duplicateNode(chain(), "sc");
		const copy = out.nodes.find((entry) => entry.label === "Shot 1 copy");
		expect(copy?.params.sceneIndex).toBe(0);
	});

	it("does not share the params object with the original", () => {
		const out = duplicateNode(chain(), "sc");
		const copy = out.nodes.find((entry) => entry.label === "Shot 1 copy");
		const original = out.nodes.find((entry) => entry.id === "sc");
		expect(copy?.params).not.toBe(original?.params);
	});

	it("offsets the copy so it is not hidden under the original", () => {
		const out = duplicateNode(chain(), "sc");
		const copy = out.nodes.find((entry) => entry.label === "Shot 1 copy");
		expect(copy?.x).not.toBe(0);
	});

	it("mints a fresh id every time", () => {
		let out = chain();
		out = duplicateNode(out, "sc");
		out = duplicateNode(out, "sc");
		expect(new Set(out.nodes.map((entry) => entry.id)).size).toBe(out.nodes.length);
	});

	it("leaves the graph alone when the node is gone", () => {
		const before = chain();
		expect(duplicateNode(before, "ghost")).toBe(before);
	});
});

describe("removeNodes", () => {
	it("takes every edge that touched them", () => {
		const out = removeNodes(chain(), ["s"]);
		expect(out.nodes).toHaveLength(4);
		expect(out.edges.some((edge) => edge.from === "s" || edge.to === "s")).toBe(false);
	});

	it("removes several at once", () => {
		expect(removeNodes(chain(), ["c", "w"]).nodes).toHaveLength(3);
	});
});

describe("autoLayout", () => {
	it("puts every node to the right of everything feeding it", () => {
		const out = autoLayout(chain());
		const at = (id: string) => out.nodes.find((entry) => entry.id === id) as CinemaNode;
		expect(at("s").x).toBeGreaterThan(at("c").x);
		expect(at("sc").x).toBeGreaterThan(at("s").x);
		expect(at("t").x).toBeGreaterThan(at("sc").x);
	});

	it("puts roots in the same first column", () => {
		const out = autoLayout(chain());
		const at = (id: string) => out.nodes.find((entry) => entry.id === id) as CinemaNode;
		expect(at("c").x).toBe(at("w").x);
		expect(at("c").y).not.toBe(at("w").y);
	});

	it("leaves a looped graph exactly as it was", () => {
		// There is no left-to-right for a cycle, and inventing one draws a
		// picture that lies about the problem.
		const looped = graph(
			[node("a", "beat"), node("b", "story")],
			[
				["a", "b"],
				["b", "a"],
			],
		);
		expect(autoLayout(looped)).toBe(looped);
	});

	it("keeps every node", () => {
		expect(autoLayout(chain()).nodes).toHaveLength(5);
	});
});

describe("findNodes", () => {
	it("finds nothing for an empty query", () => {
		expect(findNodes(chain(), "   ")).toEqual([]);
	});

	it("matches a label", () => {
		expect(findNodes(chain(), "lead").map((entry) => entry.id)).toEqual(["c"]);
	});

	it("matches body text", () => {
		expect(findNodes(chain(), "dock").map((entry) => entry.id)).toEqual(["c"]);
	});

	it("matches a kind by its display name", () => {
		expect(findNodes(chain(), "timeline").map((entry) => entry.id)).toEqual(["t"]);
	});
});

describe("withDownstream", () => {
	it("includes the node itself", () => {
		expect(withDownstream(chain(), ["sc"])).toContain("sc");
	});

	it("includes everything a change invalidates", () => {
		// Re-running a character without its scenes leaves shots of a face that
		// no longer exists — current-looking and wrong.
		const out = withDownstream(chain(), ["c"]);
		expect(out).toEqual(expect.arrayContaining(["c", "s", "sc", "t"]));
	});

	it("does not repeat a node reachable by two paths", () => {
		const out = withDownstream(chain(), ["c", "w"]);
		expect(new Set(out).size).toBe(out.length);
	});
});

describe("the templates", () => {
	it.each(
		TEMPLATES.map((template) => [template.name, template] as const),
	)("%s builds a graph that passes preflight", (_name, template) => {
		// A starting point that arrives broken is worse than an empty canvas.
		expect(preflight(template.build("g1", "Test"))).toEqual([]);
	});

	it.each(
		TEMPLATES.map((template) => [template.name, template] as const),
	)("%s arrives already laid out", (_name, template) => {
		const built = template.build("g1", "Test");
		expect(built).toEqual(autoLayout(built));
	});

	it("seeds real text rather than placeholders", () => {
		for (const template of TEMPLATES) {
			const built = template.build("g1", "Test");
			const story = built.nodes.find((entry) => entry.kind === "story");
			expect(story?.text?.length ?? 0).toBeGreaterThan(10);
			expect(story?.text ?? "").not.toMatch(/your |enter |lorem/i);
		}
	});

	it("gives every scene a distinct shot index", () => {
		for (const template of TEMPLATES) {
			const scenes = template
				.build("g1", "T")
				.nodes.filter((entry) => entry.kind === "scene");
			const indices = scenes.map((entry) => entry.params.sceneIndex);
			expect(new Set(indices).size).toBe(scenes.length);
		}
	});
});

describe("preflight", () => {
	it("passes a wired film", () => {
		expect(preflight(chain())).toEqual([]);
	});

	it("says so when there is nothing at all", () => {
		expect(preflight(graph([]))).toEqual(["This film has no nodes."]);
	});

	it("catches a loop", () => {
		const looped = graph(
			[node("a", "beat"), node("b", "story")],
			[
				["a", "b"],
				["b", "a"],
			],
		);
		expect(preflight(looped).some((line) => /loop/.test(line))).toBe(true);
	});

	it("catches scenes with no story to decompose", () => {
		const orphan = graph([node("sc", "scene")]);
		expect(orphan.nodes.length).toBe(1);
		expect(preflight(orphan).some((line) => /no story/.test(line))).toBe(true);
	});

	it("catches a story with neither text nor beats", () => {
		const empty = graph([node("s", "story", { text: "  " })]);
		expect(preflight(empty).some((line) => /nothing to decompose/.test(line))).toBe(true);
	});

	it("catches a scene with no story wired into it", () => {
		const loose = graph([node("s", "story", { text: "a premise" }), node("sc", "scene")]);
		expect(preflight(loose).some((line) => /no story wired/.test(line))).toBe(true);
	});

	it("does not complain about a character that is its own root", () => {
		// A Character with a description and no Reference node is complete. An
		// earlier version of this check flagged every root, and a preflight that
		// cries about good input is one people learn to skip.
		const rooted = graph(
			[
				node("c", "character", { text: "a dock worker" }),
				node("s", "story", { text: "a premise" }),
			],
			[["c", "s"]],
		);
		expect(preflight(rooted)).toEqual([]);
	});

	it("catches a scene asking for a shot the story does not have", () => {
		// Renders nothing and says nothing about why — the worst combination.
		const over = chain();
		const story = over.nodes.find((entry) => entry.id === "s") as CinemaNode;
		story.output = {
			scenes: [
				{
					id: "x",
					index: 0,
					characterIds: [],
					location: "a",
					timeOfDay: "day",
					camera: "wide",
					action: "b",
					durationSeconds: 3,
				},
			],
		};
		const scene = over.nodes.find((entry) => entry.id === "sc") as CinemaNode;
		scene.params = { sceneIndex: 4 };
		expect(preflight(over).some((line) => /only has 1/.test(line))).toBe(true);
	});
});

describe("PALETTE_GROUPS", () => {
	it("covers every node kind exactly once", () => {
		const kinds = PALETTE_GROUPS().flatMap((entry) => entry.kinds);
		expect(new Set(kinds).size).toBe(kinds.length);
		expect(kinds).toContain("character");
		expect(kinds).toContain("timeline");
	});
});
