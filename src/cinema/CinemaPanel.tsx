// The cinema graph, mounted.
//
// Thin on purpose: it owns the active-graph lookup and the empty state, and
// hands everything else to the canvas. The graph's rules are in nodes.ts, the
// drawing is in CinemaCanvas.tsx, and this is the seam between them and the
// editor's state.

import { useCallback } from "react";

import { PanelHeader } from "../palmier-ui/Panel";
import type { EditorApi } from "../palmier-ui/state";
import { CinemaCanvas } from "./CinemaCanvas";
import { graphIssues } from "./nodes";
import { emptyGraph } from "./persist";

export function CinemaPanel({ api }: { api: EditorApi }) {
	const { state, toast } = api;
	const graph = state.cinemaGraphs.find((entry) => entry.id === state.activeCinemaGraphId);

	const notice = useCallback(
		(message: string, tone?: "error" | "info") =>
			toast(message, tone === "error" ? "error" : undefined),
		[toast],
	);

	if (!graph) {
		return (
			<>
				<PanelHeader title="Cinema" />
				<div className="pmr-empty">
					<span>No film open</span>
					<span style={{ fontSize: 10, color: "var(--pmr-text-muted)" }}>
						File → New Film, or ask the agent to build a cast.
					</span>
					<button
						type="button"
						className="pmr-button"
						onClick={() => api.addCinemaGraph(emptyGraph())}
					>
						New film
					</button>
				</div>
			</>
		);
	}

	const issues = graphIssues(graph);
	const ready = issues.length === 0 && graph.nodes.length > 0;

	return (
		<>
			<PanelHeader title={`Cinema · ${graph.name}`}>
				<span className="pmr-wf__state" data-ready={ready || undefined}>
					{ready ? "ready to render" : `${issues.length} to fix`}
				</span>
				<button
					type="button"
					className="pmr-button"
					title="Auto mode: a story edit re-decomposes and re-renders everything downstream."
					onClick={() => api.updateCinemaGraph({ ...graph, auto: !graph.auto })}
				>
					{graph.auto ? "Auto: on" : "Auto: off"}
				</button>
			</PanelHeader>

			<CinemaCanvas
				graph={graph}
				onChange={api.updateCinemaGraph}
				onOpenNode={(nodeId) => {
					// The inspector is where a node is edited; selecting it here is
					// what routes it there.
					api.selectCinemaNode(nodeId);
				}}
				onNotice={notice}
			/>
		</>
	);
}
