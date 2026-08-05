// Putting the finished scenes on the timeline.
//
// readyScenes is what the panel uses: which scenes have rendered, in the order
// the story asked for. commitToTimeline is the same placement expressed against
// an injectable target, which is how the ordering and the refusals are tested
// without an editor running — the panel does the real placement inline because
// it needs the editor's own reducer to build the clips.
//
// The last step, and the one that makes this a project rather than a folder of
// images: every scene becomes a clip on a real timeline with a camera move over
// it, so a shot that came out nearly right is a trim rather than a re-prompt.
//
// Ordered by the scene's own index rather than by node position, because the
// story decided the order and the canvas layout is only how someone chose to
// arrange the boxes.

import type { CinemaGraph, CinemaNode, SceneSpec } from "./nodes";
import { moveFor } from "./scene";

export interface CommitTarget {
	/** Turns bytes into a library asset. */
	importMedia: (files: readonly File[]) => Promise<Array<{ id: string; name: string }>>;
	/** Places clips. Mirrors the add_clips tool. */
	addClips: (entries: Array<Record<string, unknown>>) => void;
	/** Applies a camera move. Mirrors add_ken_burns. */
	kenBurns: (clipIds: string[], direction: string, amount: number) => void;
	/** Pins dialogue as a timeline note. */
	addComment: (frame: number, text: string) => void;
	/** Reads back the clip ids that landed, so the move can target them. */
	clipIdsAt: (startFrames: number[]) => string[];
	fps: number;
}

export interface CommitResult {
	placed: number;
	skipped: Array<{ index: number; why: string }>;
	durationSeconds: number;
}

function bytesToFile(base64: string, mimeType: string, name: string): File {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const extension = mimeType.includes("svg") ? "svg" : mimeType.includes("jpeg") ? "jpg" : "png";
	return new File([bytes], `${name}.${extension}`, { type: mimeType });
}

/**
 * Which scenes are ready to place.
 *
 * A scene node that has not run, or whose run failed, is skipped by name rather
 * than silently omitted — a cut that is quietly missing its third shot is worse
 * than one that says which shot is missing.
 */
export function readyScenes(
	graph: CinemaGraph,
): Array<{ node: CinemaNode; spec: SceneSpec; image: { base64: string; mimeType: string } }> {
	const story = graph.nodes.find((node) => node.kind === "story");
	const specs = story?.output?.scenes ?? [];

	return graph.nodes
		.filter((node) => node.kind === "scene")
		.map((node, fallbackIndex) => {
			const which =
				typeof node.params.sceneIndex === "number" ? node.params.sceneIndex : fallbackIndex;
			return { node, spec: specs[which], image: node.output?.sheet?.[0] };
		})
		.filter(
			(
				entry,
			): entry is {
				node: CinemaNode;
				spec: SceneSpec;
				image: { base64: string; mimeType: string };
			} => Boolean(entry.spec && entry.image),
		)
		.sort((a, b) => a.spec.index - b.spec.index);
}

export async function commitToTimeline(
	graph: CinemaGraph,
	target: CommitTarget,
): Promise<CommitResult> {
	const ready = readyScenes(graph);
	const skipped: Array<{ index: number; why: string }> = [];

	for (const node of graph.nodes.filter((entry) => entry.kind === "scene")) {
		if (!ready.some((entry) => entry.node.id === node.id)) {
			skipped.push({
				index: ready.length + skipped.length,
				why: `${node.label ?? "A scene"} has not rendered yet.`,
			});
		}
	}
	if (ready.length === 0) return { placed: 0, skipped, durationSeconds: 0 };

	// Imported in one call: the library dedupes and renames per batch, and a
	// file at a time would interleave with anything else importing.
	const files = ready.map((entry, index) =>
		bytesToFile(entry.image.base64, entry.image.mimeType, `Scene ${index + 1}`),
	);
	const assets = await target.importMedia(files);
	if (assets.length !== files.length) {
		return {
			placed: 0,
			skipped: [
				...skipped,
				{
					index: 0,
					why: `Only ${assets.length} of ${files.length} stills entered the library.`,
				},
			],
			durationSeconds: 0,
		};
	}

	const starts: number[] = [];
	const entries: Array<Record<string, unknown>> = [];
	let cursor = 0;
	for (const [index, entry] of ready.entries()) {
		const frames = Math.max(1, Math.round(entry.spec.durationSeconds * target.fps));
		starts.push(cursor);
		entries.push({
			mediaRef: assets[index].id,
			startFrame: cursor,
			endFrame: cursor + frames,
		});
		cursor += frames;
	}
	target.addClips(entries);

	// Read the ids back rather than guessing them: add_clips names clips after
	// the asset, and two scenes from one still would collide.
	const clipIds = target.clipIdsAt(starts);
	for (const [index, entry] of ready.entries()) {
		const clipId = clipIds[index];
		if (!clipId) continue;
		const move = moveFor(entry.spec);
		target.kenBurns([clipId], move.direction, move.amount);
		if (entry.spec.dialogue) {
			// A note, not burnt-in text: narrate_timeline speaks it and the
			// caption track is cut from it, so it stays editable.
			target.addComment(starts[index] + 2, entry.spec.dialogue);
		}
	}

	return {
		placed: ready.length,
		skipped,
		durationSeconds: Number((cursor / target.fps).toFixed(1)),
	};
}
