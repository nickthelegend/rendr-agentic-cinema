// Rendering a scene and laying it on the timeline.
//
// The placement is tested as a plan rather than by driving an editor: the plan
// is the same list of public MCP tools an agent would call, so asserting it
// asserts that nothing here can do something an agent could not.

import { describe, expect, it } from "vitest";

import type { CinemaGraph, SceneSpec } from "./nodes";
import type { CinemaProvider, ImageBytes } from "./provider";
import {
	buildScenePrompt,
	moveFor,
	plannedDuration,
	planTimelinePlacement,
	renderScene,
} from "./scene";

const bytes = (tag: string): ImageBytes => ({ base64: tag, mimeType: "image/png" });

const graph: CinemaGraph = {
	id: "g",
	name: "n",
	auto: false,
	nodes: [
		{
			id: "c-mira",
			kind: "character",
			x: 0,
			y: 0,
			params: {},
			status: "ready",
			label: "Mira",
			output: { sheet: [bytes("mira-front"), bytes("mira-side")] },
		},
		{
			id: "c-sam",
			kind: "character",
			x: 0,
			y: 0,
			params: {},
			status: "ready",
			label: "Sam",
			output: { sheet: [bytes("sam-front")] },
		},
	],
	edges: [],
};

const spec = (over: Partial<SceneSpec> = {}): SceneSpec => ({
	id: "s1",
	index: 0,
	characterIds: ["c-mira"],
	location: "a kitchen",
	timeOfDay: "night",
	camera: "medium, static",
	action: "she reads a letter",
	durationSeconds: 4,
	...over,
});

const rendered = (s: SceneSpec) => ({
	spec: s,
	image: bytes(`shot-${s.index}`),
	prompt: "p",
	model: "fake",
	elapsedMs: 1,
});

describe("buildScenePrompt", () => {
	it("leads with the camera, because it frames everything after it", () => {
		expect(buildScenePrompt(graph, spec())).toMatch(/^medium, static\./);
	});

	it("names who is in frame by their label", () => {
		expect(buildScenePrompt(graph, spec({ characterIds: ["c-mira", "c-sam"] }))).toContain(
			"Mira",
		);
	});

	it("does not repeat a full description beside the attached sheet", () => {
		// Two sources for one face lets the words beat the picture, which is the
		// drift the sheet exists to prevent.
		const prompt = buildScenePrompt(graph, spec());
		expect(prompt).toContain("as in the attached reference sheet");
		expect(prompt.length).toBeLessThan(400);
	});

	it("says nothing about cast when the frame is empty", () => {
		expect(buildScenePrompt(graph, spec({ characterIds: [] }))).not.toContain("In frame");
	});
});

describe("renderScene", () => {
	it("attaches one sheet view per character present", async () => {
		let seen: ImageBytes[] = [];
		const provider: CinemaProvider = {
			name: "fake",
			text: async () => ({ text: "", model: "m", elapsedMs: 1 }),
			image: async (request) => {
				seen = request.references ?? [];
				return { image: bytes("out"), model: "m", elapsedMs: 1 };
			},
		};
		await renderScene(provider, graph, spec({ characterIds: ["c-mira", "c-sam"] }));
		expect(seen.map((s) => s.base64)).toEqual(["mira-front", "sam-front"]);
	});
});

describe("moveFor", () => {
	it("pushes in on a wide, because a static wide is a postcard", () => {
		expect(moveFor(spec({ camera: "wide establishing" })).direction).toBe("in");
	});

	it("drifts on a close-up rather than pushing", () => {
		expect(["left", "right"]).toContain(
			moveFor(spec({ camera: "close on her hands" })).direction,
		);
	});

	it("moves two consecutive close-ups in opposite directions", () => {
		// Identical framings back to back is what makes a cut look generated;
		// the move is what keeps them distinct.
		const first = moveFor(spec({ index: 0, camera: "close" }));
		const second = moveFor(spec({ index: 1, camera: "close" }));
		expect(first.direction).not.toBe(second.direction);
	});
});

describe("planTimelinePlacement", () => {
	it("lays scenes end to end with no gaps", () => {
		const plans = planTimelinePlacement(
			[
				rendered(spec({ index: 0, durationSeconds: 4 })),
				rendered(spec({ index: 1, durationSeconds: 3 })),
			],
			{ fps: 30 },
		);
		const adds = plans.filter((p) => p.tool === "add_clips");
		const first = (adds[0].args.entries as Array<Record<string, number>>)[0];
		const second = (adds[1].args.entries as Array<Record<string, number>>)[0];
		expect(first.startFrame).toBe(0);
		expect(first.endFrame).toBe(120);
		expect(second.startFrame).toBe(120);
		expect(second.endFrame).toBe(210);
	});

	it("gives every scene a camera move", () => {
		const plans = planTimelinePlacement([rendered(spec())], { fps: 30 });
		expect(plans.some((p) => p.tool === "add_ken_burns")).toBe(true);
	});

	it("pins dialogue as a note rather than burning it into the picture", () => {
		const plans = planTimelinePlacement([rendered(spec({ dialogue: "You kept it." }))], {
			fps: 30,
		});
		const note = plans.find((p) => p.tool === "manage_comments");
		expect(note?.args.text).toBe("You kept it.");
	});

	it("adds no note when there is no dialogue", () => {
		const plans = planTimelinePlacement([rendered(spec())], { fps: 30 });
		expect(plans.some((p) => p.tool === "manage_comments")).toBe(false);
	});

	it("only uses tools an agent could call itself", () => {
		const plans = planTimelinePlacement([rendered(spec({ dialogue: "hi" }))], { fps: 30 });
		const allowed = new Set(["import_media", "add_clips", "add_ken_burns", "manage_comments"]);
		for (const plan of plans) expect(allowed.has(plan.tool)).toBe(true);
	});

	it("explains every step, so a run log is readable", () => {
		for (const plan of planTimelinePlacement([rendered(spec())], { fps: 30 })) {
			expect(plan.why.length).toBeGreaterThan(0);
		}
	});
});

describe("plannedDuration", () => {
	it("totals the cut before anything is committed", () => {
		expect(
			plannedDuration([
				rendered(spec({ index: 0, durationSeconds: 4 })),
				rendered(spec({ index: 1, durationSeconds: 3.5 })),
			]),
		).toBe(7.5);
	});
});
