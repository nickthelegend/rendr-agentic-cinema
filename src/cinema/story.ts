// Turning a story into scenes, and checking the result holds together.
//
// The decomposition is a schema call, not a prose call. Asking a model to
// "write me some scenes" gets prose that reads well and quietly omits which
// character is in frame — and the omission is invisible until eleven shots
// later when the wrong person is in one. Naming every field forces the model to
// answer for each, and lets the answers be checked afterwards.
//
// Checking afterwards is the other half. Continuity is not something a single
// generation call can be trusted to maintain, because nothing in it compares
// scene four to scene three. So it is verified across the finished set, and
// what fails is reported rather than silently rendered.

import type { CinemaNode, SceneSpec } from "./nodes";
import type { CinemaProvider } from "./provider";

/**
 * The contract. Every field is required on purpose — an optional field is one
 * the model will omit on the shot where it mattered most.
 */
export const SCENE_SCHEMA = {
	type: "object",
	properties: {
		scenes: {
			type: "array",
			items: {
				type: "object",
				properties: {
					beatId: { type: "string" },
					characterNames: {
						type: "array",
						items: { type: "string" },
						description: "Exactly the characters visible in frame. Empty if none.",
					},
					location: { type: "string" },
					timeOfDay: { type: "string" },
					camera: {
						type: "string",
						description:
							"Shot size and movement — 'wide, static', 'close on her hands'.",
					},
					action: { type: "string", description: "One action. Not a paragraph." },
					dialogue: { type: "string" },
					durationSeconds: { type: "number" },
				},
				required: [
					"characterNames",
					"location",
					"timeOfDay",
					"camera",
					"action",
					"durationSeconds",
				],
			},
		},
	},
	required: ["scenes"],
} as const;

const SYSTEM = `You are a director breaking a story into shots.

Rules:
- One action per scene. If a beat contains two actions, it is two scenes.
- Name only characters actually visible in frame. A character being discussed is not in frame.
- Carry continuity forward: if a scene is at night, the next is at night unless the story says time passed.
- Vary shot size. A run of identical framings is what makes generated film look generated.
- Use only the character names given. Never invent a character.
- durationSeconds is 2 to 8. Most shots are 3 to 5.`;

export interface DecomposeInput {
	beats: Array<{ id: string; text: string }>;
	/** Characters available to cast, by node id and the name the user gave. */
	cast: Array<{ id: string; name: string }>;
	world?: string;
	/** Roughly how long the finished film should be. */
	targetSeconds?: number;
}

export interface DecomposeResult {
	scenes: SceneSpec[];
	model: string;
	elapsedMs: number;
	/** Names the model used that are not in the cast. */
	unknownCharacters: string[];
}

export async function decomposeStory(
	provider: CinemaProvider,
	input: DecomposeInput,
): Promise<DecomposeResult> {
	if (input.beats.length === 0) {
		throw new Error("Nothing to decompose — the story has no beats.");
	}

	const cast = input.cast.map((entry) => entry.name).filter(Boolean);
	const prompt = [
		input.world ? `The world: ${input.world}` : null,
		cast.length ? `The cast: ${cast.join(", ")}.` : "There is no cast; these are empty shots.",
		input.targetSeconds ? `Aim for about ${input.targetSeconds} seconds in total.` : null,
		"",
		"The beats, in order:",
		...input.beats.map((beat, index) => `${index + 1}. [${beat.id}] ${beat.text}`),
		"",
		"Break these into shots. Reference each shot's beat by the id in brackets.",
	]
		.filter((line) => line !== null)
		.join("\n");

	const result = await provider.text({
		system: SYSTEM,
		prompt,
		schema: SCENE_SCHEMA as unknown as Record<string, unknown>,
		temperature: 0.7,
	});

	return { ...parseScenes(result.text, input), model: result.model, elapsedMs: result.elapsedMs };
}

/**
 * Reads the model's answer into scene specs.
 *
 * Separated from the call so it can be tested against real malformed output
 * without spending a request, which is most of what goes wrong here.
 */
export function parseScenes(
	raw: string,
	input: DecomposeInput,
): { scenes: SceneSpec[]; unknownCharacters: string[] } {
	let payload: { scenes?: unknown };
	try {
		payload = JSON.parse(raw) as { scenes?: unknown };
	} catch {
		throw new Error("The decomposition did not come back as JSON.");
	}
	const rows = Array.isArray(payload.scenes) ? payload.scenes : [];
	if (rows.length === 0) throw new Error("The decomposition produced no scenes.");

	// Names are matched case-insensitively and trimmed: a model that writes
	// "Mira " or "mira" means the character called "Mira", and dropping it
	// would silently empty the frame.
	const byName = new Map(input.cast.map((entry) => [entry.name.trim().toLowerCase(), entry.id]));
	const beatIds = new Set(input.beats.map((beat) => beat.id));
	const unknown = new Set<string>();

	const scenes: SceneSpec[] = [];
	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		const entry = row as Record<string, unknown>;
		const names = Array.isArray(entry.characterNames)
			? entry.characterNames.filter((name): name is string => typeof name === "string")
			: [];

		const characterIds: string[] = [];
		for (const name of names) {
			const id = byName.get(name.trim().toLowerCase());
			if (id) characterIds.push(id);
			else unknown.add(name);
		}

		const beatId = typeof entry.beatId === "string" ? entry.beatId : undefined;
		scenes.push({
			id: `sc-${scenes.length + 1}-${Math.random().toString(36).slice(2, 7)}`,
			// A beat id the model invented is worse than none: it would make an
			// edit to a real beat fail to invalidate this scene.
			...(beatId && beatIds.has(beatId) ? { beatId } : {}),
			index: scenes.length,
			characterIds,
			location: String(entry.location ?? "").trim() || "unspecified",
			timeOfDay: String(entry.timeOfDay ?? "").trim() || "day",
			camera: String(entry.camera ?? "").trim() || "medium, static",
			action: String(entry.action ?? "").trim(),
			...(typeof entry.dialogue === "string" && entry.dialogue.trim()
				? { dialogue: entry.dialogue.trim() }
				: {}),
			durationSeconds: clampDuration(entry.durationSeconds),
		});
	}

	if (scenes.length === 0) throw new Error("No usable scenes in the decomposition.");
	return { scenes, unknownCharacters: [...unknown] };
}

/** 2–8 seconds. A shot outside that is a mistake, not a style choice. */
function clampDuration(value: unknown): number {
	const seconds = typeof value === "number" && Number.isFinite(value) ? value : 4;
	return Math.min(8, Math.max(2, Math.round(seconds * 10) / 10));
}

export interface ContinuityIssue {
	sceneIndex: number;
	kind: "time-jump" | "location-thrash" | "empty-frame" | "no-action" | "monotony";
	message: string;
}

/**
 * What does not hold together across the finished set.
 *
 * Deliberately run after decomposition rather than asked for during it. A model
 * generating scene four has no mechanism for comparing it to scene three; it
 * can only be told to be consistent and hope. Comparing is cheap, needs no
 * model call, and catches the things that actually spoil a cut.
 */
export function checkContinuity(scenes: readonly SceneSpec[]): ContinuityIssue[] {
	const issues: ContinuityIssue[] = [];

	for (const [index, scene] of scenes.entries()) {
		if (!scene.action) {
			issues.push({
				sceneIndex: index,
				kind: "no-action",
				message: `Scene ${index + 1} has no action, so there is nothing to render.`,
			});
		}
		if (
			scene.characterIds.length === 0 &&
			!/establish|landscape|empty|exterior/i.test(scene.location)
		) {
			issues.push({
				sceneIndex: index,
				kind: "empty-frame",
				message: `Scene ${index + 1} has nobody in frame. Fine for an establishing shot, wrong otherwise.`,
			});
		}
		if (index === 0) continue;

		const previous = scenes[index - 1];
		// Night to day and back inside one cut is the continuity error a viewer
		// notices without being able to say why.
		const wasNight = /night|dusk|evening|dark/i.test(previous.timeOfDay);
		const isNight = /night|dusk|evening|dark/i.test(scene.timeOfDay);
		if (wasNight !== isNight && previous.location === scene.location) {
			issues.push({
				sceneIndex: index,
				kind: "time-jump",
				message: `Scene ${index + 1} jumps from ${previous.timeOfDay} to ${scene.timeOfDay} in the same location.`,
			});
		}
		// A → B → A across three shots reads as a mistake unless it is a
		// deliberate cross-cut, and a decomposition rarely means it.
		if (
			index >= 2 &&
			scene.location === scenes[index - 2].location &&
			scene.location !== previous.location
		) {
			issues.push({
				sceneIndex: index,
				kind: "location-thrash",
				message: `Scenes ${index - 1}–${index + 1} bounce ${scene.location} → ${previous.location} → ${scene.location}.`,
			});
		}
	}

	// A run of identical framings is what makes generated film look generated.
	const framings = scenes.map((scene) => scene.camera.split(/[,;]/)[0].trim().toLowerCase());
	let run = 1;
	for (let i = 1; i < framings.length; i++) {
		run = framings[i] === framings[i - 1] ? run + 1 : 1;
		if (run === 3) {
			issues.push({
				sceneIndex: i,
				kind: "monotony",
				message: `Three shots in a row are "${framings[i]}". Vary the framing.`,
			});
		}
	}
	return issues;
}

/** Names the story can cast, taken from the character nodes wired into it. */
export function castFrom(nodes: readonly CinemaNode[]): Array<{ id: string; name: string }> {
	return nodes
		.filter((node) => node.kind === "character")
		.map((node, index) => ({
			id: node.id,
			// A character with no label still needs a handle the model can use.
			name: node.label?.trim() || `Character ${index + 1}`,
		}));
}
