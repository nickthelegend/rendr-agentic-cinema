// Reading cinema graphs out of a project file.
//
// Same rule as parseComments and parseLooks: a malformed graph is dropped, not
// thrown on. A project that refuses to open because one node has a bad
// coordinate is a worse outcome than one that opens with a node missing.

import { type CinemaGraph, type CinemaNode, type CinemaNodeKind, nodeSpec } from "./nodes";

const NUMBER = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function parseCinemaGraphs(value: unknown): CinemaGraph[] {
	if (!Array.isArray(value)) return [];
	const out: CinemaGraph[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as Partial<CinemaGraph>;
		if (typeof entry.id !== "string" || typeof entry.name !== "string") continue;
		if (out.some((graph) => graph.id === entry.id)) continue;

		const nodes: CinemaNode[] = [];
		for (const rawNode of Array.isArray(entry.nodes) ? entry.nodes : []) {
			if (!rawNode || typeof rawNode !== "object") continue;
			const node = rawNode as Partial<CinemaNode>;
			if (typeof node.id !== "string") continue;
			// A kind this build does not know would render as an empty card and
			// wire to nothing, so it goes rather than half-existing.
			if (!nodeSpec(node.kind as CinemaNodeKind)) continue;
			if (nodes.some((existing) => existing.id === node.id)) continue;
			nodes.push({
				id: node.id,
				kind: node.kind as CinemaNodeKind,
				x: NUMBER(node.x, 0),
				y: NUMBER(node.y, 0),
				...(typeof node.label === "string" ? { label: node.label } : {}),
				...(typeof node.text === "string" ? { text: node.text } : {}),
				params: node.params && typeof node.params === "object" ? node.params : {},
				// Never restored as running: a graph reopened mid-run would show a
				// spinner for work that died with the last session.
				status: node.status === "ready" || node.status === "failed" ? node.status : "idle",
				...(node.output && typeof node.output === "object" ? { output: node.output } : {}),
				...(typeof node.error === "string" ? { error: node.error } : {}),
			});
		}

		const ids = new Set(nodes.map((node) => node.id));
		const edges = (Array.isArray(entry.edges) ? entry.edges : [])
			.filter(
				(edge): edge is { id: string; from: string; to: string } =>
					Boolean(edge) &&
					typeof edge === "object" &&
					typeof (edge as { id?: unknown }).id === "string" &&
					ids.has((edge as { from?: string }).from ?? "") &&
					ids.has((edge as { to?: string }).to ?? ""),
			)
			.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to }));

		out.push({
			id: entry.id,
			name: entry.name,
			nodes,
			edges,
			auto: entry.auto === true,
			// Carried, so a saved film reproduces its cast on reopening rather
			// than recasting the first time it is re-rendered.
			...(typeof entry.seed === "string" && entry.seed ? { seed: entry.seed } : {}),
		});
	}
	return out;
}

let counter = 0;
/** Ids carry a random suffix, so a graph made after a restart cannot collide. */
export function freshGraphId(): string {
	counter += 1;
	return `cin-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyGraph(name = "Untitled film"): CinemaGraph {
	return { id: freshGraphId(), name, nodes: [], edges: [], auto: false };
}

/**
 * What "New Film" creates.
 *
 * Not empty. An empty canvas teaches nothing about what the nodes do, and a
 * film cannot produce anything without at least a character, a story and
 * somewhere for the scenes to land — so those three arrive wired, and the
 * first thing anyone does is type into them rather than guess at the palette.
 */
export function starterGraph(name = "Untitled film"): CinemaGraph {
	const id = freshGraphId();
	const node = (
		kind: CinemaNode["kind"],
		x: number,
		y: number,
		extra: Partial<CinemaNode> = {},
	): CinemaNode => ({
		id: `${id}-${kind}`,
		kind,
		x,
		y,
		params: {},
		status: "idle",
		...extra,
	});

	const nodes: CinemaNode[] = [
		// Seeded with real text, not just labels. A starter graph whose Beat is
		// empty cannot run at all — the story has nothing to decompose — so the
		// first thing a new film does is fail. These are meant to be typed over,
		// and they make Render work on the first click.
		node("character", 60, 40, {
			label: "Lead",
			text: "A dock worker in her fifties, tired, careful with her hands.",
		}),
		node("world", 60, 210, {
			label: "World",
			text: "A rain-dark port town at night. Sodium light, long lenses.",
		}),
		node("beat", 60, 350, {
			label: "Opening beat",
			text: "She waits under an awning and unfolds a letter she has read before.",
		}),
		node("story", 320, 180, { params: { targetSeconds: 30 } }),
		{ ...node("scene", 570, 100, { label: "Shot 1" }), id: `${id}-scene` },
		{
			...node("scene", 570, 260, { label: "Shot 2" }),
			id: `${id}-scene2`,
			params: { sceneIndex: 1 },
		},
		node("timeline", 810, 180),
	];
	const wire = (from: string, to: string) => ({
		id: `${id}-e-${from}-${to}`,
		from: `${id}-${from}`,
		to: `${id}-${to}`,
	});

	return {
		id,
		name,
		auto: false,
		nodes,
		// Two scenes rather than one: a single scene hides the thing the graph is
		// for, which is the same face turning up twice.
		edges: [
			wire("character", "story"),
			wire("world", "story"),
			wire("beat", "story"),
			wire("story", "scene"),
			wire("story", "scene2"),
			wire("scene", "timeline"),
			wire("scene2", "timeline"),
		],
	};
}
