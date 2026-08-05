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

		out.push({ id: entry.id, name: entry.name, nodes, edges, auto: entry.auto === true });
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
