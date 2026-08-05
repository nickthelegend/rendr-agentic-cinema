// Decomposition and the continuity check.
//
// parseScenes is tested against the shapes a model actually returns when it
// misbehaves — a name that is not in the cast, a beat id it invented, a
// duration outside anything usable — because those are the failures that reach
// the render rather than the ones that throw.

import { describe, expect, it } from "vitest";
import type { CinemaNode, SceneSpec } from "./nodes";
import type { CinemaProvider } from "./provider";
import { castFrom, checkContinuity, decomposeStory, parseScenes } from "./story";

const input = {
	beats: [
		{ id: "b1", text: "She finds the letter." },
		{ id: "b2", text: "She burns it." },
	],
	cast: [
		{ id: "c-mira", name: "Mira" },
		{ id: "c-sam", name: "Sam" },
	],
};

const json = (scenes: unknown[]) => JSON.stringify({ scenes });

const scene = (over: Partial<SceneSpec> = {}): SceneSpec => ({
	id: "s",
	index: 0,
	characterIds: ["c-mira"],
	location: "kitchen",
	timeOfDay: "day",
	camera: "medium, static",
	action: "she reads",
	durationSeconds: 4,
	...over,
});

describe("parseScenes", () => {
	it("maps character names onto node ids", () => {
		const { scenes } = parseScenes(
			json([
				{
					characterNames: ["Mira"],
					location: "kitchen",
					timeOfDay: "day",
					camera: "wide",
					action: "reads",
					durationSeconds: 4,
				},
			]),
			input,
		);
		expect(scenes[0].characterIds).toEqual(["c-mira"]);
	});

	it("matches a name whatever its case or spacing", () => {
		// A model writing "mira " means Mira, and dropping it empties the frame.
		const { scenes, unknownCharacters } = parseScenes(
			json([
				{
					characterNames: [" mira ", "SAM"],
					location: "x",
					timeOfDay: "day",
					camera: "wide",
					action: "a",
					durationSeconds: 3,
				},
			]),
			input,
		);
		expect(scenes[0].characterIds).toEqual(["c-mira", "c-sam"]);
		expect(unknownCharacters).toEqual([]);
	});

	it("reports a character the model invented rather than silently dropping it", () => {
		const { scenes, unknownCharacters } = parseScenes(
			json([
				{
					characterNames: ["Mira", "The Stranger"],
					location: "x",
					timeOfDay: "day",
					camera: "wide",
					action: "a",
					durationSeconds: 3,
				},
			]),
			input,
		);
		expect(scenes[0].characterIds).toEqual(["c-mira"]);
		expect(unknownCharacters).toEqual(["The Stranger"]);
	});

	it("drops a beat id that does not exist", () => {
		// Keeping an invented id would mean editing the real beat fails to
		// invalidate this scene, which is worse than having no link at all.
		const { scenes } = parseScenes(
			json([
				{
					beatId: "b-nope",
					characterNames: [],
					location: "x",
					timeOfDay: "day",
					camera: "wide",
					action: "a",
					durationSeconds: 3,
				},
			]),
			input,
		);
		expect(scenes[0].beatId).toBeUndefined();
	});

	it("keeps a beat id that does exist", () => {
		const { scenes } = parseScenes(
			json([
				{
					beatId: "b2",
					characterNames: [],
					location: "x",
					timeOfDay: "day",
					camera: "wide",
					action: "a",
					durationSeconds: 3,
				},
			]),
			input,
		);
		expect(scenes[0].beatId).toBe("b2");
	});

	it("clamps a duration outside anything usable", () => {
		const { scenes } = parseScenes(
			json([
				{
					characterNames: [],
					location: "x",
					timeOfDay: "day",
					camera: "w",
					action: "a",
					durationSeconds: 400,
				},
				{
					characterNames: [],
					location: "x",
					timeOfDay: "day",
					camera: "w",
					action: "a",
					durationSeconds: 0.1,
				},
			]),
			input,
		);
		expect(scenes[0].durationSeconds).toBe(8);
		expect(scenes[1].durationSeconds).toBe(2);
	});

	it("fills a missing field rather than producing an unrenderable scene", () => {
		const { scenes } = parseScenes(json([{ characterNames: [], action: "a" }]), input);
		expect(scenes[0].location).toBe("unspecified");
		expect(scenes[0].timeOfDay).toBe("day");
		expect(scenes[0].camera).toBeTruthy();
	});

	it("throws on output that is not JSON", () => {
		expect(() => parseScenes("Here are your scenes!", input)).toThrow(/JSON/);
	});

	it("throws when there are no scenes", () => {
		expect(() => parseScenes(json([]), input)).toThrow(/no scenes/i);
	});
});

describe("checkContinuity", () => {
	it("passes a clean run", () => {
		expect(
			checkContinuity([
				scene({ index: 0, camera: "wide" }),
				scene({ index: 1, camera: "medium" }),
			]),
		).toEqual([]);
	});

	it("catches night flipping to day in one location", () => {
		const issues = checkContinuity([
			scene({ index: 0, timeOfDay: "night", camera: "wide" }),
			scene({ index: 1, timeOfDay: "day", camera: "medium" }),
		]);
		expect(issues.some((i) => i.kind === "time-jump")).toBe(true);
	});

	it("allows a time change when the location changed too", () => {
		const issues = checkContinuity([
			scene({ index: 0, timeOfDay: "night", location: "street", camera: "wide" }),
			scene({ index: 1, timeOfDay: "day", location: "kitchen", camera: "medium" }),
		]);
		expect(issues.some((i) => i.kind === "time-jump")).toBe(false);
	});

	it("catches a location bouncing back and forth", () => {
		const issues = checkContinuity([
			scene({ index: 0, location: "kitchen", camera: "wide" }),
			scene({ index: 1, location: "street", camera: "medium" }),
			scene({ index: 2, location: "kitchen", camera: "close" }),
		]);
		expect(issues.some((i) => i.kind === "location-thrash")).toBe(true);
	});

	it("catches three identical framings in a row", () => {
		const issues = checkContinuity([
			scene({ index: 0, camera: "wide, static" }),
			scene({ index: 1, camera: "wide, static" }),
			scene({ index: 2, camera: "wide, slow push" }),
		]);
		expect(issues.some((i) => i.kind === "monotony")).toBe(true);
	});

	it("flags an empty frame, but not an establishing shot", () => {
		const peopled = checkContinuity([scene({ characterIds: [], location: "kitchen" })]);
		expect(peopled.some((i) => i.kind === "empty-frame")).toBe(true);
		const establishing = checkContinuity([
			scene({ characterIds: [], location: "establishing exterior" }),
		]);
		expect(establishing.some((i) => i.kind === "empty-frame")).toBe(false);
	});

	it("flags a scene with no action, because there is nothing to render", () => {
		expect(checkContinuity([scene({ action: "" })]).some((i) => i.kind === "no-action")).toBe(
			true,
		);
	});
});

describe("castFrom", () => {
	it("gives an unlabelled character a handle the model can use", () => {
		const nodes: CinemaNode[] = [
			{ id: "c1", kind: "character", x: 0, y: 0, params: {}, status: "idle" },
			{ id: "c2", kind: "character", x: 0, y: 0, params: {}, status: "idle", label: "Mira" },
			{ id: "t", kind: "trait", x: 0, y: 0, params: {}, status: "idle" },
		];
		expect(castFrom(nodes)).toEqual([
			{ id: "c1", name: "Character 1" },
			{ id: "c2", name: "Mira" },
		]);
	});
});

describe("what the story tells the ledger", () => {
	it("carries the prompt it actually sent", async () => {
		// It did not, at first, and the leaderboard made it obvious: a ranked
		// entry with nothing written on it, sitting between two readable ones.
		const answered: CinemaProvider = {
			name: "fake",
			text: async () => ({
				text: JSON.stringify({
					scenes: [
						{
							characterNames: ["Lead"],
							location: "a platform",
							timeOfDay: "night",
							camera: "wide",
							action: "the train leaves",
							durationSeconds: 4,
						},
					],
				}),
				model: "fake-text",
				elapsedMs: 1,
			}),
			image: async () => {
				throw new Error("not used");
			},
		};
		const result = await decomposeStory(answered, {
			beats: [{ id: "b1", text: "she misses the last train" }],
			cast: [{ name: "Lead", description: "a dock worker" }],
			world: "a rain-dark port town",
		});

		expect(result.prompt).toContain("she misses the last train");
		expect(result.prompt).toContain("Lead");
		expect(result.prompt).toContain("rain-dark port town");
	});
});
