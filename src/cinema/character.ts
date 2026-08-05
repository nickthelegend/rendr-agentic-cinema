// Locking a character.
//
// The one idea this file exists for: **the other angles are generated FROM the
// first one, not alongside it.**
//
// Generating four views from the same text prompt gives four different people
// who happen to match the description. Generating one view, then asking for the
// other three *with that image attached*, gives one person seen four times. The
// difference is not subtle and it is not a prompt-wording problem — it is
// sequencing, and it is why the character node is a lock rather than a
// generate.
//
// Everything downstream depends on it. A scene passes the sheet, not the words.

import { type CinemaGraph, type CinemaNode, inputsOf, type NodeOutput } from "./nodes";
import type { CinemaProvider, ImageBytes } from "./provider";

/** The four views a sheet locks. Front first — everything else references it. */
export const SHEET_ANGLES = [
	{
		key: "front",
		instruction: "facing the camera straight on, neutral expression, eyes to lens",
	},
	{ key: "three-quarter", instruction: "turned three-quarters to their left" },
	{ key: "profile", instruction: "in full profile, facing left" },
	{ key: "back", instruction: "from behind, head slightly turned" },
] as const;

export interface LockedCharacter {
	/** What the model was told, kept so a rerun reproduces and a human can read it. */
	description: string;
	/** Four views, front first. */
	sheet: ImageBytes[];
	seed: number;
	model: string;
	elapsedMs: number;
}

/**
 * Gathers what the wired-up ingredients say about this character.
 *
 * Traits are joined rather than summarised: the summary step is a model call
 * that can drop the one detail that mattered, and these are short enough that
 * there is nothing to gain by compressing them.
 */
export function gatherIngredients(
	graph: CinemaGraph,
	characterId: string,
): { traits: string[]; looks: string[]; references: ImageBytes[] } {
	const traits: string[] = [];
	const looks: string[] = [];
	const references: ImageBytes[] = [];

	for (const input of inputsOf(graph, characterId)) {
		if (input.kind === "trait" && input.text?.trim()) traits.push(input.text.trim());
		if (input.kind === "look") {
			if (input.text?.trim()) looks.push(input.text.trim());
			// A look can carry its own references and traits.
			for (const nested of inputsOf(graph, input.id)) {
				if (nested.kind === "trait" && nested.text?.trim()) looks.push(nested.text.trim());
			}
		}
		if (input.kind === "reference") {
			const bytes = input.params.image as ImageBytes | undefined;
			if (bytes?.base64) references.push(bytes);
		}
	}
	return { traits, looks, references };
}

/**
 * The canonical description.
 *
 * Written once and stored, because the alternative — rebuilding it per scene —
 * lets it drift by a word here and there, and a face is exactly the thing that
 * drifts when the words do.
 */
export async function writeDescription(
	provider: CinemaProvider,
	node: CinemaNode,
	ingredients: { traits: string[]; looks: string[] },
): Promise<{ text: string; model: string; elapsedMs: number }> {
	const said = [
		node.text?.trim(),
		...ingredients.traits,
		...ingredients.looks.map((look) => `wearing ${look}`),
	]
		.filter(Boolean)
		.join(". ");

	const result = await provider.text({
		system: "You write character descriptions for a film's casting sheet. One paragraph, concrete and visual: age, build, hair, face, skin, wardrobe. No backstory, no personality adjectives, no camera or lighting direction — those change per shot and must not be baked into the identity. Never invent a name.",
		prompt: `Write the casting description for this character.\n\n${said || "An ordinary person."}`,
		temperature: 0.4,
	});
	return { text: result.text.trim(), model: result.model, elapsedMs: result.elapsedMs };
}

/**
 * Generates the sheet.
 *
 * Front view first, from the description plus whatever reference images were
 * wired in. Then each remaining angle with the front view attached — that
 * attachment is the entire consistency mechanism.
 */
export async function lockCharacter(
	provider: CinemaProvider,
	description: string,
	references: ImageBytes[],
	options: { seed?: number } = {},
): Promise<LockedCharacter> {
	const started = Date.now();
	// A stable seed so a rerun of an unchanged character reproduces rather than
	// recasting. Derived from the description, so editing the description is
	// what recasts — which is the behaviour a person expects.
	const seed = options.seed ?? seedFrom(description);

	const [front, ...rest] = SHEET_ANGLES;
	const frontShot = await provider.image({
		prompt: `Full-body character reference photograph. ${description}\n\nThe subject is ${front.instruction}. Plain mid-grey studio backdrop, even soft lighting, sharp focus, no props, no text.`,
		references,
		aspect: "4:5",
		seed,
	});

	const sheet: ImageBytes[] = [frontShot.image];
	for (const angle of rest) {
		// The front view goes in as a reference on every subsequent angle. Without
		// it these come back as four different people who match the description.
		const shot = await provider.image({
			prompt: `The exact same person as the attached reference photograph, unchanged in face, hair, build and wardrobe. Now shown ${angle.instruction}. Same plain mid-grey studio backdrop, same lighting, same lens.`,
			references: [frontShot.image, ...references],
			aspect: "4:5",
			seed,
		});
		sheet.push(shot.image);
	}

	return {
		description,
		sheet,
		seed,
		model: frontShot.model,
		elapsedMs: Date.now() - started,
	};
}

/**
 * A seed from the text, so the same description always casts the same face.
 *
 * FNV-1a: short, stable across runs and platforms, and — unlike hashing an id —
 * it means duplicating a character node with the same description gets you the
 * same person rather than a stranger.
 */
export function seedFrom(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	// Positive and inside the range providers accept.
	return Math.abs(hash) % 2_147_483_647;
}

/**
 * The line a scene puts in its prompt for a character that is in frame.
 *
 * Deliberately short. The sheet carries the likeness; repeating the full
 * description alongside it gives the model two sources for the same thing and
 * lets the words win over the picture, which is the drift this all exists to
 * prevent.
 */
export function sceneReference(node: CinemaNode): string {
	const name = node.label?.trim() || "the character";
	return `${name}, exactly as in the attached reference sheet`;
}

/** The sheet images a scene should attach for the characters present. */
export function sheetsFor(graph: CinemaGraph, characterIds: string[]): ImageBytes[] {
	const out: ImageBytes[] = [];
	for (const id of characterIds) {
		const node = graph.nodes.find((entry) => entry.id === id);
		const sheet = node?.output?.sheet;
		// Front view only, per character. Attaching four views each means a
		// three-hander arrives with twelve images and the model starts averaging
		// them; the front view is the one that carries identity.
		if (sheet?.[0]) out.push(sheet[0]);
	}
	return out;
}

/** What a locked character writes back onto its node. */
export function toNodeOutput(locked: LockedCharacter): NodeOutput {
	return {
		text: locked.description,
		sheet: locked.sheet,
		seed: locked.seed,
		model: locked.model,
		elapsedMs: locked.elapsedMs,
	};
}
