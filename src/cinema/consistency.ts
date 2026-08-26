// The claim this project is actually making, expressed as data.
//
// "The same face across every shot" is the whole technical argument, and until
// now it was only ever true — never *shown*. This gathers, per character, the
// locked sheet and every frame that character appears in, so the claim can be
// looked at rather than believed.
//
// Pure, so it can be tested without a canvas and reused by an export later.

import type { CinemaGraph, SceneSpec } from "./nodes";

export interface Appearance {
	sceneIndex: number;
	/** The shot's own camera direction, so a face can be judged against framing. */
	camera: string;
	image?: { base64: string; mimeType: string };
}

export interface CastConsistency {
	id: string;
	name: string;
	/** The locked sheet: front, three-quarter, profile, back. */
	sheet: Array<{ base64: string; mimeType: string }>;
	/** Seed the sheet was locked with, when one was recorded. */
	seed?: number;
	appearances: Appearance[];
	/** Shots this character is in that have not rendered yet. */
	pending: number;
}

/**
 * Every character, their sheet, and every rendered frame they are in.
 *
 * Ordered by how much of the film each carries, because the lead is the one
 * whose consistency anybody actually checks — and a panel that opens on a
 * one-shot extra buries the argument it exists to make.
 */
export function castConsistency(graph: CinemaGraph): CastConsistency[] {
	const story = graph.nodes.find((node) => node.kind === "story");
	const specs: SceneSpec[] = story?.output?.scenes ?? [];

	// Scene nodes keyed by which shot they render, so an appearance can find the
	// picture that belongs to it.
	const frameFor = new Map<number, { base64: string; mimeType: string } | undefined>();
	graph.nodes
		.filter((node) => node.kind === "scene")
		.forEach((node, fallback) => {
			const which =
				typeof node.params.sceneIndex === "number" ? node.params.sceneIndex : fallback;
			// First one wins: two nodes pointing at the same shot is a duplicate,
			// and showing both would double-count the appearance.
			if (!frameFor.has(which)) frameFor.set(which, node.output?.sheet?.[0]);
		});

	return graph.nodes
		.filter((node) => node.kind === "character")
		.map((node) => {
			const appearances = specs
				.filter((spec) => spec.characterIds.includes(node.id))
				.map((spec) => ({
					sceneIndex: spec.index,
					camera: spec.camera,
					image: frameFor.get(spec.index),
				}))
				.sort((a, b) => a.sceneIndex - b.sceneIndex);

			return {
				id: node.id,
				name: node.label ?? node.text?.split(/[,.]/)[0] ?? "Unnamed",
				sheet: node.output?.sheet ?? [],
				seed: node.output?.seed,
				appearances: appearances.filter((entry) => entry.image),
				pending: appearances.filter((entry) => !entry.image).length,
			};
		})
		.sort((a, b) => b.appearances.length - a.appearances.length);
}

/**
 * One line summarising how well the claim is holding up.
 *
 * Deliberately says nothing about *quality* — no code here can judge whether
 * two pictures are the same person. It reports coverage, which is the honest
 * thing it does know, and leaves the looking to whoever is looking.
 */
export function consistencySummary(cast: CastConsistency[]): string {
	if (cast.length === 0) return "No characters in this film yet.";
	const locked = cast.filter((who) => who.sheet.length > 0).length;
	const shots = cast.reduce((sum, who) => sum + who.appearances.length, 0);
	if (shots === 0) {
		return locked
			? `${locked} of ${cast.length} locked. Render some scenes to see them held.`
			: "Nobody is locked yet. Render the cast first.";
	}
	return `${locked} of ${cast.length} locked, carried across ${shots} rendered shot${shots === 1 ? "" : "s"}.`;
}
