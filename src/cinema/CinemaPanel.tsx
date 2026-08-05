// The cinema graph, mounted.
//
// Thin on purpose: it owns the active-graph lookup and the empty state, and
// hands everything else to the canvas. The graph's rules are in nodes.ts, the
// drawing is in CinemaCanvas.tsx, and this is the seam between them and the
// editor's state.

import { useCallback, useState } from "react";

import { PanelHeader } from "../palmier-ui/Panel";
import type { EditorApi } from "../palmier-ui/state";
import { CinemaCanvas } from "./CinemaCanvas";
import { CinemaInspector } from "./CinemaInspector";
import { graphIssues } from "./nodes";
import { emptyGraph } from "./persist";
import { createGeminiProvider, ProviderError } from "./provider";
import { estimateRun, runGraph } from "./run";

export function CinemaPanel({ api }: { api: EditorApi }) {
	const { state, toast } = api;
	const graph = state.cinemaGraphs.find((entry) => entry.id === state.activeCinemaGraphId);

	const [running, setRunning] = useState(false);
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
	const pending = estimateRun(graph);

	// The run is driven here rather than inside the canvas: the canvas draws a
	// graph, and giving it the ability to spend money would mean every future
	// change to the view has to think about that.
	const run = useCallback(
		async (only?: string[]) => {
			if (running) return;
			const key = import.meta.env.VITE_GEMINI_API_KEY ?? "";
			if (!key) {
				notice(
					"No Gemini key. Put VITE_GEMINI_API_KEY in .env.local — an AI Studio key, not a Gemini app subscription.",
					"error",
				);
				return;
			}
			setRunning(true);
			try {
				const report = await runGraph(createGeminiProvider(key), graph, {
					only,
					// Progress is written straight back to the graph, so the canvas
					// shows a node going running → ready while the rest still wait.
					onProgress: (nodeId, status) =>
						api.updateCinemaGraph({
							...graph,
							nodes: graph.nodes.map((node) =>
								node.id === nodeId ? { ...node, status } : node,
							),
						}),
				});
				api.updateCinemaGraph(report.graph);
				for (const line of report.continuity.slice(0, 3)) notice(line);
				if (report.failed.length) {
					notice(
						`${report.failed.length} node(s) failed: ${report.failed[0].error}`,
						"error",
					);
				} else {
					notice(`Ran ${report.ran.length}, skipped ${report.skipped.length}.`);
				}
			} catch (error) {
				notice(
					error instanceof ProviderError || error instanceof Error
						? error.message
						: String(error),
					"error",
				);
			} finally {
				setRunning(false);
			}
		},
		[api, graph, notice, running],
	);

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
				<button
					type="button"
					className="pmr-button pmr-button--primary"
					disabled={running || pending === 0}
					title={
						pending === 0
							? "Everything is up to date."
							: `${pending} node(s) need a model call.`
					}
					onClick={() => run()}
				>
					{running ? "Rendering…" : pending ? `Render ${pending}` : "Up to date"}
				</button>
			</PanelHeader>

			<div className="cin-shell">
				<CinemaCanvas
					graph={graph}
					onChange={api.updateCinemaGraph}
					onOpenNode={api.selectCinemaNode}
					onNotice={notice}
				/>
				<CinemaInspector
					graph={graph}
					nodeId={state.selectedCinemaNodeId}
					onChange={api.updateCinemaGraph}
					onRun={(nodeId) => run([nodeId])}
					onNotice={notice}
				/>
			</div>
		</>
	);
}
