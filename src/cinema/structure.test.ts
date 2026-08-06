// Structure, coverage and pacing notes.
//
// These are the notes an editor gives, computed before anything is rendered.
// The bar for each is that it fires on the failure it names and stays quiet on
// a cut that is fine — a review that flags everything is a review nobody reads.

import { describe, expect, it } from "vitest";

import type { SceneSpec } from "./nodes";
import {
	coverageNotes,
	pacingNotes,
	reviewCut,
	runtimeSeconds,
	STRUCTURES,
	structureNamed,
	structureNotes,
} from "./structure";

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

/** A cut with contrast and varied lengths — the shape that should be quiet. */
const goodCut = (): SceneSpec[] => [
	shot({ index: 0, camera: "wide establishing", durationSeconds: 6 }),
	shot({ index: 1, camera: "medium, slow push", durationSeconds: 3 }),
	shot({ index: 2, camera: "close on her hands", durationSeconds: 2 }),
	shot({ index: 3, camera: "wide, static", durationSeconds: 5 }),
];

describe("the templates", () => {
	it("asks questions about this story rather than naming acts", () => {
		// "Act two" tells a writer nothing. Every beat should be answerable.
		for (const template of STRUCTURES) {
			expect(template.beats.length).toBeGreaterThan(2);
			for (const beat of template.beats) {
				expect(
					beat.split(/\s+/).length,
					`"${beat}" is a label, not a prompt`,
				).toBeGreaterThan(4);
			}
		}
	});

	it("finds a template by name, case-insensitively", () => {
		expect(structureNamed("three act")?.name).toBe("Three act");
		expect(structureNamed("Music Video")?.beats.length).toBeGreaterThan(0);
		expect(structureNamed("nonsense")).toBeUndefined();
	});
});

describe("coverageNotes", () => {
	it("says nothing about a cut with contrast", () => {
		expect(coverageNotes(goodCut())).toEqual([]);
	});

	it("stays quiet on a sequence too short to judge", () => {
		expect(coverageNotes([shot({ index: 0 }), shot({ index: 1 })])).toEqual([]);
	});

	it("catches a cut made entirely of one size", () => {
		const flat = [0, 1, 2, 3].map((index) => shot({ index, camera: "medium shot" }));
		const notes = coverageNotes(flat);
		expect(notes.some((note) => /same size/.test(note.message))).toBe(true);
	});

	it("catches a cut that never establishes", () => {
		const notes = coverageNotes([
			shot({ index: 0, camera: "close on her face" }),
			shot({ index: 1, camera: "medium" }),
			shot({ index: 2, camera: "extreme close on the ticket" }),
		]);
		expect(notes.some((note) => /establishes/.test(note.message))).toBe(true);
	});

	it("catches a cut that never gets close", () => {
		const notes = coverageNotes([
			shot({ index: 0, camera: "wide establishing" }),
			shot({ index: 1, camera: "medium" }),
			shot({ index: 2, camera: "wide" }),
		]);
		expect(notes.some((note) => /nothing to feel|Nothing is close/i.test(note.message))).toBe(
			true,
		);
	});

	it("catches a line spoken with nobody shown hearing it", () => {
		const notes = coverageNotes([
			shot({ index: 0, camera: "wide establishing", location: "a street" }),
			shot({ index: 1, camera: "close", location: "a platform", dialogue: "You kept it." }),
			shot({ index: 2, camera: "wide", location: "a field" }),
		]);
		const orphan = notes.find((note) => note.sceneIndex === 1);
		expect(orphan?.message).toMatch(/hearing it/);
	});

	it("does not flag a line that has a shot beside it in the same place", () => {
		const notes = coverageNotes([
			shot({ index: 0, camera: "wide establishing", location: "a platform" }),
			shot({ index: 1, camera: "close", location: "a platform", dialogue: "You kept it." }),
			shot({ index: 2, camera: "medium", location: "a platform" }),
		]);
		expect(notes.some((note) => /hearing it/.test(note.message))).toBe(false);
	});
});

describe("pacingNotes", () => {
	it("says nothing about a cut that breathes", () => {
		expect(pacingNotes(goodCut())).toEqual([]);
	});

	it("catches a metronome", () => {
		const same = [0, 1, 2, 3, 4].map((index) =>
			shot({ index, durationSeconds: 4, camera: index === 0 ? "wide" : "close" }),
		);
		expect(pacingNotes(same)[0].message).toMatch(/slideshow/);
	});

	it("catches a long held shot with no line in it", () => {
		const notes = pacingNotes([
			shot({ index: 0, durationSeconds: 2 }),
			shot({ index: 1, durationSeconds: 8 }),
			shot({ index: 2, durationSeconds: 3 }),
		]);
		expect(notes.find((note) => note.sceneIndex === 1)?.message).toMatch(/needs a reason/);
	});

	it("allows a long shot that carries dialogue", () => {
		// A held frame with a line in it is a performance, not a stall.
		const notes = pacingNotes([
			shot({ index: 0, durationSeconds: 2 }),
			shot({ index: 1, durationSeconds: 8, dialogue: "I waited." }),
			shot({ index: 2, durationSeconds: 3 }),
		]);
		expect(notes.some((note) => note.sceneIndex === 1)).toBe(false);
	});
});

describe("runtime", () => {
	it("adds the shots up", () => {
		expect(runtimeSeconds(goodCut())).toBe(16);
	});

	it("does not accumulate floating point noise", () => {
		const thirds = [0, 1, 2].map((index) => shot({ index, durationSeconds: 3.3 }));
		expect(runtimeSeconds(thirds)).toBe(9.9);
	});
});

describe("structureNotes", () => {
	it("says so when there is nothing yet", () => {
		expect(structureNotes([])[0].message).toMatch(/no shots/);
	});

	it("stays quiet without a target", () => {
		expect(structureNotes(goodCut())).toEqual([]);
	});

	it("allows a cut that lands near its target", () => {
		// 16s against 18s is a decomposition that did its job.
		expect(structureNotes(goodCut(), 18)).toEqual([]);
	});

	it("flags a cut that runs long, and says by how much", () => {
		const note = structureNotes(goodCut(), 8)[0];
		expect(note.message).toMatch(/long by 100%/);
	});

	it("flags a cut that runs short", () => {
		expect(structureNotes(goodCut(), 40)[0].message).toMatch(/short by/);
	});
});

describe("reviewCut", () => {
	it("returns nothing for a cut that is fine", () => {
		expect(reviewCut(goodCut(), 18)).toEqual([]);
	});

	it("gathers every kind of note at once", () => {
		const bad = [0, 1, 2, 3].map((index) =>
			shot({ index, camera: "medium", durationSeconds: 4 }),
		);
		const kinds = new Set(reviewCut(bad, 4).map((note) => note.kind));
		expect(kinds.has("coverage")).toBe(true);
		expect(kinds.has("rhythm")).toBe(true);
		expect(kinds.has("structure")).toBe(true);
	});
});
