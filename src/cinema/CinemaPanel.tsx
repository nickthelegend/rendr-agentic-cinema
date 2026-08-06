// The cinema graph, mounted.
//
// Thin on purpose: it owns the active-graph lookup and the empty state, and
// hands everything else to the canvas. The graph's rules are in nodes.ts, the
// drawing is in CinemaCanvas.tsx, and this is the seam between them and the
// editor's state.

import { useCallback, useEffect, useRef, useState } from "react";
import { withDefaults } from "../palmier-ui/model";
import { PanelHeader } from "../palmier-ui/Panel";
import type { EditorApi } from "../palmier-ui/state";
import { AUTO_DEBOUNCE_MS, confirmMessage, decideAuto } from "./auto";
import { CinemaCanvas } from "./CinemaCanvas";
import { CinemaInspector } from "./CinemaInspector";
import { CHECK_MODELS, type CheckResult, checkConnection } from "./checkConnection";
import { readyScenes } from "./commit";
import { shotListCsv } from "./deliver";
import { autoLayout, preflight } from "./graphOps";
import { createClickhouseLedger, type Ledger } from "./ledger";
import { graphIssues } from "./nodes";
import { emptyGraph } from "./persist";
import { createGeminiProvider, ProviderError } from "./provider";
import { estimateRun, needsRun, runGraph } from "./run";
import { moveFor } from "./scene";
import { estimateCost } from "./sound";
import { reviewCut } from "./structure";
import { createStubProvider } from "./stubProvider";

/**
 * Hands a file to the browser.
 *
 * Object URL rather than a data URI: a shot list for a long film exceeds what
 * some browsers accept in a URL, and the failure is silent.
 */
function download(name: string, type: string, body: string): void {
	const url = URL.createObjectURL(new Blob([body], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}

export function CinemaPanel({ api }: { api: EditorApi }) {
	const { state, toast } = api;
	const graph = state.cinemaGraphs.find((entry) => entry.id === state.activeCinemaGraphId);

	const [running, setRunning] = useState(false);
	const [checks, setChecks] = useState<CheckResult[] | null>(null);
	const ledger = useRef<Ledger | null>(null);
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

	/**
	 * Lands the rendered scenes on the timeline.
	 *
	 * The point of the whole thing: what comes out is a cut you can edit rather
	 * than a folder of images. Everything here goes through the editor's own
	 * calls — placeAsset, then one commit for the durations and the camera
	 * moves, so the whole placement is a single undo step rather than a dozen.
	 */
	const commitToCut = useCallback(async () => {
		const ready = readyScenes(graph);
		if (ready.length === 0) {
			notice("Nothing to place — render some scenes first.", "error");
			return;
		}
		const fps = api.timeline.fps;

		const files = ready.map((entry, index) => {
			const binary = atob(entry.image.base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			const ext = entry.image.mimeType.includes("svg") ? "svg" : "png";
			return new File([bytes], `Scene ${index + 1}.${ext}`, { type: entry.image.mimeType });
		});
		const assets = await api.importMedia(files);
		if (assets.length !== files.length) {
			// Placing some of them would leave a cut that looks complete and is
			// missing shots, which is worse than placing none.
			notice(
				`Only ${assets.length} of ${files.length} stills imported — nothing placed.`,
				"error",
			);
			return;
		}

		const placements: Array<{ clipId: string; start: number; frames: number; index: number }> =
			[];
		let cursor = 0;
		for (const [index, entry] of ready.entries()) {
			const frames = Math.max(1, Math.round(entry.spec.durationSeconds * fps));
			api.placeAsset(assets[index].id, cursor);
			// placeAsset mints this id from the asset and the frame, so it can be
			// computed rather than read back.
			placements.push({
				clipId: `clip-${assets[index].id}-${cursor}`,
				start: cursor,
				frames,
				index,
			});
			cursor += frames;
		}

		// One commit for every duration and move, so the whole placement undoes
		// as a single step rather than as fifteen.
		api.commit("Place scenes", (current) => {
			// Everything in one commit: the clips, their lengths and their moves,
			// so placing a cut is a single undo rather than fifteen.
			const videoIndex = current.tracks.findIndex((track) => track.kind === "video");
			let next = {
				...current,
				tracks: current.tracks.map((track, index) =>
					index !== videoIndex
						? track
						: {
								...track,
								clips: [
									...track.clips,
									...placements.map((placement, at) =>
										withDefaults({
											id: placement.clipId,
											name: `Scene ${at + 1}`,
											mediaType: "image" as const,
											assetId: assets[at].id,
											startFrame: placement.start,
											endFrame: placement.start + placement.frames,
										}),
									),
								].sort((a, b) => a.startFrame - b.startFrame),
							},
				),
			};
			for (const placement of placements) {
				const move = moveFor(ready[placement.index].spec);
				const headroom = 1 + move.amount;
				// A compass direction pans; "in" and "out" hold centre and scale.
				const PAN: Record<string, [number, number]> = {
					left: [-1, 0],
					right: [1, 0],
					up: [0, -1],
					down: [0, 1],
				};
				const pan = PAN[move.direction] ?? [0, 0];
				const zooming = move.direction === "in" || move.direction === "out";
				next = {
					...next,
					tracks: next.tracks.map((track) => ({
						...track,
						clips: track.clips.map((clip) => {
							if (clip.id !== placement.clipId) return clip;
							const last = Math.max(1, placement.frames - 1);
							return {
								...clip,
								keyframes: {
									...clip.keyframes,
									scale: [
										{
											frame: 0,
											values:
												zooming && move.direction === "out"
													? [headroom, headroom]
													: [1, 1],
											interp: "smooth" as const,
										},
										{
											frame: last,
											values:
												zooming && move.direction === "in"
													? [headroom, headroom]
													: [1, 1],
											interp: "smooth" as const,
										},
									],
									position: [
										{
											frame: 0,
											values: [
												0.5 - (pan[0] * move.amount) / 2,
												0.5 - (pan[1] * move.amount) / 2,
											],
											interp: "smooth" as const,
										},
										{
											frame: last,
											values: [
												0.5 + (pan[0] * move.amount) / 2,
												0.5 + (pan[1] * move.amount) / 2,
											],
											interp: "smooth" as const,
										},
									],
								},
							};
						}),
					})),
				};
			}
			return next;
		});

		for (const [index, entry] of ready.entries()) {
			if (entry.spec.dialogue) {
				// A note, not burnt-in text: narrate_timeline speaks it and the
				// captions are cut from it, so it stays editable.
				api.addComment({ frame: placements[index].start + 2, text: entry.spec.dialogue });
			}
		}

		notice(`${ready.length} scene(s) on the timeline — ${(cursor / fps).toFixed(1)}s.`);
		api.setActiveCinemaGraph(null);
	}, [api, graph, notice]);

	const issues = graphIssues(graph);
	const ready = issues.length === 0 && graph.nodes.length > 0;
	const pending = estimateRun(graph);
	const placeable = readyScenes(graph).length;

	// Everything the panel can say without spending anything. The shot list is
	// the story's own output, so it exists the moment a decomposition has run
	// and long before any picture has.
	const shots = graph.nodes.find((entry) => entry.kind === "story")?.output?.scenes ?? [];
	const problems = preflight(graph);
	const notes = reviewCut(
		shots,
		graph.nodes.find((entry) => entry.kind === "story")?.params.targetSeconds as
			| number
			| undefined,
	);
	const cost = estimateCost(graph.nodes.filter((entry) => needsRun(entry, false)));

	// The run is driven here rather than inside the canvas: the canvas draws a
	// graph, and giving it the ability to spend money would mean every future
	// change to the view has to think about that.
	const run = useCallback(
		async (only?: string[]) => {
			if (running) return;
			// Preflight refuses rather than warns. Displaying a problem beside a
			// button that spends money anyway is the worst of both — the note
			// reads as advice and the money goes.
			const stopping = preflight(graph);
			if (stopping.length > 0) {
				notice(stopping[0], "error");
				return;
			}
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
			// The ledger is optional and never blocks a render. Configured, it
			// records every call; absent, the run is identical minus the history.
			if (!ledger.current) {
				const url = import.meta.env.VITE_CLICKHOUSE_URL ?? "";
				if (url) {
					ledger.current = createClickhouseLedger({
						url,
						user: import.meta.env.VITE_CLICKHOUSE_USER ?? "default",
						password: import.meta.env.VITE_CLICKHOUSE_PASSWORD ?? "",
					});
					// Failing to create the table must not stop the film.
					await ledger.current.init().catch((error) => {
						notice(`Ledger unavailable: ${String(error).slice(0, 120)}`, "error");
						ledger.current = null;
					});
				}
			}

			setRunning(true);
			try {
				const report = await runGraph(provider, graph, {
					only,
					// Progress is written straight back to the graph, so the canvas
					// shows a node going running → ready while the rest still wait.
					// Commit exactly what the runner has, not a patch onto the
					// graph this closure captured — that one is from before the
					// run and using it throws away every output so far.
					onProgress: (_nodeId, _status, live) =>
						// Status ticks are not edits, so they stay out of undo.
						api.updateCinemaGraph(live, { undoable: false }),
					onRecord: (entry) => {
						// Fire and forget, and swallow the failure: bookkeeping must
						// never take a render down with it. The ledger holds what it
						// could not send and retries on the next call.
						void ledger.current
							?.record({
								at: new Date().toISOString().replace("T", " ").replace("Z", ""),
								graphId: graph.id,
								nodeId: entry.nodeId,
								nodeKind: entry.kind,
								model: entry.model ?? "",
								prompt: entry.prompt ?? "",
								seed: entry.seed,
								elapsedMs: entry.elapsedMs,
								ok: entry.ok,
								error: entry.error,
								errorKind: entry.errorKind,
							})
							.catch(() => {});
					},
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

	/**
	 * Auto mode.
	 *
	 * The toggle existed and did nothing — nothing in the app read `graph.auto`,
	 * so the button was a light switch wired to no bulb. This is the wire, and
	 * the guard is the point of it: a debounce so a half-typed sentence never
	 * triggers a pass, a ceiling read from the ledger so a session cannot run
	 * away, and a confirmation once a pass is big enough to be a decision.
	 *
	 * Keyed on how many nodes are stale rather than on the graph, so moving a
	 * node or renaming a film does not restart the timer.
	 */
	useEffect(() => {
		if (!graph.auto || running || pending <= 0) return;
		let live = true;
		const timer = setTimeout(async () => {
			// Read the spend at fire time, not at schedule time: a manual render
			// during the debounce window counts against the same ceiling.
			let spent = 0;
			try {
				spent = (await ledger.current?.spentOn(graph.id))?.calls ?? 0;
			} catch {
				// An unreachable ledger must not become an unlimited budget. Treat
				// an unknown spend as the ceiling reached, and say so — refusing to
				// spend is the safe direction to fail in.
				if (live) notice("Auto mode paused: the ledger is unreachable.", "error");
				return;
			}
			if (!live) return;

			const decision = decideAuto({
				auto: graph.auto,
				pending,
				spent,
				ceiling: Number(import.meta.env.VITE_AUTO_CALL_CEILING) || undefined,
				busy: running,
			});
			if (decision.blocked) {
				notice(decision.blocked, "error");
				return;
			}
			if (!decision.run) return;
			if (decision.confirm && !window.confirm(confirmMessage(pending, spent))) return;
			if (live) void run();
		}, AUTO_DEBOUNCE_MS);

		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [graph.auto, graph.id, pending, running, run, notice]);

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
					className="pmr-button"
					disabled={placeable === 0}
					title={
						placeable === 0
							? "Render some scenes first."
							: `Place ${placeable} scene(s)`
					}
					onClick={commitToCut}
				>
					{placeable ? `To timeline (${placeable})` : "To timeline"}
				</button>
				<button
					type="button"
					className="pmr-button"
					title="Lay the graph out in the order it runs."
					onClick={() => api.updateCinemaGraph(autoLayout(graph))}
				>
					Tidy
				</button>
				<button
					type="button"
					className="pmr-button"
					disabled={shots.length === 0}
					title={
						shots.length
							? "Download the shot list as a spreadsheet."
							: "Decompose the story first."
					}
					onClick={() => {
						download(
							`${graph.name || "film"} shot list.csv`,
							"text/csv",
							shotListCsv(graph, shots, api.timeline.fps),
						);
					}}
				>
					Shot list
				</button>
				<button
					type="button"
					className="pmr-button pmr-button--primary"
					disabled={running || pending === 0}
					// The cost is on the button rather than behind it. A control that
					// spends money should say how much before it is pressed, not
					// after — and this is the one number everybody wants.
					title={
						pending === 0
							? "Everything is up to date."
							: `${cost.summary}. ${problems.length ? `${problems.length} problem(s) to fix first.` : ""}`
					}
					onClick={() => run()}
				>
					{running
						? "Rendering…"
						: pending
							? `Render ${pending} · ~$${cost.usd?.toFixed(2)}`
							: "Up to date"}
				</button>
			</PanelHeader>

			{/* Notes about the film, before anything is rendered. Preflight is
			    what stops a run; the cut notes are advice and never do. Both are
			    free — the expensive part is the render, so every judgement that
			    can happen first should. */}
			{problems.length > 0 || notes.length > 0 ? (
				<div className="cin-notes">
					{problems.map((line) => (
						<p key={line} className="cin-notes__stop">
							{line}
						</p>
					))}
					{notes.map((note) => (
						<p key={note.message} className="cin-notes__note">
							<em>{note.kind}</em>
							{note.sceneIndex !== undefined ? ` shot ${note.sceneIndex + 1}: ` : " "}
							{note.message}
						</p>
					))}
				</div>
			) : null}

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
					ledger={ledger.current}
					onChange={api.updateCinemaGraph}
					onRun={(nodeId) => run([nodeId])}
					onNotice={notice}
				/>
			</div>
		</>
	);
}
