// The runner.
//
// The two behaviours worth pinning are the ones that cost money when wrong:
// an unchanged character must not be recast, and one node's failure must not
// throw away the scenes that already rendered.

import { describe, expect, it } from "vitest";

import type { CinemaGraph, CinemaNode } from "./nodes";
import type { CinemaProvider } from "./provider";
import { ProviderError } from "./provider";
import {
	estimateRun,
	filmSeed,
	type LedgerEntry,
	markStale,
	needsRun,
	runGraph,
	sceneOrdinal,
} from "./run";

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
	edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to })),
});

function provider(over: Partial<CinemaProvider> = {}): CinemaProvider & { calls: string[] } {
	const calls: string[] = [];
	return {
		name: "fake",
		calls,
		text: async (request) => {
			calls.push("text");
			return {
				text: request.schema
					? JSON.stringify({
							scenes: [
								{
									characterNames: [],
									location: "x",
									timeOfDay: "day",
									camera: "wide",
									action: "a",
									durationSeconds: 3,
								},
							],
						})
					: "described",
				model: "fake-text",
				elapsedMs: 1,
			};
		},
		image: async () => {
			calls.push("image");
			return {
				image: { base64: "img", mimeType: "image/png" },
				model: "fake-img",
				elapsedMs: 1,
			};
		},
		...over,
	} as CinemaProvider & { calls: string[] };
}

describe("needsRun", () => {
	it("runs a node that has never produced", () => {
		expect(needsRun(node("a", "character"), false)).toBe(true);
	});

	it("skips one that is ready and unchanged", () => {
		// Recasting an unchanged character changes its face, and every scene
		// already rendered with it stops matching. Skipping is the feature.
		expect(
			needsRun(node("a", "character", { status: "ready", output: { text: "x" } }), false),
		).toBe(false);
	});

	it("runs a stale one", () => {
		expect(
			needsRun(node("a", "character", { status: "stale", output: { text: "x" } }), false),
		).toBe(true);
	});

	it("retries a failed one", () => {
		expect(needsRun(node("a", "character", { status: "failed" }), false)).toBe(true);
	});

	it("runs everything under force", () => {
		expect(
			needsRun(node("a", "character", { status: "ready", output: { text: "x" } }), true),
		).toBe(true);
	});
});

describe("markStale", () => {
	it("invalidates everything downstream, not just the node edited", () => {
		const g = graph(
			[
				node("look", "look"),
				node("c", "character", { status: "ready", output: { text: "x" } }),
				node("sc", "scene", { status: "ready", output: { text: "y" } }),
			],
			[
				["look", "c"],
				["c", "sc"],
			],
		);
		const after = markStale(g, "look");
		expect(after.nodes.find((n) => n.id === "c")?.status).toBe("stale");
		expect(after.nodes.find((n) => n.id === "sc")?.status).toBe("stale");
	});

	it("leaves a node that never produced alone", () => {
		const g = graph([node("c", "character")]);
		expect(markStale(g, "c").nodes[0].status).toBe("idle");
	});
});

describe("runGraph", () => {
	it("locks a character before rendering a scene that uses it", async () => {
		const p = provider();
		const g = graph(
			[
				node("c", "character", { text: "a woman" }),
				node("b", "beat", { text: "she waits" }),
				node("st", "story"),
				node("sc", "scene"),
				node("t", "timeline"),
			],
			[
				["c", "st"],
				["b", "st"],
				["st", "sc"],
				["sc", "t"],
			],
		);
		const report = await runGraph(p, g);
		expect(report.failed).toEqual([]);
		// description + sheet(4) for the character, decompose, then the shot.
		expect(p.calls.filter((c) => c === "image")).toHaveLength(5);
		expect(report.ran).toContain("c");
		expect(report.ran).toContain("sc");
	});

	it("does not recast a character that is already locked", async () => {
		const p = provider();
		const g = graph(
			[
				node("c", "character", {
					status: "ready",
					output: { text: "x", sheet: [{ base64: "f", mimeType: "image/png" }] },
				}),
				node("b", "beat", { text: "she waits" }),
				node("st", "story"),
				node("t", "timeline"),
			],
			[
				["c", "st"],
				["b", "st"],
				["st", "t"],
			],
		);
		const report = await runGraph(p, g);
		expect(report.skipped).toContain("c");
		expect(p.calls).not.toContain("image");
	});

	it("keeps going when one node fails", async () => {
		// A safety block on one shot must not discard the shots that already
		// rendered — they cost money and they are still good.
		let images = 0;
		const p = provider({
			image: async () => {
				images += 1;
				if (images === 1) throw new ProviderError("blocked", "safety", false);
				return {
					image: { base64: "i", mimeType: "image/png" },
					model: "m",
					elapsedMs: 1,
				};
			},
		});
		const g = graph(
			[
				node("c1", "character", { text: "one" }),
				node("c2", "character", { text: "two" }),
				node("t", "timeline"),
			],
			[
				["c1", "t"],
				["c2", "t"],
			],
		);
		const report = await runGraph(p, g);
		expect(report.failed).toHaveLength(1);
		expect(report.ran).toContain("c2");
	});

	it("records every generation, including the failures", async () => {
		// A rejected take is the most useful row in the ledger.
		const p = provider({
			image: async () => {
				throw new ProviderError("blocked", "safety", false);
			},
		});
		const rows: Array<{ ok: boolean }> = [];
		await runGraph(p, graph([node("c", "character", { text: "x" })]), {
			onRecord: (entry) => rows.push(entry),
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].ok).toBe(false);
	});

	it("stops starting work at the generation ceiling", async () => {
		const p = provider();
		const g = graph([
			node("c1", "character", { text: "a" }),
			node("c2", "character", { text: "b" }),
			node("c3", "character", { text: "c" }),
		]);
		const report = await runGraph(p, g, { maxGenerations: 2 });
		expect(report.generations).toBe(2);
		expect(report.skipped).toHaveLength(1);
	});

	it("refuses a graph with a loop rather than spinning", async () => {
		const g: CinemaGraph = {
			...graph([node("a", "character"), node("b", "story")]),
			edges: [
				{ id: "1", from: "a", to: "b" },
				{ id: "2", from: "b", to: "a" },
			],
		};
		await expect(runGraph(provider(), g)).rejects.toThrow(/loop/i);
	});

	it("reports continuity problems from the decomposition", async () => {
		const p = provider({
			text: async (request) =>
				request.schema
					? {
							text: JSON.stringify({
								scenes: [
									{
										characterNames: [],
										location: "k",
										timeOfDay: "night",
										camera: "wide",
										action: "a",
										durationSeconds: 3,
									},
									{
										characterNames: [],
										location: "k",
										timeOfDay: "day",
										camera: "wide",
										action: "b",
										durationSeconds: 3,
									},
								],
							}),
							model: "m",
							elapsedMs: 1,
						}
					: { text: "d", model: "m", elapsedMs: 1 },
		});
		const g = graph(
			[node("b", "beat", { text: "x" }), node("st", "story"), node("t", "timeline")],
			[
				["b", "st"],
				["st", "t"],
			],
		);
		const report = await runGraph(p, g);
		expect(report.continuity.some((m) => /night.*day|day.*night/i.test(m))).toBe(true);
	});

	it("only runs what was asked for, plus what that invalidates", async () => {
		const p = provider();
		const g = graph(
			[
				node("c1", "character", { text: "a" }),
				node("c2", "character", { text: "b" }),
				node("t", "timeline"),
			],
			[
				["c1", "t"],
				["c2", "t"],
			],
		);
		const report = await runGraph(p, g, { only: ["c1"] });
		expect(report.ran).toContain("c1");
		expect(report.ran).not.toContain("c2");
	});
});

describe("estimateRun", () => {
	it("counts only the nodes that would cost a call", () => {
		const g = graph([
			node("t1", "trait", { text: "x" }),
			node("c", "character", { text: "y" }),
			node("done", "character", { status: "ready", output: { text: "z" } }),
		]);
		expect(estimateRun(g)).toBe(1);
		expect(estimateRun(g, { force: true })).toBe(2);
	});
});

describe("sceneOrdinal", () => {
	it("orders scenes left to right, which is how they were laid out", () => {
		const g = graph([
			{ ...node("s2", "scene"), x: 400 },
			{ ...node("s1", "scene"), x: 100 },
		]);
		expect(sceneOrdinal(g, g.nodes[1])).toBe(0);
		expect(sceneOrdinal(g, g.nodes[0])).toBe(1);
	});
});

describe("what the ledger is told", () => {
	// A regression guard with a scar. The prompt column shipped empty: LedgerEntry
	// had the field, the panel forwarded it, and the runner never filled it in —
	// so every row recorded that a call happened and nothing about what was
	// asked, which is the one thing the table exists for. The suite never saw it
	// because nothing asserted on an entry's contents, only that one arrived.
	const cast = () =>
		graph(
			[
				node("c", "character", { text: "a dock worker in her fifties" }),
				node("w", "world", { text: "coastal Kerala, monsoon" }),
				node("s", "story", { text: "she misses the last train" }),
			],
			[
				["c", "s"],
				["w", "s"],
			],
		);

	it("records the prompt, not just that something ran", async () => {
		const entries: LedgerEntry[] = [];
		await runGraph(provider(), cast(), { onRecord: (entry) => entries.push(entry) });

		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			expect(entry.prompt, `${entry.kind} recorded an empty prompt`).toBeTruthy();
		}
	});

	it("classifies a failure so 'wait' stays distinct from 'reword it'", async () => {
		const entries: LedgerEntry[] = [];
		const angry = provider({
			text: async () => {
				throw new ProviderError("blocked", "safety");
			},
			image: async () => {
				throw new ProviderError("blocked", "safety");
			},
		});
		await runGraph(angry, cast(), { onRecord: (entry) => entries.push(entry) });

		const bad = entries.filter((entry) => !entry.ok);
		expect(bad.length).toBeGreaterThan(0);
		expect(bad[0].errorKind).toBe("safety");
		expect(bad[0].prompt).toBeTruthy();
	});
});

describe("a scene that asks for a shot the story does not have", () => {
	// It used to clamp to the last shot. Five scene nodes over a three-shot
	// story rendered 1, 2, 3, 3, 3 — three identical pictures, each paid for,
	// with nothing saying so.
	const overreaching = () =>
		graph(
			[
				node("s", "story", { text: "a premise" }),
				node("sc0", "scene", { params: { sceneIndex: 0 } }),
				node("sc9", "scene", { label: "Shot 10", params: { sceneIndex: 9 } }),
			],
			[
				["s", "sc0"],
				["s", "sc9"],
			],
		);

	it("fails that node instead of duplicating another shot", async () => {
		const report = await runGraph(provider(), overreaching());
		const bad = report.failed.find((entry) => entry.nodeId === "sc9");
		expect(bad?.error).toMatch(/asks for shot 10, but the story only produced 1/);
	});

	it("still renders the scenes that are in range", async () => {
		const report = await runGraph(provider(), overreaching());
		expect(report.ran).toContain("sc0");
	});
});

describe("an explicit re-run", () => {
	// The inspector's "Re-run" button passes `only`. Without force, needsRun
	// saw a node that was already ready and skipped it, so the button did
	// nothing for exactly the case it exists for.
	it("re-runs a node that already has an output", async () => {
		const ready = graph([
			node("w", "world", {
				text: "a port town",
				status: "ready",
				output: { text: "described", model: "m" },
			}),
		]);
		const report = await runGraph(provider(), ready, { only: ["w"], force: true });
		expect(report.ran).toEqual(["w"]);
		expect(report.skipped).toEqual([]);
	});

	it("still skips a ready node on a plain whole-graph run", async () => {
		const ready = graph([
			node("w", "world", {
				text: "a port town",
				status: "ready",
				output: { text: "described", model: "m" },
			}),
		]);
		const report = await runGraph(provider(), ready);
		expect(report.skipped).toEqual(["w"]);
	});
});

describe("a failure that never reached a prompt", () => {
	// A scene pointing past the end of the shot list fails before a prompt is
	// built. `node.text ?? ""` left that row anonymous in the ledger, which
	// defeats the one question failure rows exist to answer.
	it("still names the node it was", async () => {
		const entries: LedgerEntry[] = [];
		const overreaching = graph(
			[
				node("s", "story", { text: "a premise" }),
				node("sc", "scene", { label: "Shot 9", params: { sceneIndex: 9 } }),
			],
			[["s", "sc"]],
		);
		await runGraph(provider(), overreaching, { onRecord: (entry) => entries.push(entry) });

		const bad = entries.find((entry) => !entry.ok);
		expect(bad?.prompt).toBeTruthy();
		expect(bad?.prompt).toContain("Shot 9");
	});
});

describe("the film seed", () => {
	// "Render it again and get the same film" is a sentence worth being able to
	// say. It is only true if the salt every generative call shares comes off
	// the graph rather than being minted per run.
	it("falls back to the film id when none has been set", () => {
		expect(filmSeed(graph([]))).toBe("g");
	});

	it("prefers an explicit seed", () => {
		expect(filmSeed({ ...graph([]), seed: "locked-2026" })).toBe("locked-2026");
	});

	it("ignores an empty seed rather than salting with nothing", () => {
		expect(filmSeed({ ...graph([]), seed: "" })).toBe("g");
	});

	it("gives one film the same cast twice", async () => {
		const film = () =>
			graph([node("c", "character", { text: "a dock worker in her fifties" })]);
		const first = await runGraph(provider(), film());
		const second = await runGraph(provider(), film());
		expect(first.graph.nodes[0].output?.seed).toBe(second.graph.nodes[0].output?.seed);
	});

	it("gives two films different people for the same description", async () => {
		// Without the film salt every project that says "a dock worker in her
		// fifties" would cast the identical person.
		const one = {
			...graph([node("c", "character", { text: "a dock worker" })]),
			seed: "film-a",
		};
		const two = {
			...graph([node("c", "character", { text: "a dock worker" })]),
			seed: "film-b",
		};
		const a = await runGraph(provider(), one);
		const b = await runGraph(provider(), two);
		expect(a.graph.nodes[0].output?.seed).not.toBe(b.graph.nodes[0].output?.seed);
	});
});
