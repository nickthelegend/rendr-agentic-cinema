// The cinema graph, mounted.
//
// Thin on purpose: it owns the active-graph lookup and the empty state, and
// hands everything else to the canvas. The graph's rules are in nodes.ts, the
// drawing is in CinemaCanvas.tsx, and this is the seam between them and the
// editor's state.

import { useCallback, useEffect, useState } from "react";

import { PanelHeader } from "../palmier-ui/Panel";
import type { EditorApi } from "../palmier-ui/state";
import { CinemaCanvas } from "./CinemaCanvas";
import { CinemaInspector } from "./CinemaInspector";
import { CHECK_MODELS, type CheckResult, checkConnection } from "./checkConnection";
import { graphIssues } from "./nodes";
import { emptyGraph } from "./persist";
import { createGeminiProvider, ProviderError } from "./provider";
import { estimateRun, runGraph } from "./run";
import { createStubProvider } from "./stubProvider";

export function CinemaPanel({ api }: { api: EditorApi }) {
	const { state, toast } = api;
	const graph = state.cinemaGraphs.find((entry) => entry.id === state.activeCinemaGraphId);

	const [running, setRunning] = useState(false);
	const [checks, setChecks] = useState<CheckResult[] | null>(null);
	const [checking, setChecking] = useState(false);
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

	/**
	 * Answers "is it my key, my quota, or the request shape" without leaving
	 * the app. The same five checks the preflight script runs, because a render
	 * that fails is exactly when nobody wants to go and find a terminal.
	 */
	const testConnection = useCallback(async () => {
		if (checking) return;
		const key = import.meta.env.VITE_GEMINI_API_KEY ?? "";
		if (!key) {
			setChecks([
				{
					name: "api key",
					ok: false,
					detail: "No VITE_GEMINI_API_KEY in .env.local. Get one from aistudio.google.com — that is a different product from a Gemini app subscription, which carries no API quota.",
				},
			]);
			return;
		}
		setChecking(true);
		setChecks(null);
		try {
			setChecks(await checkConnection(createGeminiProvider(key)));
		} catch (error) {
			setChecks([
				{
					name: "connection",
					ok: false,
					detail: error instanceof Error ? error.message : String(error),
				},
			]);
		} finally {
			setChecking(false);
		}
	}, [checking]);

	// ⌘Z belongs to whatever is on screen. With a film open that is the graph;
	// sending it to the timeline instead would undo an edit the user cannot
	// even see, which is worse than doing nothing.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
			const target = event.target as HTMLElement | null;
			// Not while typing — ⌘Z in a textarea is the field's own undo.
			if (target && /^(input|textarea)$/i.test(target.tagName)) return;
			event.preventDefault();
			event.stopPropagation();
			api.undoCinema();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [api]);

	const issues = graphIssues(graph);
	const ready = issues.length === 0 && graph.nodes.length > 0;
	const pending = estimateRun(graph);

	// The run is driven here rather than inside the canvas: the canvas draws a
	// graph, and giving it the ability to spend money would mean every future
	// change to the view has to think about that.
	const run = useCallback(
		async (only?: string[]) => {
			if (running) return;
			// No key falls back to the stub rather than refusing. The pipeline is
			// worth exercising without quota, and the stub paints "STUB" into
			// every frame so a placeholder cannot be mistaken for a render.
			const key = import.meta.env.VITE_GEMINI_API_KEY ?? "";
			const provider = key ? createGeminiProvider(key) : createStubProvider();
			if (!key) {
				notice(
					"No API key — running the local stub. Frames are placeholders. Put VITE_GEMINI_API_KEY in .env.local for the real thing.",
				);
			}
			setRunning(true);
			try {
				const report = await runGraph(provider, graph, {
					only,
					// Progress is written straight back to the graph, so the canvas
					// shows a node going running → ready while the rest still wait.
					onProgress: (nodeId, status) =>
						api.updateCinemaGraph(
							{
								...graph,
								nodes: graph.nodes.map((node) =>
									node.id === nodeId ? { ...node, status } : node,
								),
							},
							// Status ticks are not edits. Recording them would bury
							// every real change under a dozen of these.
							{ undoable: false },
						),
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
					className="pmr-button"
					disabled={state.cinemaUndo.length === 0}
					title="Undo the last change to the graph (⌘Z)"
					onClick={api.undoCinema}
				>
					Undo
				</button>
				<button
					type="button"
					className="pmr-button"
					disabled={checking}
					title={`Check the key and the request shape against ${CHECK_MODELS()}`}
					onClick={testConnection}
				>
					{checking ? "Checking…" : "Test connection"}
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

			{checks ? (
				<div className="cin-checks">
					<div className="cin-checks__head">
						<strong>Connection</strong>
						<span>{CHECK_MODELS()}</span>
						<button
							type="button"
							className="pmr-button"
							onClick={() => setChecks(null)}
						>
							Close
						</button>
					</div>
					{checks.map((check) => (
						<p
							key={check.name}
							className="cin-checks__row"
							data-ok={check.ok || undefined}
						>
							<span>{check.ok ? "✓" : "✕"}</span>
							<strong>{check.name}</strong>
							<em>{check.detail}</em>
						</p>
					))}
				</div>
			) : null}

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
