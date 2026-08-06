// Sound planning and cost.
//
// The cases worth pinning are the ones where being almost right is worse than
// being silent: a line attributed to the wrong person, an ambience bed that
// restarts on every cut, a cost estimate that counts nodes which will be
// skipped.

import { describe, expect, it } from "vitest";
import type { CinemaGraph, CinemaNode, SceneSpec } from "./nodes";
import {
	ambienceBeds,
	castVoices,
	DEFAULT_IMAGE_USD,
	effectCues,
	estimateCost,
	lines,
	musicMood,
	overrunningLines,
	speechSeconds,
	VOICES,
	voiceFor,
} from "./sound";

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

const shot = (over: Partial<SceneSpec> = {}): SceneSpec => ({
	id: `s${over.index ?? 0}`,
	index: 0,
	characterIds: [],
	location: "a platform",
	timeOfDay: "night",
	camera: "medium",
	action: "she waits",
	durationSeconds: 4,
	...over,
});

const graph = (nodes: CinemaNode[]): CinemaGraph => ({
	id: "g",
	name: "T",
	auto: false,
	nodes,
	edges: [],
});

describe("speechSeconds", () => {
	it("scales with the number of words", () => {
		expect(speechSeconds("one two three four five")).toBe(2);
	});

	it("is zero for nothing", () => {
		expect(speechSeconds("   ")).toBe(0);
	});

	it("does not count runs of whitespace as words", () => {
		expect(speechSeconds("one    two")).toBe(speechSeconds("one two"));
	});
});

describe("lines", () => {
	const cast = graph([node("c1", "character", { label: "Ma" })]);

	it("finds only the shots that carry a line", () => {
		const out = lines(cast, [shot({ index: 0 }), shot({ index: 1, dialogue: "You kept it." })]);
		expect(out).toHaveLength(1);
		expect(out[0].text).toBe("You kept it.");
	});

	it("attributes a line to whoever is in frame", () => {
		const out = lines(cast, [shot({ index: 0, characterIds: ["c1"], dialogue: "I waited." })]);
		expect(out[0].speaker).toBe("Ma");
		expect(out[0].characterId).toBe("c1");
	});

	it("calls a line with nobody in frame narration", () => {
		// A different thing, and it should read as one.
		const out = lines(cast, [shot({ index: 0, dialogue: "Nobody came." })]);
		expect(out[0].speaker).toBe("Narrator");
		expect(out[0].characterId).toBeUndefined();
	});

	it("places each line where the shot actually starts", () => {
		const out = lines(cast, [
			shot({ index: 0, durationSeconds: 4 }),
			shot({ index: 1, durationSeconds: 3, dialogue: "Here." }),
		]);
		expect(out[0].at).toBe(4);
	});

	it("orders by the story's index, not the order handed in", () => {
		const out = lines(cast, [
			shot({ index: 1, durationSeconds: 3, dialogue: "second" }),
			shot({ index: 0, durationSeconds: 4, dialogue: "first" }),
		]);
		expect(out.map((line) => line.text)).toEqual(["first", "second"]);
	});
});

describe("overrunningLines", () => {
	it("catches a line with no room to be said", () => {
		// The timeline will happily let a caption run past its cut.
		const long = lines(graph([]), [
			shot({
				index: 0,
				durationSeconds: 2,
				dialogue: "one two three four five six seven eight",
			}),
		]);
		expect(overrunningLines(long)).toHaveLength(1);
	});

	it("allows a line that fits", () => {
		const fine = lines(graph([]), [
			shot({ index: 0, durationSeconds: 4, dialogue: "You kept it." }),
		]);
		expect(overrunningLines(fine)).toEqual([]);
	});
});

describe("voiceFor", () => {
	it("honours an explicit choice", () => {
		expect(
			voiceFor(node("c", "character", { params: { voice: "formal" }, text: "young" })),
		).toBe("formal");
	});

	it("ignores a choice that is not a real voice", () => {
		expect(voiceFor(node("c", "character", { params: { voice: "nonsense" } }))).toBe("warm");
	});

	it("derives from the description when nothing was chosen", () => {
		expect(voiceFor(node("c", "character", { text: "weathered, in his sixties" }))).toBe("low");
		expect(voiceFor(node("c", "character", { text: "a young girl, breathless" }))).toBe(
			"young",
		);
		expect(voiceFor(node("c", "character", { text: "tired, flat" }))).toBe("dry");
	});

	it("is deterministic, so a cast does not re-voice itself every run", () => {
		const who = node("c", "character", { text: "weathered, sixties" });
		expect(voiceFor(who)).toBe(voiceFor(who));
	});

	it("falls back to a real voice rather than nothing", () => {
		expect(VOICES[voiceFor(node("c", "character", { text: "a person" }))]).toBeDefined();
	});
});

describe("castVoices", () => {
	it("covers every character and nothing else", () => {
		const out = castVoices(
			graph([
				node("c1", "character", { label: "Ma", text: "sixties, weathered" }),
				node("w", "world", { text: "a port" }),
			]),
		);
		expect(out).toEqual([{ id: "c1", name: "Ma", voice: "low" }]);
	});
});

describe("ambienceBeds", () => {
	it("runs one bed across consecutive shots in the same place", () => {
		// A bed that restarts on every cut is the most recognisable sign of an
		// amateur mix.
		const beds = ambienceBeds([
			shot({ index: 0, location: "a platform", durationSeconds: 4 }),
			shot({ index: 1, location: "a platform", durationSeconds: 3 }),
		]);
		expect(beds).toHaveLength(1);
		expect(beds[0]).toMatchObject({ from: 0, to: 7 });
	});

	it("starts a new bed when the place changes", () => {
		const beds = ambienceBeds([
			shot({ index: 0, location: "a platform", durationSeconds: 4 }),
			shot({ index: 1, location: "the street", durationSeconds: 3 }),
		]);
		expect(beds).toHaveLength(2);
		expect(beds[1].from).toBe(4);
	});

	it("returns to a bed when the film returns to a place", () => {
		const beds = ambienceBeds([
			shot({ index: 0, location: "a platform", durationSeconds: 2 }),
			shot({ index: 1, location: "the street", durationSeconds: 2 }),
			shot({ index: 2, location: "a platform", durationSeconds: 2 }),
		]);
		expect(beds).toHaveLength(3);
	});

	it("suggests something that belongs to the place", () => {
		expect(ambienceBeds([shot({ location: "a harbour wall" })])[0].suggestion).toMatch(
			/gulls|swell/,
		);
		expect(ambienceBeds([shot({ location: "a station platform" })])[0].suggestion).toMatch(
			/rail|tannoy/,
		);
	});
});

describe("effectCues", () => {
	it("reads a cue off the action's verbs", () => {
		expect(effectCues([shot({ index: 0, action: "she unfolds the letter" })])).toEqual([
			{ sceneIndex: 0, cue: "paper handled, unfolded" },
		]);
	});

	it("gives at most one cue per shot", () => {
		// Four effects stacked on one shot is a mix problem, not a richer track.
		const out = effectCues([
			shot({ index: 0, action: "she opens the door and runs into the rain" }),
		]);
		expect(out).toHaveLength(1);
	});

	it("says nothing about an action with no sound in it", () => {
		expect(effectCues([shot({ action: "she considers" })])).toEqual([]);
	});
});

describe("musicMood", () => {
	it("reads the world before the scenes", () => {
		expect(musicMood([shot({})], "a noir crime story")).toMatch(/tense/);
	});

	it("falls back to something usable", () => {
		expect(musicMood([])).toBeTruthy();
	});
});

describe("estimateCost", () => {
	it("says so when there is nothing to run", () => {
		expect(estimateCost([]).summary).toBe("Nothing to run.");
	});

	it("counts images and text calls separately", () => {
		const out = estimateCost([
			node("c", "character"),
			node("s1", "scene"),
			node("s2", "scene"),
			node("st", "story"),
		]);
		expect(out.imageCalls).toBe(3);
		expect(out.textCalls).toBe(1);
	});

	it("prices images at the configured rate", () => {
		expect(estimateCost([node("s", "scene")]).usd).toBe(DEFAULT_IMAGE_USD);
		expect(estimateCost([node("s", "scene")], { image: 1 }).usd).toBe(1);
	});

	it("ignores nodes that cost nothing", () => {
		// Beats and references are text the user typed; counting them would
		// inflate every estimate.
		expect(estimateCost([node("b", "beat"), node("r", "reference")]).imageCalls).toBe(0);
		expect(estimateCost([node("b", "beat")]).summary).toBe("Nothing to run.");
	});

	it("reads as a sentence a person can act on", () => {
		expect(estimateCost([node("s", "scene"), node("st", "story")]).summary).toMatch(
			/1 image and 1 text call — about \$0\.0\d/,
		);
	});
});
