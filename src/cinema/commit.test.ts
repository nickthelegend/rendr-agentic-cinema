// Placing scenes on the timeline.
//
// Tested against a recording target rather than a real editor, which is what
// lets the ordering and the skip behaviour be pinned without an app running.

import { describe, expect, it, vi } from "vitest";

import { commitToTimeline, readyScenes } from "./commit";
import type { CinemaGraph, CinemaNode, SceneSpec } from "./nodes";

const spec = (index: number, over: Partial<SceneSpec> = {}): SceneSpec => ({
	id: `s${index}`,
	index,
	characterIds: [],
	location: "a street",
	timeOfDay: "night",
	camera: "wide, static",
	action: "it rains",
	durationSeconds: 3,
	...over,
});

const image = { base64: "aGk=", mimeType: "image/png" };

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

function graphWith(scenes: SceneSpec[], rendered: boolean[]): CinemaGraph {
	return {
		id: "g",
		name: "n",
		auto: false,
		nodes: [
			node("st", "story", { status: "ready", output: { scenes } }),
			...scenes.map((_, index) =>
				node(`sc${index}`, "scene", {
					label: `Shot ${index + 1}`,
					params: { sceneIndex: index },
					...(rendered[index]
						? { status: "ready" as const, output: { sheet: [image] } }
						: {}),
				}),
			),
		],
		edges: [],
	};
}

function target() {
	const calls = {
		clips: [] as Array<Record<string, unknown>>,
		moves: [] as Array<{ ids: string[]; direction: string }>,
		comments: [] as Array<{ frame: number; text: string }>,
	};
	return {
		calls,
		fps: 30,
		importMedia: vi.fn(async (files: readonly File[]) =>
			files.map((file, index) => ({ id: `asset-${index}`, name: file.name })),
		),
		addClips: (entries: Array<Record<string, unknown>>) => calls.clips.push(...entries),
		kenBurns: (ids: string[], direction: string) => calls.moves.push({ ids, direction }),
		addComment: (frame: number, text: string) => calls.comments.push({ frame, text }),
		clipIdsAt: (starts: number[]) => starts.map((start) => `clip-${start}`),
	};
}

describe("readyScenes", () => {
	it("orders by the story's index, not by node order", () => {
		// The story decided the order; where the boxes sit on the canvas is only
		// how somebody chose to arrange them.
		const graph = graphWith([spec(0), spec(1), spec(2)], [true, true, true]);
		graph.nodes.reverse();
		expect(readyScenes(graph).map((entry) => entry.spec.index)).toEqual([0, 1, 2]);
	});

	it("leaves out a scene that has not rendered", () => {
		const graph = graphWith([spec(0), spec(1)], [true, false]);
		expect(readyScenes(graph)).toHaveLength(1);
	});
});

describe("commitToTimeline", () => {
	it("lays scenes end to end with no gaps", async () => {
		const t = target();
		await commitToTimeline(graphWith([spec(0), spec(1)], [true, true]), t);
		expect(t.calls.clips[0]).toMatchObject({ startFrame: 0, endFrame: 90 });
		expect(t.calls.clips[1]).toMatchObject({ startFrame: 90, endFrame: 180 });
	});

	it("gives every placed scene a camera move", async () => {
		const t = target();
		await commitToTimeline(graphWith([spec(0), spec(1)], [true, true]), t);
		expect(t.calls.moves).toHaveLength(2);
	});

	it("names the scene that is missing rather than dropping it quietly", async () => {
		// A cut silently missing its third shot is worse than one that says so.
		const t = target();
		const result = await commitToTimeline(graphWith([spec(0), spec(1)], [true, false]), t);
		expect(result.placed).toBe(1);
		expect(result.skipped[0].why).toContain("Shot 2");
	});

	it("pins dialogue as a note rather than burning it in", async () => {
		const t = target();
		await commitToTimeline(graphWith([spec(0, { dialogue: "You kept it." })], [true]), t);
		expect(t.calls.comments[0].text).toBe("You kept it.");
	});

	it("adds no note when there is no dialogue", async () => {
		const t = target();
		await commitToTimeline(graphWith([spec(0)], [true]), t);
		expect(t.calls.comments).toHaveLength(0);
	});

	it("places nothing when nothing has rendered", async () => {
		const t = target();
		const result = await commitToTimeline(graphWith([spec(0)], [false]), t);
		expect(result.placed).toBe(0);
		expect(t.calls.clips).toHaveLength(0);
	});

	it("reports the length of the cut it made", async () => {
		const t = target();
		const result = await commitToTimeline(
			graphWith(
				[spec(0, { durationSeconds: 4 }), spec(1, { durationSeconds: 2.5 })],
				[true, true],
			),
			t,
		);
		expect(result.durationSeconds).toBe(6.5);
	});

	it("stops rather than half-placing when the library rejects a still", async () => {
		const t = target();
		t.importMedia = vi.fn(async () => [{ id: "asset-0", name: "one" }]);
		const result = await commitToTimeline(graphWith([spec(0), spec(1)], [true, true]), t);
		expect(result.placed).toBe(0);
		expect(t.calls.clips).toHaveLength(0);
		expect(result.skipped.some((s) => s.why.includes("1 of 2"))).toBe(true);
	});
});
