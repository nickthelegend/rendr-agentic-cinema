// The cinema graph, mounted.
//
// Thin on purpose: it owns the active-graph lookup and the empty state, and
// hands everything else to the canvas. The graph's rules are in nodes.ts, the
// drawing is in CinemaCanvas.tsx, and this is the seam between them and the
// editor's state.

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { withDefaults } from "../palmier-ui/model";
import { PanelHeader } from "../palmier-ui/Panel";
import type { EditorApi } from "../palmier-ui/state";
import { AUTO_DEBOUNCE_MS, confirmMessage, DEFAULT_CALL_CEILING, decideAuto } from "./auto";
import { CinemaCanvas } from "./CinemaCanvas";
import { CinemaInspector } from "./CinemaInspector";
import { CinemaReport } from "./CinemaReport";
import { CinemaShell } from "./CinemaShell";
import { CHECK_MODELS, type CheckResult, checkConnection } from "./checkConnection";
import { readyScenes } from "./commit";
import { exportFilm, shotListCsv } from "./deliver";
import { addNode, autoLayout, preflight } from "./graphOps";
import { createClickhouseLedger, type Ledger } from "./ledger";
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

export function CinemaPanel({ api, menu }: { api: EditorApi; menu?: React.ReactNode }) {
	const { state, toast } = api;
	const graph = state.cinemaGraphs.find((entry) => entry.id === state.activeCinemaGraphId);

	const [running, setRunning] = useState(false);
	const [checks, setChecks] = useState<CheckResult[] | null>(null);
	const ledger = useRef<Ledger | null>(null);
	const [checking, setChecking] = useState(false);
	// What this film has spent, for the budget the shell shows. Refreshed after
	// every run rather than polled: nothing else moves it.
	const [spent, setSpent] = useState(0);
	const [showMap, setShowMap] = useState(false);
	const [showThumbs, setShowThumbs] = useState(true);
	const [showGrid, setShowGrid] = useState(true);
	const [showNotes, setShowNotes] = useState(true);
	const [tool, setTool] = useState<"select" | "pan">("select");
	const [report, setReport] = useState<null | "cast" | "ledger">(null);
	// How much of the current run is done, for the fill on the render control.
	const [progress, setProgress] = useState(0);
	// Flips once the ledger is connected, so the inspector re-renders with it.
	const [ledgerReady, setLedgerReady] = useState(false);
	// Incremented once a run's ledger writes have landed, so the inspector
	// refetches a node's history instead of showing the list from before it ran.
	const [historyVersion, setHistoryVersion] = useState(0);
	const notice = useCallback(
		(message: string, tone?: "error" | "info") =>
			toast(message, tone === "error" ? "error" : undefined),
		[toast],
	);

	/**
	 * Connects the ledger and makes sure its table exists.
	 *
	 * Called when a film opens rather than only when a render starts. Deferring
	 * it to the first run meant everything that *reads* the ledger was dead
	 * until something had been written in this session: the budget sat at the
	 * ceiling, a node's take history never loaded, and the prompt leaderboard
	 * stayed empty even with rows in the table from earlier work.
	 */
	const connectLedger = useCallback(async (): Promise<Ledger | null> => {
		if (ledger.current) return ledger.current;
		const url = import.meta.env.VITE_CLICKHOUSE_URL ?? "";
		if (!url) return null;
		const next = createClickhouseLedger({
			url,
			// Empty in a hosted build: the server proxy holds the credential.
			user: import.meta.env.VITE_CLICKHOUSE_USER || undefined,
			password: import.meta.env.VITE_CLICKHOUSE_PASSWORD || undefined,
		});
		try {
			await next.init();
		} catch (error) {
			// Bookkeeping never blocks a film. Say so once and carry on.
			notice(`Ledger unavailable: ${String(error).slice(0, 120)}`, "error");
			return null;
		}
		ledger.current = next;
		return next;
	}, [notice]);

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
			await connectLedger();

			setRunning(true);
			try {
				const report = await runGraph(provider, graph, {
					only,
					// An explicit "Re-run" on a node means redo it, even though it
					// already has an output. Without this, needsRun saw a ready
					// node, skipped it, and the button did nothing at all — it was
					// only ever able to run a node that had never run.
					force: only !== undefined,
					// Progress is written straight back to the graph, so the canvas
					// shows a node going running → ready while the rest still wait.
					// Commit exactly what the runner has, not a patch onto the
					// graph this closure captured — that one is from before the
					// run and using it throws away every output so far.
					onProgress: (_nodeId, status, live) => {
						// Counted off the graph the runner hands back rather than a
						// local tally, so a skipped node moves the bar too.
						if (status === "ready" || status === "failed") {
							const done = live.nodes.filter(
								(entry) => entry.status === "ready" || entry.status === "failed",
							).length;
							setProgress(Math.min(1, done / Math.max(1, live.nodes.length)));
						}
						// Status ticks are not edits, so they stay out of undo. This
						// line is what makes the canvas move during a run at all —
						// an early return above it once silently froze every node at
						// idle until the run finished.
						api.updateCinemaGraph(live, { undoable: false });
					},
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
				setProgress(0);
				// The budget in the shell is only meaningful if it moves. Read it
				// back after the run rather than counting locally, so a manual
				// render and an automatic one agree.
				void ledger.current
					?.spentOn(graph.id)
					.then((total) => {
						setSpent(total.calls);
						// The round-trip that reads the spend also proves the run's
						// inserts have landed, which is the moment the history is
						// worth refetching.
						setHistoryVersion((version) => version + 1);
					})
					.catch(() => {});
			}
		},
		[api, graph, notice, running],
	);

	// Once when the film opens, so the budget, the take history and the prompt
	// leaderboard are all live before anything has been run this session.
	useEffect(() => {
		let live = true;
		// `running` belongs to a run, not to the panel. Switching films while one
		// was in flight left the new film's Render button reading "Rendering…"
		// and refusing every click, because this component outlives the graph it
		// is showing.
		setRunning(false);
		void connectLedger().then((led) => {
			if (!live || !led) return;
			setLedgerReady(true);
			return led
				.spentOn(graph.id)
				.then((total) => {
					if (live) setSpent(total.calls);
				})
				.catch(() => {});
		});
		return () => {
			live = false;
		};
	}, [graph.id, connectLedger]);

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
			//
			// The absent-ledger case is checked before the call, not after it. As
			// `(await ledger.current?.spentOn(id))?.calls ?? 0` this short-circuits
			// on a null ledger, never throws, and yields a spend of zero — so with
			// Clickhouse unreachable auto mode believed it had spent nothing and
			// rendered anyway. An unknown spend has to read as the ceiling reached,
			// which is what the comment claimed and the code did not do.
			const led = ledger.current;
			if (!led) {
				if (live) {
					notice(
						"Auto mode paused: the ledger is unreachable, so the spend so far is unknown.",
						"error",
					);
				}
				return;
			}
			let spent: number;
			try {
				spent = (await led.spentOn(graph.id)).calls;
			} catch {
				// Same reasoning: refusing to spend is the safe direction to fail.
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
			<CinemaShell
				menu={menu}
				filmName={graph.name}
				view="canvas"
				// The timeline is the editor, not another tab of this canvas — so the
				// view switch hands the window back rather than swapping a pane.
				onView={(next) => {
					if (next === "timeline") api.setActiveCinemaGraph(null);
				}}
				empty={graph.nodes.length === 0}
				onCreate={(kind) => api.updateCinemaGraph(addNode(graph, kind))}
				onTemplates={() => api.setActiveCinemaGraph(null)}
				onUpload={() => api.updateCinemaGraph(addNode(graph, "reference"))}
				running={running}
				pending={pending}
				costUsd={cost.usd}
				progress={progress}
				onRender={() => run()}
				callsLeft={Math.max(0, DEFAULT_CALL_CEILING - spent)}
				auto={graph.auto}
				onAuto={() => api.updateCinemaGraph({ ...graph, auto: !graph.auto })}
				problems={problems.length}
				notes={notes.length}
				canUndo={state.cinemaUndo.length > 0}
				onUndo={api.undoCinema}
				onTidy={() => api.updateCinemaGraph(autoLayout(graph))}
				onShotList={() =>
					shots.length
						? download(
								`${graph.name || "film"} shot list.csv`,
								"text/csv",
								shotListCsv(graph, shots, api.timeline.fps),
							)
						: notice("Decompose the story first — there are no shots yet.", "error")
				}
				onToTimeline={commitToCut}
				placeable={placeable}
				onTestConnection={testConnection}
				onExport={() =>
					download(
						`${graph.name || "film"}.film.json`,
						"application/json",
						exportFilm(graph),
					)
				}
				onAssets={() => api.setActiveCinemaGraph(null)}
				showMap={showMap}
				onToggleMap={() => setShowMap((on) => !on)}
				tool={tool}
				onTool={setTool}
				showThumbs={showThumbs}
				onToggleThumbs={() => setShowThumbs((on) => !on)}
				showGrid={showGrid}
				onToggleGrid={() => setShowGrid((on) => !on)}
				showNotes={showNotes}
				onToggleNotes={() => setShowNotes((on) => !on)}
				onSelectAll={() => {
					// Selecting a node is what fills the inspector, so "select every
					// node" means opening the first and telling you how many there
					// are — the canvas has no multi-node inspector to show.
					const first = graph.nodes[0];
					if (!first) {
						notice("There is nothing on this canvas yet.");
						return;
					}
					api.selectCinemaNode(first.id);
					notice(`${graph.nodes.length} node(s) on this canvas.`);
				}}
				onCast={() => setReport("cast")}
				onAddNode={() => api.updateCinemaGraph(addNode(graph, "beat"))}
				onAgent={() => api.patch({ agentPanelVisible: !state.agentPanelVisible })}
				onShortcuts={() =>
					notice("⌘Z undoes the graph. Double-click the canvas to add a node.")
				}
				onHistory={() => setReport("ledger")}
				language="EN"
				onLanguage={() => notice("This build ships English only.")}
				aside={
					graph.nodes.length === 0 ? null : (
						<CinemaInspector
							graph={graph}
							nodeId={state.selectedCinemaNodeId}
							ledger={ledgerReady ? ledger.current : null}
							historyVersion={historyVersion}
							onChange={api.updateCinemaGraph}
							onRun={(nodeId) => run([nodeId])}
							onNotice={notice}
						/>
					)
				}
			>
				<CinemaCanvas
					tool={tool}
					graph={graph}
					onChange={api.updateCinemaGraph}
					onOpenNode={api.selectCinemaNode}
					onNotice={notice}
				/>

				{/* Notes about the film, before anything is rendered. Preflight is
				    what stops a run; the cut notes are advice and never do. Both are
				    free — the expensive part is the render. */}
				{showNotes &&
				graph.nodes.length > 0 &&
				(problems.length > 0 || notes.length > 0) ? (
					<div className="cin-notes cin-notes--float">
						{problems.map((line) => (
							<p key={line} className="cin-notes__stop">
								{line}
							</p>
						))}
						{notes.map((note) => (
							<p key={note.message} className="cin-notes__note">
								<em>{note.kind}</em>
								{note.sceneIndex !== undefined
									? ` shot ${note.sceneIndex + 1}: `
									: " "}
								{note.message}
							</p>
						))}
					</div>
				) : null}

				{checks ? (
					<div className="cin-checks cin-checks--float">
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
				{report ? (
					<CinemaReport
						graph={graph}
						ledger={ledgerReady ? ledger.current : null}
						onClose={() => setReport(null)}
					/>
				) : null}
			</CinemaShell>
		</>
	);
}
