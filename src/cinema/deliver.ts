// Getting the film out of the app.
//
// A shot list is the artefact a crew actually works from, and it is the
// cheapest possible proof that the decomposition produced something coherent —
// you can read a shot list and know whether the film makes sense without
// rendering a frame. The ledger export is the same argument for the spend.
//
// CSV rather than a prettier format because CSV opens in the thing everybody
// already has. The escaping is done properly, once, here — a shot list that
// breaks on a comma in a line of dialogue is worse than no shot list.

import type { LedgerRow } from "./ledger";
import type { CinemaGraph, SceneSpec } from "./nodes";
import { runtimeSeconds } from "./structure";

/**
 * One CSV field.
 *
 * Quotes are doubled and any field containing a comma, a quote or a newline is
 * wrapped. Dialogue contains all three, routinely.
 */
export function csvField(value: unknown): string {
	const text = value === null || value === undefined ? "" : String(value);
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (fields: unknown[]): string => fields.map(csvField).join(",");

/** CRLF: what spreadsheets expect, and what stops Excel eating the last row. */
export const csv = (rows: unknown[][]): string => rows.map(csvRow).join("\r\n");

const SHOT_LIST_HEADER = [
	"Shot",
	"Location",
	"Time",
	"Camera",
	"Action",
	"Cast",
	"Dialogue",
	"Seconds",
	"Timecode in",
];

/** Frames to hh:mm:ss:ff, the only timecode a crew reads. */
export function timecode(seconds: number, fps = 30): string {
	const total = Math.max(0, Math.round(seconds * fps));
	const frames = total % fps;
	const whole = Math.floor(total / fps);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}:${pad(frames)}`;
}

export function shotListCsv(graph: CinemaGraph, scenes: SceneSpec[], fps = 30): string {
	const name = (id: string) => {
		const node = graph.nodes.find((entry) => entry.id === id);
		return node?.label ?? node?.text?.slice(0, 24) ?? id;
	};

	let at = 0;
	const rows: unknown[][] = [SHOT_LIST_HEADER];
	for (const scene of [...scenes].sort((a, b) => a.index - b.index)) {
		rows.push([
			scene.index + 1,
			scene.location,
			scene.timeOfDay,
			scene.camera,
			scene.action,
			scene.characterIds.map(name).join("; "),
			scene.dialogue ?? "",
			scene.durationSeconds,
			timecode(at, fps),
		]);
		at += scene.durationSeconds;
	}
	return csv(rows);
}

/** The ledger as a spreadsheet, for anyone who wants to audit the spend. */
export function ledgerCsv(rows: LedgerRow[]): string {
	return csv([
		["When", "Node", "Kind", "Model", "Prompt", "Seed", "ms", "OK", "Error kind", "Kept"],
		...rows.map((row) => [
			row.at,
			row.nodeId,
			row.nodeKind,
			row.model,
			row.prompt,
			row.seed ?? "",
			row.elapsedMs,
			row.ok ? "yes" : "no",
			row.errorKind ?? "",
			row.accepted === undefined ? "" : row.accepted ? "kept" : "discarded",
		]),
	]);
}

/**
 * What went wrong, grouped.
 *
 * The single most useful read of a ledger when nothing is working: "eleven
 * safety blocks" and "eleven quota errors" call for completely different
 * responses, and a flat list of failures makes them look the same.
 */
export function failureBreakdown(rows: LedgerRow[]): Array<{ kind: string; count: number }> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (row.ok) continue;
		const kind = row.errorKind || "unknown";
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([kind, count]) => ({ kind, count }))
		.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export interface FilmSummary {
	name: string;
	shots: number;
	runtimeSeconds: number;
	cast: string[];
	locations: string[];
}

/** The one-paragraph read of a film, for a card or a hand-off. */
export function summarise(graph: CinemaGraph, scenes: SceneSpec[]): FilmSummary {
	const cast = graph.nodes
		.filter((node) => node.kind === "character")
		.map((node) => node.label ?? "Unnamed")
		.filter(Boolean);
	return {
		name: graph.name,
		shots: scenes.length,
		runtimeSeconds: runtimeSeconds(scenes),
		cast: [...new Set(cast)],
		// Order preserved: locations in the order the film visits them reads as a
		// route, and sorting them alphabetically would throw that away.
		locations: [...new Set(scenes.map((scene) => scene.location))],
	};
}

/**
 * A film as portable JSON.
 *
 * Deliberately drops every rendered image. A film someone wants to send is the
 * *decisions* — the cast, the world, the beats, the shot specs — and carrying
 * base64 stills turns a 20 KB document into 40 MB of pictures that will be
 * regenerated on the other end anyway.
 */
export function exportFilm(graph: CinemaGraph): string {
	return JSON.stringify(
		{
			format: "rendr-cinema/1",
			name: graph.name,
			auto: graph.auto,
			nodes: graph.nodes.map((node) => ({
				id: node.id,
				kind: node.kind,
				label: node.label,
				text: node.text,
				x: node.x,
				y: node.y,
				// params minus any uploaded image, for the same reason.
				params: Object.fromEntries(
					Object.entries(node.params).filter(([key]) => key !== "image"),
				),
			})),
			edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to })),
		},
		null,
		2,
	);
}

export interface ImportResult {
	graph?: CinemaGraph;
	error?: string;
}

/**
 * Reads a film back.
 *
 * Every failure is a message rather than a throw, because the caller is a file
 * picker and "that is not a film" is something a person needs to read.
 */
export function importFilm(json: string, id: string): ImportResult {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return { error: "That file is not JSON." };
	}
	if (!raw || typeof raw !== "object") return { error: "That file is not a film." };
	const data = raw as Record<string, unknown>;
	if (data.format !== "rendr-cinema/1") {
		return { error: `Unknown format: ${String(data.format ?? "none")}.` };
	}
	if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
		return { error: "That film has no nodes." };
	}

	const nodes = (data.nodes as Array<Record<string, unknown>>).map((node, index) => ({
		id: String(node.id ?? `${id}-n${index}`),
		kind: node.kind as CinemaGraph["nodes"][number]["kind"],
		label: node.label as string | undefined,
		text: node.text as string | undefined,
		x: Number(node.x) || 0,
		y: Number(node.y) || 0,
		params: (node.params as Record<string, unknown>) ?? {},
		// Nothing arrives rendered. Importing a film means re-rendering it, and
		// marking these ready would show a cast that was never generated here.
		status: "idle" as const,
	}));

	const ids = new Set(nodes.map((node) => node.id));
	const edges = (Array.isArray(data.edges) ? data.edges : [])
		.map((edge, index) => {
			const entry = edge as Record<string, unknown>;
			return { id: `${id}-e${index}`, from: String(entry.from), to: String(entry.to) };
		})
		// An edge to a node that did not survive would make the graph unrunnable
		// in a way that is very hard to see on a canvas.
		.filter((edge) => ids.has(edge.from) && ids.has(edge.to));

	return {
		graph: {
			id,
			name: String(data.name ?? "Imported film"),
			auto: data.auto === true,
			nodes,
			edges,
		},
	};
}
