// Operations on a graph, as pure functions.
//
// Every one of these takes a graph and returns a new one. That is not
// aesthetics: the panel already funnels every change through one commit so undo
// works, and an operation that mutates in place or reaches into React state
// would quietly escape it. Keeping them pure is what makes "duplicate a scene"
// undoable for free.

import {
	type CinemaEdge,
	type CinemaGraph,
	type CinemaNode,
	type CinemaNodeKind,
	descendants,
	inputsOf,
	NODE_SPECS,
	nodeSpec,
	runOrder,
} from "./nodes";
import { STRUCTURES } from "./structure";

let counter = 0;
/** Unique within a session. Ids only need to be distinct inside one film. */
const freshId = (graph: CinemaGraph, kind: string): string => {
	counter += 1;
	let id = `${graph.id}-${kind}${counter}`;
	while (graph.nodes.some((node) => node.id === id)) {
		counter += 1;
		id = `${graph.id}-${kind}${counter}`;
	}
	return id;
};

/**
 * Copies a node, its params, and the wires feeding it.
 *
 * The inbound edges are the point. A scene node duplicated without them is an
 * empty box — the whole reason to duplicate a scene is to try a second version
 * of it against the same cast and story, and rewiring that by hand is four
 * drags and the thing people give up on.
 *
 * Outbound edges are deliberately not copied: a duplicate that also feeds the
 * timeline would silently double the cut.
 */
export function duplicateNode(graph: CinemaGraph, nodeId: string): CinemaGraph {
	const source = graph.nodes.find((node) => node.id === nodeId);
	if (!source) return graph;

	const id = freshId(graph, source.kind);
	const copy: CinemaNode = {
		...source,
		id,
		label: source.label ? `${source.label} copy` : undefined,
		x: source.x + 40,
		y: source.y + 40,
		// A copy has produced nothing. Carrying the output over would show a
		// render that belongs to the original and was never made for this node.
		status: "idle",
		output: undefined,
		error: undefined,
		params: { ...source.params },
	};

	const inbound = graph.edges
		.filter((edge) => edge.to === nodeId)
		.map((edge, index) => ({ id: `${id}-in${index}`, from: edge.from, to: id }));

	return { ...graph, nodes: [...graph.nodes, copy], edges: [...graph.edges, ...inbound] };
}

/** Removes nodes and every edge that touched them. */
export function removeNodes(graph: CinemaGraph, ids: string[]): CinemaGraph {
	const doomed = new Set(ids);
	return {
		...graph,
		nodes: graph.nodes.filter((node) => !doomed.has(node.id)),
		edges: graph.edges.filter((edge) => !doomed.has(edge.from) && !doomed.has(edge.to)),
	};
}

const COLUMN_WIDTH = 210;
const ROW_HEIGHT = 120;

/**
 * Tidies the canvas into dependency columns.
 *
 * Laid out by run order rather than by kind, so the picture on screen is the
 * order things actually happen in. A graph nobody can read is a graph nobody
 * trusts, and after twenty minutes of dragging every canvas becomes one.
 *
 * A graph with a loop is returned untouched — there is no left-to-right for a
 * cycle, and inventing one would draw a picture that lies about the problem.
 */
export function autoLayout(graph: CinemaGraph): CinemaGraph {
	if (!runOrder(graph)) return graph;

	// Depth = longest path from any root, so a node always sits to the right of
	// everything feeding it. Longest rather than shortest: with the shortest
	// path a node can land in the same column as one of its own inputs.
	const depth = new Map<string, number>();
	const visit = (id: string, seen: Set<string>): number => {
		if (depth.has(id)) return depth.get(id) as number;
		if (seen.has(id)) return 0;
		seen.add(id);
		const inputs = inputsOf(graph, id);
		const value = inputs.length
			? Math.max(...inputs.map((input) => visit(input.id, seen))) + 1
			: 0;
		depth.set(id, value);
		return value;
	};
	for (const node of graph.nodes) visit(node.id, new Set());

	const byColumn = new Map<number, CinemaNode[]>();
	for (const node of graph.nodes) {
		const column = depth.get(node.id) ?? 0;
		byColumn.set(column, [...(byColumn.get(column) ?? []), node]);
	}

	const placed = new Map<string, { x: number; y: number }>();
	for (const [column, nodes] of byColumn) {
		// Centred vertically so the graph reads as a spine rather than hanging
		// off the top edge.
		const offset = -((nodes.length - 1) * ROW_HEIGHT) / 2;
		nodes.forEach((node, row) => {
			placed.set(node.id, { x: column * COLUMN_WIDTH, y: offset + row * ROW_HEIGHT });
		});
	}

	return {
		...graph,
		nodes: graph.nodes.map((node) => ({ ...node, ...placed.get(node.id) })),
	};
}

/**
 * Nodes matching a query, by name, text, or kind.
 *
 * Case-insensitive substring rather than fuzzy: on a canvas of fifteen nodes,
 * fuzzy matching returns everything and ranks it, which is worse than a short
 * exact list.
 */
export function findNodes(graph: CinemaGraph, query: string): CinemaNode[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];
	return graph.nodes.filter((node) => {
		const spec = nodeSpec(node.kind);
		return [node.label, node.text, node.kind, spec?.label]
			.filter(Boolean)
			.some((field) => (field as string).toLowerCase().includes(needle));
	});
}

/**
 * A node and everything it invalidates.
 *
 * What "re-run this" has to mean. Re-running a character without its scenes
 * leaves shots of a face that no longer exists, which looks current and is
 * wrong — the failure mode the staleness rules exist to prevent.
 */
export const withDownstream = (graph: CinemaGraph, ids: string[]): string[] => [
	...new Set(ids.flatMap((id) => [id, ...descendants(graph, id)])),
];

export interface Template {
	name: string;
	summary: string;
	build: (id: string, name: string) => CinemaGraph;
}

function buildFromBeats(
	id: string,
	name: string,
	beats: string[],
	options: { characters?: string[]; world?: string; sceneCount?: number },
): CinemaGraph {
	const nodes: CinemaNode[] = [];
	const edges: CinemaEdge[] = [];
	const at = (kind: CinemaNodeKind, suffix: string, over: Partial<CinemaNode>): CinemaNode => {
		const node: CinemaNode = {
			id: `${id}-${suffix}`,
			kind,
			x: 0,
			y: 0,
			params: {},
			status: "idle",
			...over,
		};
		nodes.push(node);
		return node;
	};
	const wire = (from: CinemaNode, to: CinemaNode) =>
		edges.push({ id: `${id}-e${edges.length}`, from: from.id, to: to.id });

	const story = at("story", "story", { text: beats[0] ?? "", params: { targetSeconds: 30 } });

	for (const [index, who] of (options.characters ?? []).entries()) {
		wire(at("character", `char${index}`, { label: who.split(",")[0], text: who }), story);
	}
	if (options.world) wire(at("world", "world", { text: options.world }), story);
	for (const [index, beat] of beats.entries()) {
		wire(at("beat", `beat${index}`, { label: `Beat ${index + 1}`, text: beat }), story);
	}

	const timeline = at("timeline", "timeline", { label: "Timeline" });
	for (let index = 0; index < (options.sceneCount ?? beats.length); index++) {
		const scene = at("scene", `scene${index}`, {
			label: `Shot ${index + 1}`,
			params: { sceneIndex: index, aspect: "16:9" },
		});
		wire(story, scene);
		wire(scene, timeline);
	}

	// Laid out immediately: a template that arrives as a pile in the corner
	// teaches nothing about how the graph is meant to read.
	return autoLayout({ id, name, auto: false, nodes, edges });
}

/**
 * Starting points, one per kind of film.
 *
 * Seeded with real text rather than placeholders. An empty canvas teaches
 * nothing about what the nodes do, and "Enter your character here" teaches
 * slightly less than that.
 */
export const TEMPLATES: Template[] = [
	{
		name: "Short film",
		summary: "Five shots, one cast member, one turn.",
		build: (id, name) =>
			buildFromBeats(id, name, STRUCTURES[1].beats, {
				characters: ["A dock worker in her fifties, tired, careful with her hands"],
				world: "A rain-dark port town at night. Sodium light, long lenses.",
				sceneCount: 5,
			}),
	},
	{
		name: "Advertisement",
		summary: "Thirty seconds. Problem, product, payoff.",
		build: (id, name) =>
			buildFromBeats(id, name, STRUCTURES[2].beats, {
				characters: ["A commuter in their thirties, hurried, well dressed"],
				world: "A bright modern city in the morning. Clean, high key, shallow focus.",
				sceneCount: 5,
			}),
	},
	{
		name: "Music video",
		summary: "Performance intercut with a thread that does not explain itself.",
		build: (id, name) =>
			buildFromBeats(id, name, STRUCTURES[3].beats, {
				characters: [
					"A singer in their twenties, restless, hair over one eye",
					"A stranger, older, always at the edge of frame",
				],
				world: "A concrete rehearsal room and a coastal road at dusk. Hard light, deep shadow.",
				sceneCount: 6,
			}),
	},
	{
		name: "Documentary",
		summary: "A place, the people in it, and what is changing.",
		build: (id, name) =>
			buildFromBeats(id, name, STRUCTURES[4].beats, {
				characters: ["A boatbuilder in his sixties, weathered, unhurried"],
				world: "A working harbour in winter. Overcast, flat light, muted colour.",
				sceneCount: 5,
			}),
	},
];

/**
 * Problems worth stopping for, before spending anything.
 *
 * Distinct from graphIssues, which is about one node being wired legally. This
 * is about the film as a whole being renderable at all — and it runs before the
 * first paid call rather than after the fourth.
 */
export function preflight(graph: CinemaGraph): string[] {
	const problems: string[] = [];
	if (graph.nodes.length === 0) return ["This film has no nodes."];
	if (!runOrder(graph))
		problems.push("There is a loop in the graph, so there is no order to run it in.");

	const story = graph.nodes.find((node) => node.kind === "story");
	const scenes = graph.nodes.filter((node) => node.kind === "scene");
	if (scenes.length > 0 && !story) {
		problems.push("There are scenes but no story to decompose into them.");
	}
	if (story && !story.text?.trim() && !graph.nodes.some((node) => node.kind === "beat")) {
		problems.push("The story is empty and has no beats, so there is nothing to decompose.");
	}

	// Only the kinds that cannot invent their own input. A Character with a
	// description and no Reference is complete — flagging it was the first
	// version of this check, and a preflight that cries about a perfectly good
	// root node is one people learn to skip.
	for (const node of graph.nodes) {
		if (node.kind !== "scene" && node.kind !== "timeline") continue;
		if (inputsOf(graph, node.id).length === 0) {
			const spec = nodeSpec(node.kind);
			problems.push(
				node.kind === "scene"
					? `${node.label ?? spec?.label} has no story wired into it, so there is no shot for it to render.`
					: `${node.label ?? spec?.label} has no scenes wired into it, so the cut would be empty.`,
			);
		}
	}

	// A scene index past the end of the shot list renders nothing and says
	// nothing about why, which is the worst possible combination.
	const shots = story?.output?.scenes?.length;
	if (shots !== undefined) {
		for (const scene of scenes) {
			const which = scene.params.sceneIndex;
			if (typeof which === "number" && which >= shots) {
				problems.push(
					`${scene.label ?? "A scene"} asks for shot ${which + 1}, but the story only has ${shots}.`,
				);
			}
		}
	}

	return problems;
}

/** Every node kind, for a palette that cannot drift from the specs. */
export const PALETTE_GROUPS = (): Array<{ group: string; kinds: CinemaNodeKind[] }> => {
	const groups = new Map<string, CinemaNodeKind[]>();
	for (const spec of NODE_SPECS) {
		groups.set(spec.group, [...(groups.get(spec.group) ?? []), spec.kind]);
	}
	return [...groups.entries()].map(([group, kinds]) => ({ group, kinds }));
};

/**
 * Adds one node of a kind, near the middle of what is already there.
 *
 * Placed relative to the existing graph rather than at the origin, because a
 * node created off-screen reads as a click that did nothing — which is how the
 * empty-state cards would feel on a canvas that had been panned.
 */
export function addNode(graph: CinemaGraph, kind: CinemaNodeKind): CinemaGraph {
	const xs = graph.nodes.map((node) => node.x);
	const ys = graph.nodes.map((node) => node.y);
	const x = xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) + 120 : 0;
	const y = ys.length ? Math.round(ys.reduce((a, b) => a + b, 0) / ys.length) : 0;

	return {
		...graph,
		nodes: [
			...graph.nodes,
			{
				id: freshId(graph, kind),
				kind,
				x,
				y,
				params:
					kind === "scene"
						? {
								sceneIndex: graph.nodes.filter((n) => n.kind === "scene").length,
								aspect: "16:9",
							}
						: {},
				status: "idle",
			},
		],
	};
}
