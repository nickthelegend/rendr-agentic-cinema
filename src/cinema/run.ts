// Running the graph.
//
// Walks the nodes in dependency order and executes the ones that need it. Two
// rules shape everything here:
//
// 1. **Only run what is stale.** A character that has not changed must not be
//    recast — its face would change, and every scene it appears in would stop
//    matching the ones already rendered. Skipping is not an optimisation, it is
//    what makes the cast stable.
//
// 2. **One node's failure is not the run's failure.** A safety block on scene
//    four should not throw away scenes one to three, which cost real money and
//    real time. The node fails, the run continues, and the report says what is
//    missing.

import { gatherIngredients, lockCharacter, toNodeOutput, writeDescription } from "./character";
import {
	type CinemaGraph,
	type CinemaNode,
	descendants,
	inputsOf,
	type NodeStatus,
	runOrder,
} from "./nodes";
import { type CinemaProvider, ProviderError } from "./provider";
import { renderScene } from "./scene";
import { castFrom, checkContinuity, decomposeStory } from "./story";

export interface RunOptions {
	/** Only these nodes and what they invalidate. Omit for the whole graph. */
	only?: string[];
	/** Re-run even nodes that are already ready. */
	force?: boolean;
	/**
	 * Called as each node changes state, with the graph as it now stands.
	 *
	 * The graph is passed rather than left to the caller to rebuild. A caller
	 * holding the graph from before the run and patching one status into it
	 * discards every output accumulated so far — which is exactly what happened:
	 * a completed run left every node reading "idle" because the last progress
	 * tick reset it to the starting state.
	 */
	onProgress?: (nodeId: string, status: NodeStatus, graph: CinemaGraph) => void;
	/**
	 * Every generative call, for the ledger. Called whether the node succeeded
	 * or failed — a rejected take is the most useful row in the table.
	 */
	onRecord?: (entry: LedgerEntry) => void;
	/** Refuse to start more work once this many have run. */
	maxGenerations?: number;
}

export interface LedgerEntry {
	nodeId: string;
	kind: string;
	model?: string;
	prompt?: string;
	seed?: number;
	elapsedMs: number;
	ok: boolean;
	error?: string;
	/** Classified, so "wait or pay" stays distinct from "reword it". */
	errorKind?: string;
}

export interface RunReport {
	graph: CinemaGraph;
	ran: string[];
	skipped: string[];
	failed: Array<{ nodeId: string; error: string }>;
	/** Continuity problems found across the decomposed scenes. */
	continuity: string[];
	elapsedMs: number;
	generations: number;
}

/** A node needs running when it has never produced, or its inputs moved. */
export function needsRun(node: CinemaNode, force: boolean): boolean {
	if (force) return true;
	if (node.status === "stale" || node.status === "failed") return true;
	return !node.output;
}

/**
 * Marks a node and everything downstream of it as stale.
 *
 * Called when a node's text or inputs change. Without it a scene keeps showing
 * a render of a character who has since been redressed, and looks current while
 * being wrong — which is worse than looking obviously out of date.
 */
export function markStale(graph: CinemaGraph, nodeId: string): CinemaGraph {
	const doomed = new Set([nodeId, ...descendants(graph, nodeId)]);
	return {
		...graph,
		nodes: graph.nodes.map((node) =>
			doomed.has(node.id) && node.output ? { ...node, status: "stale" } : node,
		),
	};
}

export async function runGraph(
	provider: CinemaProvider,
	input: CinemaGraph,
	options: RunOptions = {},
): Promise<RunReport> {
	const started = Date.now();
	const order = runOrder(input);
	if (!order) {
		throw new Error("There is a loop in the graph, so there is no order to run it in.");
	}

	let graph = input;
	const ran: string[] = [];
	const skipped: string[] = [];
	const failed: Array<{ nodeId: string; error: string }> = [];
	const continuity: string[] = [];
	let generations = 0;

	// When `only` is given it means "these and whatever they invalidate" — a
	// character alone is meaningless if the scenes it feeds keep the old face.
	const wanted = options.only
		? new Set(options.only.flatMap((id) => [id, ...descendants(graph, id)]))
		: null;

	const set = (nodeId: string, status: NodeStatus, patch: Partial<CinemaNode> = {}) => {
		graph = {
			...graph,
			nodes: graph.nodes.map((node) =>
				node.id === nodeId ? { ...node, status, ...patch } : node,
			),
		};
		options.onProgress?.(nodeId, status, graph);
	};

	for (const step of order) {
		const node = graph.nodes.find((entry) => entry.id === step.id);
		if (!node) continue;
		if (wanted && !wanted.has(node.id)) continue;

		if (!needsRun(node, options.force === true)) {
			skipped.push(node.id);
			continue;
		}
		// Nodes that hold text or an upload have nothing to execute; they are
		// inputs, and marking them ready is what lets downstream nodes proceed.
		if (!isGenerative(node)) {
			set(node.id, "ready");
			continue;
		}
		if (options.maxGenerations !== undefined && generations >= options.maxGenerations) {
			skipped.push(node.id);
			continue;
		}

		set(node.id, "running");
		const at = Date.now();
		try {
			const output = await runNode(provider, graph, node, continuity);
			generations += 1;
			graph = {
				...graph,
				nodes: graph.nodes.map((entry) =>
					entry.id === node.id
						? { ...entry, status: "ready" as NodeStatus, output, error: undefined }
						: entry,
				),
			};
			// After the graph above was rebuilt, so the tick carries the output.
			options.onProgress?.(node.id, "ready", graph);
			ran.push(node.id);
			options.onRecord?.({
				nodeId: node.id,
				kind: node.kind,
				model: output.model,
				// The prompt is what the ledger exists to hold. Without it a row
				// records that something happened and nothing about what was
				// asked, which answers neither question the table is for. A scene
				// carries the assembled prompt out of the render; every other kind
				// was asked its own text.
				prompt: output.prompt ?? node.text ?? "",
				seed: output.seed,
				elapsedMs: Date.now() - at,
				ok: true,
			});
		} catch (error) {
			// A failure here stops this branch, not the run. Scenes already
			// rendered cost money and are still good.
			const message =
				error instanceof ProviderError
					? error.message
					: error instanceof Error
						? error.message
						: String(error);
			set(node.id, "failed", { error: message });
			failed.push({ nodeId: node.id, error: message });
			options.onRecord?.({
				nodeId: node.id,
				kind: node.kind,
				// The failures are the most useful rows in the table — a ledger of
				// only successes cannot answer "why does this keep getting
				// blocked". Recording the prompt beside the classification is what
				// makes that answerable: "safety" plus the wording that tripped it
				// is actionable, and either one alone is not.
				prompt: node.text ?? "",
				elapsedMs: Date.now() - at,
				ok: false,
				error: message,
				errorKind: error instanceof ProviderError ? error.kind : undefined,
			});
		}
	}

	return {
		graph,
		ran,
		skipped,
		failed,
		continuity,
		elapsedMs: Date.now() - started,
		generations,
	};
}

/** Whether running this node costs a model call. */
export function isGenerative(node: CinemaNode): boolean {
	return (
		node.kind === "character" ||
		node.kind === "world" ||
		node.kind === "story" ||
		node.kind === "scene"
	);
}

async function runNode(
	provider: CinemaProvider,
	graph: CinemaGraph,
	node: CinemaNode,
	continuity: string[],
) {
	if (node.kind === "character") {
		const ingredients = gatherIngredients(graph, node.id);
		const described = await writeDescription(provider, node, ingredients);
		const locked = await lockCharacter(provider, described.text, ingredients.references);
		return toNodeOutput(locked);
	}

	if (node.kind === "world") {
		const said = [node.text, ...inputsOf(graph, node.id).map((input) => input.text)]
			.filter(Boolean)
			.join(". ");
		const result = await provider.text({
			system: "You describe a film's visual world in one sentence a cinematographer could shoot to: era, palette, light quality, lens character. No plot, no characters.",
			prompt: said || "An ordinary contemporary world.",
			temperature: 0.5,
		});
		return { text: result.text.trim(), model: result.model, elapsedMs: result.elapsedMs };
	}

	if (node.kind === "story") {
		const inputs = inputsOf(graph, node.id);
		const beats = inputs
			.filter((input) => input.kind === "beat" && input.text?.trim())
			.map((input) => ({ id: input.id, text: (input.text ?? "").trim() }));
		// The story's own text is a beat too — it is where a one-line premise
		// goes when nobody has written separate beats yet.
		if (beats.length === 0 && node.text?.trim()) {
			beats.push({ id: node.id, text: node.text.trim() });
		}
		const world = inputs.find((input) => input.kind === "world")?.output?.text;
		const result = await decomposeStory(provider, {
			beats,
			cast: castFrom(inputs),
			world,
			targetSeconds: numberParam(node, "targetSeconds"),
		});
		for (const issue of checkContinuity(result.scenes)) continuity.push(issue.message);
		if (result.unknownCharacters.length) {
			continuity.push(
				`The story cast ${result.unknownCharacters.join(", ")}, who have no Character node.`,
			);
		}
		return {
			scenes: result.scenes,
			text: `${result.scenes.length} scenes`,
			model: result.model,
			elapsedMs: result.elapsedMs,
			prompt: result.prompt,
		};
	}

	// A scene renders the spec it was handed by the story it is wired to. Its
	// index picks which — so three scene nodes on one story render shots 1, 2
	// and 3 rather than three copies of the same shot.
	const inputs = inputsOf(graph, node.id);
	const story = inputs.find((input) => input.kind === "story");
	const specs = story?.output?.scenes ?? [];
	if (specs.length === 0) {
		throw new Error("No scenes to render — the story upstream has not decomposed yet.");
	}
	const which = Math.min(
		numberParam(node, "sceneIndex") ?? sceneOrdinal(graph, node),
		specs.length - 1,
	);
	const world = inputs.find((input) => input.kind === "world")?.output?.text;
	const shot = await renderScene(provider, graph, specs[which], {
		world,
		aspect: (node.params.aspect as "16:9" | undefined) ?? "16:9",
	});
	return {
		sheet: [shot.image],
		text: specs[which].action,
		prompt: shot.prompt,
		seed: shot.seed,
		model: shot.model,
		elapsedMs: shot.elapsedMs,
	};
}

/**
 * Which shot this scene node is, when nothing said explicitly.
 *
 * Ordered by position on the canvas rather than by id: a person laying scenes
 * out left to right means that order, and it is the only cue available that
 * they actually chose.
 */
export function sceneOrdinal(graph: CinemaGraph, node: CinemaNode): number {
	const siblings = graph.nodes
		.filter((entry) => entry.kind === "scene")
		.sort((a, b) => a.x - b.x || a.y - b.y);
	return Math.max(
		0,
		siblings.findIndex((entry) => entry.id === node.id),
	);
}

function numberParam(node: CinemaNode, key: string): number | undefined {
	const value = node.params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** What a run would cost, in model calls, before it starts. */
export function estimateRun(graph: CinemaGraph, options: { force?: boolean } = {}): number {
	return graph.nodes.filter(
		(node) => isGenerative(node) && needsRun(node, options.force === true),
	).length;
}
