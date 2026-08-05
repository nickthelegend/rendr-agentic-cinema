// Rendering a scene, and landing it on the timeline.
//
// This is the seam between the generative half and the editor, and it is the
// thing that makes this a project rather than a pile of clips. A scene does not
// become a file you download; it becomes a clip on a timeline with 101 tools
// over it, so a shot that came out nearly right is four seconds of trimming
// instead of a prompt rewritten ten times.
//
// Veo is not reachable on a consumer plan, so a scene is a generated still with
// a camera move over it. The move is not a consolation prize — a slow push on a
// held frame is a real shot, and the timeline already animates it through the
// same keyframes a hand edit would use.

import { sceneReference, sheetsFor } from "./character";
import type { CinemaGraph, SceneSpec } from "./nodes";
import type { CinemaProvider, ImageBytes } from "./provider";

export interface RenderedScene {
	spec: SceneSpec;
	image: ImageBytes;
	prompt: string;
	seed?: number;
	model: string;
	elapsedMs: number;
}

/**
 * The prompt for one shot.
 *
 * Order matters. The camera goes first because it frames everything after it,
 * the action next, then who is in it, then the world, then the craft words. The
 * character line is deliberately short — the sheet is attached, and repeating a
 * full description beside a photograph gives the model two sources for one face
 * and lets the words win.
 */
export function buildScenePrompt(graph: CinemaGraph, spec: SceneSpec, world?: string): string {
	const cast = spec.characterIds
		.map((id) => graph.nodes.find((node) => node.id === id))
		.filter((node): node is NonNullable<typeof node> => Boolean(node))
		.map((node) => sceneReference(node));

	return [
		`${spec.camera}.`,
		spec.action,
		cast.length ? `In frame: ${cast.join("; ")}.` : null,
		`${spec.location}, ${spec.timeOfDay}.`,
		world ? world : null,
		"Cinematic still, filmic colour, natural light, shallow depth of field. No text, no watermark, no border.",
	]
		.filter(Boolean)
		.join(" ");
}

export async function renderScene(
	provider: CinemaProvider,
	graph: CinemaGraph,
	spec: SceneSpec,
	options: { world?: string; aspect?: "16:9" | "9:16" | "1:1" | "4:5"; seed?: number } = {},
): Promise<RenderedScene> {
	const prompt = buildScenePrompt(graph, spec, options.world);
	// One view per character, which is what stops a three-hander arriving with
	// twelve images and the model averaging the faces.
	const references = sheetsFor(graph, spec.characterIds);

	const shot = await provider.image({
		prompt,
		references,
		aspect: options.aspect ?? "16:9",
		seed: options.seed,
	});

	return {
		spec,
		image: shot.image,
		prompt,
		seed: shot.seed,
		model: shot.model,
		elapsedMs: shot.elapsedMs,
	};
}

/**
 * A camera move for a shot, chosen from what the shot is.
 *
 * Not random. A close-up drifts because a push on a face is aggressive; a wide
 * pushes in because a static wide is a postcard. Deriving it from the framing
 * means a cut has variety without anyone choosing per shot, and means two
 * identical framings in a row still move differently.
 */
export function moveFor(spec: SceneSpec): {
	direction: "in" | "out" | "left" | "right" | "up" | "down";
	amount: number;
} {
	const framing = spec.camera.toLowerCase();
	if (/close|macro|detail/.test(framing)) {
		// Alternating by index so consecutive close-ups do not drift the same way.
		return { direction: spec.index % 2 === 0 ? "left" : "right", amount: 0.06 };
	}
	if (/wide|establish|aerial|landscape/.test(framing)) {
		return { direction: "in", amount: 0.14 };
	}
	if (/track|follow|dolly|pan/.test(framing)) {
		return { direction: spec.index % 2 === 0 ? "right" : "left", amount: 0.12 };
	}
	if (/low|up at|looking up/.test(framing)) return { direction: "up", amount: 0.09 };
	return { direction: spec.index % 3 === 0 ? "out" : "in", amount: 0.1 };
}

/**
 * The tool calls that put a rendered scene on the timeline.
 *
 * Returned as a plan rather than executed, for two reasons. It can be tested
 * without an editor, and it is the same list of public MCP tools an agent would
 * call — so nothing here can do something an agent could not.
 */
export interface TimelinePlan {
	tool: string;
	args: Record<string, unknown>;
	/** What this step is for, in words, for the run log. */
	why: string;
}

export function planTimelinePlacement(
	scenes: readonly RenderedScene[],
	options: { fps: number; startFrame?: number; trackIndex?: number } = { fps: 30 },
): TimelinePlan[] {
	const fps = options.fps || 30;
	const plans: TimelinePlan[] = [];
	let cursor = Math.max(0, Math.round(options.startFrame ?? 0));

	for (const scene of scenes) {
		const frames = Math.max(1, Math.round(scene.spec.durationSeconds * fps));
		const name = `Scene ${scene.spec.index + 1}`;

		plans.push({
			tool: "import_media",
			args: {
				source: { bytes: scene.image.base64, mimeType: scene.image.mimeType },
				name,
			},
			why: `${name} enters the library as a still.`,
		});
		plans.push({
			tool: "add_clips",
			args: {
				entries: [
					{
						mediaRef: `$${name}`,
						startFrame: cursor,
						endFrame: cursor + frames,
						...(options.trackIndex !== undefined
							? { trackIndex: options.trackIndex }
							: {}),
					},
				],
			},
			why: `Laid at ${(cursor / fps).toFixed(1)}s for ${scene.spec.durationSeconds}s.`,
		});

		const move = moveFor(scene.spec);
		plans.push({
			tool: "add_ken_burns",
			args: { clipIds: [`$clip:${name}`], direction: move.direction, amount: move.amount },
			why: `A ${move.direction} move, because the shot is "${scene.spec.camera}".`,
		});

		if (scene.spec.dialogue) {
			// Dialogue becomes a timeline note, which is what narrate_timeline
			// speaks and what the caption track is cut from. It arrives as an
			// editable line rather than burnt into the picture.
			plans.push({
				tool: "manage_comments",
				args: { action: "add", frame: cursor + 2, text: scene.spec.dialogue },
				why: "Dialogue pinned for narration and subtitles.",
			});
		}

		cursor += frames;
	}

	return plans;
}

/** How long the planned cut runs, so the UI can say before it commits. */
export function plannedDuration(scenes: readonly RenderedScene[]): number {
	return Number(
		scenes.reduce((total, scene) => total + scene.spec.durationSeconds, 0).toFixed(1),
	);
}
