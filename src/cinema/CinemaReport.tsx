// The three things worth showing a judge, behind one overlay.
//
// Consistency is the project's technical claim — the same face across every
// shot — and until this panel existed it was only ever true, never visible.
// The ledger tab is the partner integration doing something a log file cannot:
// aggregates computed in the database and read back as the shape of a film's
// spend. Provenance is the answer to the question generative video cannot dodge
// — which frames came out of a model, from what prompt — written somewhere the
// person asking does not have to trust us about.
//
// Deliberately read-only. Nothing here edits a graph, so it can be opened
// mid-run without any risk of fighting the runner for state.

import { useEffect, useState } from "react";

import { type CastConsistency, castConsistency, consistencySummary } from "./consistency";
import { shotSizeHistogram, storyboardHtml } from "./explain";
import type { Ledger, LedgerInsights } from "./ledger";
import type { CinemaGraph } from "./nodes";
import {
	digestOf,
	type Manifest,
	manifestOf,
	notarise,
	type Receipt,
	type Verification,
	verify,
} from "./provenance";

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
	initialTab?: "cast" | "ledger" | "chain";
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
	const [tab, setTab] = useState<"cast" | "ledger" | "chain">(initialTab);
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
	const manifest = manifestOf(graph);
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
						<button
							type="button"
							role="tab"
							aria-selected={tab === "chain"}
							data-on={tab === "chain" || undefined}
							onClick={() => setTab("chain")}
						>
							Provenance
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
				) : null}

				{/* Explicit rather than an `else`: the ledger body used to be the
				    fallback for every tab that was not Consistency, so adding a
				    third tab put "Reading the ledger…" above the provenance
				    panel. A two-tab assumption survived the third tab silently. */}
				{tab === "ledger" ? (
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
				) : null}

				{tab === "chain" ? <Provenance graph={graph} manifest={manifest} /> : null}
			</div>
		</div>
	);
}

/**
 * What was generated, signed onto a public chain.
 *
 * The receipt is deliberately not enough on its own — it is something we
 * printed. The verify button is the part that matters: it fetches the
 * transaction back from the network, recomputes this film's digest locally, and
 * compares. A green line here means someone who does not trust this app can run
 * the same check from the explorer link.
 */
function Provenance({ graph, manifest }: { graph: CinemaGraph; manifest: Manifest }) {
	const [receipt, setReceipt] = useState<Receipt | null>(null);
	const [checked, setChecked] = useState<Verification | null>(null);
	const [busy, setBusy] = useState<"sign" | "verify" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [digest, setDigest] = useState("");

	// The digest of the film as it stands, shown before anything is signed so
	// the number on screen is the one that will go on chain.
	useEffect(() => {
		let live = true;
		digestOf(manifest).then((value) => {
			if (live) setDigest(value);
		});
		return () => {
			live = false;
		};
	}, [manifest]);

	const sign = async () => {
		setBusy("sign");
		setError(null);
		try {
			const signed = await notarise(graph);
			setReceipt(signed);
			setChecked(null);
		} catch (problem) {
			setError(String(problem instanceof Error ? problem.message : problem));
		} finally {
			setBusy(null);
		}
	};

	const check = async (hash: string) => {
		setBusy("verify");
		setError(null);
		try {
			setChecked(await verify(graph, hash));
		} catch (problem) {
			setError(String(problem instanceof Error ? problem.message : problem));
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="crep__body">
			<p className="crep__lede">
				{manifest.shots === 0
					? "Nothing has rendered yet, so there is nothing to notarise."
					: `${manifest.shots} rendered shot${manifest.shots === 1 ? "" : "s"} from ` +
						`${manifest.model}${manifest.seed === null ? "" : `, seed ${manifest.seed}`}.`}
			</p>

			<dl className="crep__kv">
				<div>
					<dt>Digest</dt>
					<dd className="crep__mono">{digest || "…"}</dd>
				</div>
				<div>
					<dt>Network</dt>
					<dd>Stellar testnet — test funds, no value</dd>
				</div>
			</dl>

			<div className="crep__acts">
				<button
					type="button"
					className="crep__close"
					disabled={manifest.shots === 0 || busy !== null}
					onClick={() => void sign()}
				>
					{busy === "sign" ? "Signing…" : "Notarise this cut"}
				</button>
				{receipt ? (
					<button
						type="button"
						className="crep__close"
						disabled={busy !== null}
						onClick={() => void check(receipt.hash)}
					>
						{busy === "verify" ? "Reading the chain…" : "Verify from chain"}
					</button>
				) : null}
			</div>

			{error ? <p className="crep__bad">{error}</p> : null}

			{receipt ? (
				<dl className="crep__kv">
					<div>
						<dt>Transaction</dt>
						<dd className="crep__mono">{receipt.hash}</dd>
					</div>
					<div>
						<dt>Ledger</dt>
						<dd>{receipt.ledger}</dd>
					</div>
					<div>
						<dt>Signed by</dt>
						<dd className="crep__mono">{receipt.account}</dd>
					</div>
					<div>
						<dt>Explorer</dt>
						<dd>
							<a href={receipt.explorer} target="_blank" rel="noreferrer noopener">
								{receipt.explorer.replace(/^https:\/\//, "")}
							</a>
						</dd>
					</div>
				</dl>
			) : null}

			{checked ? (
				<p className={checked.matches ? "crep__good" : "crep__bad"}>
					{checked.matches
						? `The chain holds this exact cut. Read back from ledger ` +
							`${checked.record.ledger}${checked.record.at ? ` at ${checked.record.at}` : ""}.`
						: `The cut has changed since it was notarised — the chain holds ` +
							`${checked.record.digest.slice(0, 12)}…, this film hashes to ` +
							`${checked.expected.slice(0, 12)}…. Notarise again.`}
				</p>
			) : null}

			<h4 className="crep__sub">What goes on chain</h4>
			<p className="crep__note">
				The digest above, and three readable fields: the film's name, its shot count and the
				model. Not the frames — those are megabytes. Their fingerprints are inside the
				manifest the digest covers, so a frame can still be proved to be one of the ones
				that was signed.
			</p>
			<ul className="crep__mix">
				{manifest.prompts.slice(0, 8).map((prompt, index) => (
					<li key={`${prompt}-${index}`}>
						<span>{prompt}</span>
						<em className="crep__mono">{manifest.frames[index]?.slice(0, 8) ?? ""}</em>
					</li>
				))}
			</ul>
		</div>
	);
}
