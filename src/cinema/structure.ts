// Story structure, coverage, and pacing.
//
// The decomposition already turns beats into shots. What it cannot do is tell
// you that your film is nine consecutive medium shots, that the second act is
// four seconds long, or that you have written a conversation and never cut to
// the person listening. Those are the notes an editor gives, and they are all
// computable from the scene specs.
//
// Everything here reads a finished scene list and returns advice. Nothing
// mutates, nothing calls a model, and nothing costs anything — which is the
// point: the expensive part is rendering, so every judgement that can be made
// before rendering should be.

import { sizeFromCamera } from "./craft";
import type { SceneSpec } from "./nodes";

export interface StructureTemplate {
	name: string;
	summary: string;
	/** Beat prompts, in order. Each becomes a Beat node. */
	beats: string[];
}

/**
 * Templates, as beat prompts rather than finished beats.
 *
 * Each line is a question about *this* story, not a label. "Act two" tells a
 * writer nothing; "the thing they wanted turns out to cost more than they
 * thought" is a prompt you can answer. The model answers better for the same
 * reason.
 */
export const STRUCTURES: StructureTemplate[] = [
	{
		name: "Three act",
		summary: "The default shape. Setup, complication, resolution.",
		beats: [
			"The ordinary world, and the one thing wrong with it.",
			"The event that makes the ordinary world impossible to stay in.",
			"The first attempt, which half works.",
			"The complication that makes the first attempt useless.",
			"The lowest point, where the original plan is gone.",
			"The choice made from the lowest point.",
			"The consequence of that choice, and what it cost.",
		],
	},
	{
		name: "Short film",
		summary: "Five shots. One idea, one turn, one image you remember.",
		beats: [
			"An image that establishes the world without explaining it.",
			"The character doing the thing they always do.",
			"The small break in the pattern.",
			"The moment the break becomes irreversible.",
			"The last image, which reframes the first.",
		],
	},
	{
		name: "Advertisement",
		summary: "Thirty seconds. Problem, product, proof, payoff.",
		beats: [
			"A person in a small, recognisable frustration.",
			"The moment the frustration peaks.",
			"The product, used, without ceremony.",
			"The same person, the frustration gone, doing something better.",
			"The logo alone on a plain field, held a beat longer than is comfortable.",
		],
	},
	{
		name: "Music video",
		summary: "Performance intercut with a thread that does not explain itself.",
		beats: [
			"Performance, wide enough to show the whole space at once.",
			"The narrative thread begins somewhere else entirely.",
			"Performance, close on one detail — hands, a mouth, a string.",
			"The narrative thread turns, and stops being decorative.",
			"Both threads in the same frame for the first time.",
			"Performance, wide again, but the space has changed.",
		],
	},
	{
		name: "Documentary",
		summary: "A place, the people in it, and what is changing.",
		beats: [
			"The landscape, before anyone is in it.",
			"The work in progress, close on hands and the tools they hold.",
			"A face, listening rather than speaking.",
			"The detail that shows what is being lost.",
			"The landscape again, with the work in it.",
		],
	},
];

export const structureNamed = (name: string): StructureTemplate | undefined =>
	STRUCTURES.find((entry) => entry.name.toLowerCase() === name.toLowerCase());

export interface Note {
	/** Scene it concerns. Absent when the note is about the film as a whole. */
	sceneIndex?: number;
	kind: "coverage" | "pacing" | "rhythm" | "structure";
	message: string;
}

/**
 * Shot sizes that are missing from a sequence that needs them.
 *
 * The classic failure of generated coverage: every shot is a medium, because
 * "medium" is what a model writes when it has no opinion. A scene cut entirely
 * from one size has no grammar — nothing establishes, nothing lands.
 */
export function coverageNotes(scenes: SceneSpec[]): Note[] {
	if (scenes.length < 3) return [];
	const sizes = scenes.map((scene) => sizeFromCamera(scene.camera));
	const notes: Note[] = [];

	const distinct = new Set(sizes.filter(Boolean));
	if (distinct.size === 1) {
		notes.push({
			kind: "coverage",
			message: `Every shot is the same size (${[...distinct][0]}). A cut needs contrast — try opening wide and landing close.`,
		});
	}

	const hasWide = sizes.some(
		(size) => size === "wide" || size === "establishing" || size === "aerial",
	);
	if (!hasWide) {
		notes.push({
			kind: "coverage",
			message:
				"Nothing establishes. Without one wide shot the audience never learns where they are.",
		});
	}

	const hasClose = sizes.some((size) => size === "close" || size === "extreme");
	if (!hasClose) {
		notes.push({
			kind: "coverage",
			message: "Nothing is close. Without one close shot there is nothing to feel.",
		});
	}

	// Dialogue with no reverse: someone speaks and we never see who hears it.
	const speaking = scenes.filter((scene) => scene.dialogue?.trim());
	for (const scene of speaking) {
		const neighbours = scenes.filter(
			(other) =>
				other.index !== scene.index &&
				Math.abs(other.index - scene.index) === 1 &&
				other.location === scene.location,
		);
		if (neighbours.length === 0) {
			notes.push({
				sceneIndex: scene.index,
				kind: "coverage",
				message:
					"A line is spoken with no shot beside it in the same place — nobody is shown hearing it.",
			});
		}
	}

	return notes;
}

/**
 * Whether the cut has a rhythm or a metronome.
 *
 * Identical shot lengths are the tell of a generated edit. Real cuts breathe:
 * they hold, then quicken. Measured as the spread of durations rather than a
 * rule about any one shot, because a run of equal shorts is a montage and a run
 * of equal longs is a slideshow, and only the sameness is wrong.
 */
export function pacingNotes(scenes: SceneSpec[]): Note[] {
	if (scenes.length < 3) return [];
	const notes: Note[] = [];
	const durations = scenes.map((scene) => scene.durationSeconds);
	const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
	const spread = Math.sqrt(
		durations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / durations.length,
	);

	if (spread < 0.35) {
		notes.push({
			kind: "rhythm",
			message: `Every shot is about ${mean.toFixed(1)}s. A cut with no variation in length reads as a slideshow.`,
		});
	}

	for (const scene of scenes) {
		if (scene.durationSeconds >= 7.5 && !scene.dialogue) {
			notes.push({
				sceneIndex: scene.index,
				kind: "pacing",
				message: `${scene.durationSeconds}s on a shot with no line in it. A held frame needs a reason.`,
			});
		}
	}

	return notes;
}

/** Total runtime, which is the number people actually ask for. */
export const runtimeSeconds = (scenes: SceneSpec[]): number =>
	Number(scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0).toFixed(1));

/**
 * Whether the film is the length it was asked to be.
 *
 * Within 20%: a decomposition that lands at 26 seconds against a 30-second
 * target has done its job, and a note about it is noise.
 */
export function structureNotes(scenes: SceneSpec[], targetSeconds?: number): Note[] {
	const notes: Note[] = [];
	if (scenes.length === 0) {
		return [{ kind: "structure", message: "There are no shots yet." }];
	}
	if (!targetSeconds) return notes;

	const actual = runtimeSeconds(scenes);
	const drift = (actual - targetSeconds) / targetSeconds;
	if (Math.abs(drift) > 0.2) {
		notes.push({
			kind: "structure",
			message:
				`The cut runs ${actual}s against a ${targetSeconds}s target — ` +
				`${drift > 0 ? "long" : "short"} by ${Math.abs(Math.round(drift * 100))}%.`,
		});
	}
	return notes;
}

/** Everything an editor would say about this cut, before a frame is rendered. */
export function reviewCut(scenes: SceneSpec[], targetSeconds?: number): Note[] {
	return [
		...structureNotes(scenes, targetSeconds),
		...coverageNotes(scenes),
		...pacingNotes(scenes),
	];
}
