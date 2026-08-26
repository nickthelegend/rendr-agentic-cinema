// The two things worth showing a judge, behind one overlay.
//
// Consistency is the project's technical claim — the same face across every
// shot — and until this panel existed it was only ever true, never visible.
// The ledger tab is the partner integration doing something a log file cannot:
// aggregates computed in the database and read back as the shape of a film's
// spend.
//
// Deliberately read-only. Nothing here edits a graph, so it can be opened
// mid-run without any risk of fighting the runner for state.

import { useEffect, useState } from "react";

import { type CastConsistency, castConsistency, consistencySummary } from "./consistency";
import { shotSizeHistogram, storyboardHtml } from "./explain";
import type { Ledger, LedgerInsights } from "./ledger";
import type { CinemaGraph } from "./nodes";

export interface CinemaReportProps {
	graph: CinemaGraph;
	/**
	 * Which tab to open on.
	 *
	 * The panel used to always open on Consistency, so the History control and
	 * the Ledger command both landed on the cast — a control that opens the
	 * wrong page is worse than one that does nothing, because it looks like it
	 * worked.
	 */
	initialTab?: "cast" | "ledger";
	/** Hands the storyboard to the browser. */
	onDownload: (name: string, type: string, body: string) => void;
	ledger?: Ledger | null;
	onClose: () => void;
}

const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`);

function Sheet({ who }: { who: CastConsistency }) {
	return (
		<section className="crep__who">
			<header>
				<h4>{who.name}</h4>
				<span>
					{who.appearances.length} shot{who.appearances.length === 1 ? "" : "s"}
					{who.pending > 0 ? ` · ${who.pending} not rendered` : ""}
					{who.seed !== undefined ? ` · seed ${who.seed}` : ""}
				</span>
			</header>

			{who.sheet.length > 0 ? (
				<div className="crep__row">
					<span className="crep__tag">Locked</span>
					{who.sheet.map((image, index) => (
						<img
							key={`${who.id}-sheet-${index}`}
							alt={`${who.name}, reference view ${index + 1}`}
							src={`data:${image.mimeType};base64,${image.base64}`}
						/>
					))}
				</div>
			) : (
				<p className="crep__none">Not locked yet — run this character.</p>
			)}

			{who.appearances.length > 0 ? (
				<div className="crep__row crep__row--shots">
					<span className="crep__tag">In frame</span>
					{who.appearances.map((shot) => (
						<figure key={`${who.id}-${shot.sceneIndex}`}>
							<img
								alt={`${who.name} in shot ${shot.sceneIndex + 1}`}
								src={
									shot.image
										? `data:${shot.image.mimeType};base64,${shot.image.base64}`
										: undefined
								}
							/>
							<figcaption>
								{shot.sceneIndex + 1}. {shot.camera}
							</figcaption>
						</figure>
					))}
				</div>
			) : null}
		</section>
	);
}

export function CinemaReport({
	graph,
	ledger,
	initialTab = "cast",
	onDownload,
	onClose,
}: CinemaReportProps) {
	const [tab, setTab] = useState<"cast" | "ledger">(initialTab);
	const [insights, setInsights] = useState<LedgerInsights | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (!ledger || tab !== "ledger") return;
		let live = true;
		ledger
			.insights(graph.id)
			.then((data) => {
				if (live) setInsights(data);
			})
			// A panel that cannot load its numbers says so rather than showing
			// zeros, which would read as a film that cost nothing.
			.catch(() => {
				if (live) setFailed(true);
			});
		return () => {
			live = false;
		};
	}, [ledger, graph.id, tab]);

	const cast = castConsistency(graph);
	const shots = graph.nodes.find((node) => node.kind === "story")?.output?.scenes ?? [];
	const histogram = shotSizeHistogram(shots);
	const widest = Math.max(1, ...histogram.map((entry) => entry.count));

	// Frames keyed by which shot they render, for the storyboard.
	const frames = new Map<number, { base64: string; mimeType: string }>();
	graph.nodes
		.filter((node) => node.kind === "scene")
		.forEach((node, fallback) => {
			const which =
				typeof node.params.sceneIndex === "number" ? node.params.sceneIndex : fallback;
			const image = node.output?.sheet?.[0];
			if (image && !frames.has(which)) frames.set(which, image);
		});

	// Escape closes it. An overlay without that is a trap on a laptop.
	//
	// Registered in the capture phase, which is not fussiness: something between
	// the canvas and the window stops Escape from propagating — React Flow uses
	// it to cancel a connection — so a bubble-phase listener here never fired
	// for a real keypress. It worked under a synthetic event dispatched straight
	// at the window, which is exactly the kind of false pass that makes a
	// keyboard bug survive testing.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	return (
		<div className="crep" role="dialog" aria-label="Film report" aria-modal="true">
			<div className="crep__panel">
				<header className="crep__head">
					<div className="crep__tabs" role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={tab === "cast"}
							data-on={tab === "cast" || undefined}
							onClick={() => setTab("cast")}
						>
							Consistency
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={tab === "ledger"}
							data-on={tab === "ledger" || undefined}
							onClick={() => setTab("ledger")}
						>
							Ledger
						</button>
					</div>
					<button
						type="button"
						className="crep__close"
						aria-label="Close"
						onClick={onClose}
					>
						Close
					</button>
				</header>

				{tab === "cast" ? (
					<div className="crep__body">
						<div className="crep__topline">
							<p className="crep__lede">{consistencySummary(cast)}</p>
							<button
								type="button"
								className="crep__close"
								disabled={shots.length === 0}
								title={
									shots.length === 0
										? "Decompose the story first"
										: "A printable page of every shot"
								}
								onClick={() =>
									onDownload(
										`${graph.name || "film"} storyboard.html`,
										"text/html",
										storyboardHtml(graph.name, shots, frames),
									)
								}
							>
								Storyboard
							</button>
						</div>

						{histogram.length > 0 ? (
							<div className="crep__hist">
								<span className="crep__tag">Shot sizes</span>
								{histogram.map((entry) => (
									<p key={entry.size}>
										<span>{entry.size}</span>
										<i
											style={{ transform: `scaleX(${entry.count / widest})` }}
										/>
										<em>{entry.count}</em>
									</p>
								))}
							</div>
						) : null}
						{cast.length === 0 ? (
							<p className="crep__none">
								Add a Character node and run it. The sheet it locks is what every
								scene refers back to.
							</p>
						) : (
							cast.map((who) => <Sheet key={who.id} who={who} />)
						)}
					</div>
				) : (
					<div className="crep__body">
						{!ledger ? (
							<p className="crep__none">
								No ledger is connected, so there is nothing recorded to read back.
							</p>
						) : failed ? (
							<p className="crep__none">The ledger could not be read just now.</p>
						) : !insights ? (
							<p className="crep__none">Reading the ledger…</p>
						) : insights.calls === 0 ? (
							<p className="crep__none">
								Nothing has been generated for this film yet.
							</p>
						) : (
							<>
								<div className="crep__stats">
									<div>
										<b>{insights.calls}</b>
										<em>model calls</em>
									</div>
									<div>
										<b>{insights.failures}</b>
										<em>failed</em>
									</div>
									<div>
										<b>{ms(insights.medianMs)}</b>
										<em>median</em>
									</div>
									<div>
										<b>{ms(insights.p95Ms)}</b>
										<em>p95</em>
									</div>
									<div>
										<b>
											{insights.keptRate === undefined
												? "—"
												: `${Math.round(insights.keptRate * 100)}%`}
										</b>
										<em>kept</em>
									</div>
								</div>

								<h4 className="crep__sub">By node kind</h4>
								<table className="crep__table">
									<thead>
										<tr>
											<th>Kind</th>
											<th>Calls</th>
											<th>Failed</th>
											<th>Median</th>
										</tr>
									</thead>
									<tbody>
										{insights.byKind.map((row) => (
											<tr key={row.kind}>
												<td>{row.kind}</td>
												<td>{row.calls}</td>
												<td data-bad={row.failures > 0 || undefined}>
													{row.failures}
												</td>
												<td>{ms(row.medianMs)}</td>
											</tr>
										))}
									</tbody>
								</table>

								{insights.failureMix.length > 0 ? (
									<>
										<h4 className="crep__sub">Why calls failed</h4>
										<ul className="crep__mix">
											{insights.failureMix.map((row) => (
												<li key={row.kind}>
													<span>{row.kind}</span>
													<em>{row.count}</em>
												</li>
											))}
										</ul>
									</>
								) : null}
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
