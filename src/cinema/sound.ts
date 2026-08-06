// Sound, and what a shot costs.
//
// The editor already speaks — there is a narration engine and a caption track
// cut from it. What was missing is anything that decides *what* to say, who
// says it, and where the room tone goes. All of that is derivable from the
// scene specs, which means it can be planned before a frame is rendered and
// costs nothing to change.
//
// The cost estimate lives here for the same reason: it is arithmetic over the
// same specs, and the one number everybody wants before pressing a button that
// spends money.

import type { CinemaGraph, CinemaNode, SceneSpec } from "./nodes";

/**
 * Voices, described rather than named.
 *
 * Named voices tie the film to whatever engine is installed. A description
 * survives the engine changing, and reads better in a cast list.
 */
export const VOICES = {
	warm: "warm, unhurried, mid-range",
	dry: "dry, clipped, slightly bored",
	bright: "bright, quick, forward",
	low: "low, gravelled, close to the mic",
	young: "young, light, a little breathless",
	formal: "formal, measured, broadcast",
} as const;
export type VoiceName = keyof typeof VOICES;

export interface Line {
	sceneIndex: number;
	/** Character node id, or absent for narration in the film's own voice. */
	characterId?: string;
	speaker: string;
	text: string;
	/** Seconds into the cut. */
	at: number;
	/** How long the line has before the shot cuts. */
	within: number;
}

/** Roughly how long a line takes to say. Two and a half words a second. */
export const WORDS_PER_SECOND = 2.5;
export const speechSeconds = (text: string): number =>
	Number((text.trim().split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND).toFixed(2));

/**
 * Every spoken line in the cut, with where it lands and how much room it has.
 *
 * The `within` field is the useful one. A four-word line in a two-second shot
 * is fine; a thirty-word line in the same shot is a note nobody gave you, and
 * the timeline will happily let the caption run past the cut.
 */
export function lines(graph: CinemaGraph, scenes: SceneSpec[]): Line[] {
	const nameOf = (id: string): string => {
		const node = graph.nodes.find((entry) => entry.id === id);
		return node?.label ?? node?.text?.split(/[,.]/)[0] ?? "Someone";
	};

	const out: Line[] = [];
	let at = 0;
	for (const scene of [...scenes].sort((a, b) => a.index - b.index)) {
		const text = scene.dialogue?.trim();
		if (text) {
			// Attributed to whoever is in frame. With nobody in frame it is
			// narration, which is a different thing and reads as one.
			const who = scene.characterIds[0];
			out.push({
				sceneIndex: scene.index,
				characterId: who,
				speaker: who ? nameOf(who) : "Narrator",
				text,
				at: Number(at.toFixed(2)),
				within: scene.durationSeconds,
			});
		}
		at += scene.durationSeconds;
	}
	return out;
}

/** Lines that will not fit in the shot they belong to. */
export function overrunningLines(all: Line[]): Line[] {
	return all.filter((line) => speechSeconds(line.text) > line.within);
}

/**
 * Which voice each character should use.
 *
 * An explicit choice on the node wins; otherwise it is derived from the
 * description, and the derivation is deterministic so a cast does not
 * re-voice itself every time the graph runs.
 */
export function castVoices(
	graph: CinemaGraph,
): Array<{ id: string; name: string; voice: VoiceName }> {
	return graph.nodes
		.filter((node) => node.kind === "character")
		.map((node) => ({
			id: node.id,
			name: node.label ?? "Unnamed",
			voice: voiceFor(node),
		}));
}

export function voiceFor(node: CinemaNode): VoiceName {
	const chosen = node.params.voice;
	if (typeof chosen === "string" && chosen in VOICES) return chosen as VoiceName;

	const text = `${node.label ?? ""} ${node.text ?? ""}`.toLowerCase();
	if (/gravel|rasp|smoke|weathered|old|sixties|seventies/.test(text)) return "low";
	if (/young|teen|child|twenties|breathless/.test(text)) return "young";
	if (/tired|bored|flat|dry|clipped/.test(text)) return "dry";
	if (/officer|doctor|announcer|official|broadcast/.test(text)) return "formal";
	if (/quick|bright|eager|restless/.test(text)) return "bright";
	return "warm";
}

/**
 * Room tone, per location.
 *
 * One bed per place rather than per shot: a bed that restarts on every cut is
 * the single most recognisable sign of an amateur mix, and shots in the same
 * location should share one continuous ambience.
 */
export function ambienceBeds(
	scenes: SceneSpec[],
): Array<{ location: string; from: number; to: number; suggestion: string }> {
	const beds: Array<{ location: string; from: number; to: number; suggestion: string }> = [];
	let at = 0;
	for (const scene of [...scenes].sort((a, b) => a.index - b.index)) {
		const last = beds[beds.length - 1];
		if (last && last.location === scene.location) {
			last.to = Number((at + scene.durationSeconds).toFixed(2));
		} else {
			beds.push({
				location: scene.location,
				from: Number(at.toFixed(2)),
				to: Number((at + scene.durationSeconds).toFixed(2)),
				suggestion: ambienceFor(scene),
			});
		}
		at += scene.durationSeconds;
	}
	return beds;
}

function ambienceFor(scene: SceneSpec): string {
	const text = `${scene.location} ${scene.timeOfDay}`.toLowerCase();
	if (/street|city|road|traffic/.test(text)) return "distant traffic, occasional passing car";
	if (/sea|harbour|harbor|dock|coast|beach/.test(text))
		return "swell against stone, gulls, rigging";
	if (/rain|storm|monsoon/.test(text)) return "steady rain, water running off a gutter";
	if (/station|platform|train/.test(text)) return "rail hum, tannoy at the edge of hearing";
	if (/forest|wood|field|hill/.test(text)) return "wind in leaves, one bird, nothing else";
	if (/room|kitchen|office|indoor|interior/.test(text))
		return "room tone, a fridge, muffled outside";
	if (/night/.test(text)) return "low night air, one distant dog";
	return "quiet room tone";
}

/**
 * A sound cue for what physically happens in a shot.
 *
 * Read off the action's verbs. A generated film with no hard effects sounds
 * like a slideshow with music over it, and the verbs are already written down.
 */
export function effectCues(scenes: SceneSpec[]): Array<{ sceneIndex: number; cue: string }> {
	const RULES: Array<[RegExp, string]> = [
		[/\bdoor|opens|shuts|closes\b/, "door, close and latch"],
		[/\bfoot|walk|steps|runs|running\b/, "footsteps on the surface underfoot"],
		[/\bunfold|paper|letter|page|envelope\b/, "paper handled, unfolded"],
		[/\bphone|call|rings\b/, "phone, single ring, picked up"],
		[/\brain|water|splash\b/, "water, close"],
		[/\bcar|engine|drives\b/, "engine, approach and pass"],
		[/\btrain|whistle|departs\b/, "train departing, brakes releasing"],
		[/\bglass|cup|bottle|pour\b/, "glass set down, liquid poured"],
		[/\bmatch|light|cigarette|fire\b/, "match struck, catching"],
	];
	const out: Array<{ sceneIndex: number; cue: string }> = [];
	for (const scene of scenes) {
		const action = scene.action.toLowerCase();
		for (const [pattern, cue] of RULES) {
			if (pattern.test(action)) {
				out.push({ sceneIndex: scene.index, cue });
				// One cue per shot. A shot with four effects stacked on it is a
				// mix problem, not a richer soundtrack.
				break;
			}
		}
	}
	return out;
}

/** A mood tag for the score, from the world and the times of day. */
export function musicMood(scenes: SceneSpec[], world?: string): string {
	const text =
		`${world ?? ""} ${scenes.map((scene) => `${scene.location} ${scene.timeOfDay}`).join(" ")}`.toLowerCase();
	if (/noir|crime|chase|threat|dark/.test(text)) return "tense, low strings, no melody";
	if (/rain|grief|loss|winter|cold/.test(text)) return "sparse piano, long decay";
	if (/city|neon|club|party/.test(text)) return "pulse, synth, forward";
	if (/coast|sea|harbour|harbor|field|landscape/.test(text)) return "open, slow, air and space";
	if (/morning|bright|summer|warm/.test(text)) return "light, acoustic, unhurried";
	return "restrained, atmospheric, no melody";
}

export interface CostEstimate {
	imageCalls: number;
	textCalls: number;
	/** Rough USD. Absent when no rate is configured, rather than guessed as 0. */
	usd?: number;
	summary: string;
}

/** Published Gemini image pricing at the time of writing. Configurable. */
export const DEFAULT_IMAGE_USD = 0.039;
export const DEFAULT_TEXT_USD = 0.001;

/**
 * What a run will cost before it starts.
 *
 * The number everyone wants and nobody is shown. Counting only nodes that
 * actually need running, because "this will cost $2.40" for a graph that will
 * skip nine of its twelve nodes is worse than saying nothing.
 */
export function estimateCost(
	nodes: CinemaNode[],
	rates: { image?: number; text?: number } = {},
): CostEstimate {
	const imageCalls = nodes.filter(
		(node) => node.kind === "character" || node.kind === "scene",
	).length;
	const textCalls = nodes.filter((node) => node.kind === "story" || node.kind === "world").length;

	const image = rates.image ?? DEFAULT_IMAGE_USD;
	const text = rates.text ?? DEFAULT_TEXT_USD;
	const usd = imageCalls * image + textCalls * text;

	const parts: string[] = [];
	if (imageCalls) parts.push(`${imageCalls} image${imageCalls === 1 ? "" : "s"}`);
	if (textCalls) parts.push(`${textCalls} text call${textCalls === 1 ? "" : "s"}`);

	return {
		imageCalls,
		textCalls,
		usd: Number(usd.toFixed(3)),
		summary: parts.length
			? `${parts.join(" and ")} — about $${usd.toFixed(2)}`
			: "Nothing to run.",
	};
}
