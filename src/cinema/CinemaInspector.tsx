// Editing one node.
//
// Every field here marks the node and everything downstream of it stale on
// change. That is the whole reason this is not a plain form: editing a
// character's look has to invalidate the six scenes they appear in, or the
// canvas shows renders of a person who has since been redressed and looks
// current while being wrong.

import { useCallback, useEffect, useState } from "react";

import { CRAFT_OPTIONS } from "./craft";
import { explainPrompt } from "./explain";
import { duplicateNode } from "./graphOps";
import type { Ledger, LedgerRow } from "./ledger";
import { VOICES } from "./sound";

type PromptScore = Awaited<ReturnType<Ledger["whatWorks"]>>[number];

import type { CinemaGraph, CinemaNode } from "./nodes";
import { nodeSpec } from "./nodes";
import { markStale } from "./run";

const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;

export interface CinemaInspectorProps {
	graph: CinemaGraph;
	nodeId: string | null;
	/** Absent when Clickhouse is not configured; the history panel says so. */
	ledger?: Ledger | null;
	/**
	 * Bumped once a run's writes have landed.
	 *
	 * Without it the take history is fetched when a node is selected and never
	 * again, so re-running a node left the panel showing the old list — and a
	 * verdict was then offered against a take that was no longer the latest.
	 */
	historyVersion?: number;
	onChange: (next: CinemaGraph) => void;
	onRun: (nodeId: string) => void;
	onNotice: (message: string, tone?: "error" | "info") => void;
}

export function CinemaInspector({
	graph,
	nodeId,
	ledger,
	historyVersion,
	onChange,
	onRun,
	onNotice,
}: CinemaInspectorProps) {
	const [takes, setTakes] = useState<LedgerRow[] | null>(null);
	const [works, setWorks] = useState<PromptScore[] | null>(null);
	const [spend, setSpend] = useState<{ calls: number; costUsd: number } | null>(null);
	const node = graph.nodes.find((entry) => entry.id === nodeId);

	/**
	 * The leaderboard and the running total, loaded only when nothing is
	 * selected.
	 *
	 * Two aggregates over the whole film, so they are not worth running on every
	 * node click — and the empty inspector is the only place they are shown.
	 */
	useEffect(() => {
		if (!ledger || nodeId) return;
		let live = true;
		void Promise.all([ledger.whatWorks(graph.id), ledger.spentOn(graph.id)])
			.then(([leaders, total]) => {
				if (!live) return;
				setWorks(leaders);
				setSpend(total);
			})
			// Same rule as the take history: a panel that cannot load its extras
			// still has to render the thing it is actually for.
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [ledger, graph.id, nodeId, historyVersion]);

	/**
	 * What this node has already been asked, newest first.
	 *
	 * The reason the ledger exists: regenerating a shot without seeing the four
	 * takes you already rejected means paying for the same mistake twice. Loaded
	 * per node rather than up front, because a film's whole history is a lot of
	 * rows and only one node is ever being looked at.
	 */
	useEffect(() => {
		setTakes(null);
		if (!ledger || !nodeId) return;
		let live = true;
		ledger
			.takesFor(graph.id, nodeId)
			.then((rows) => {
				if (live) setTakes(rows);
			})
			// A history that will not load must not break the panel around it.
			.catch(() => {
				if (live) setTakes([]);
			});
		return () => {
			live = false;
		};
	}, [ledger, graph.id, nodeId, historyVersion]);
	/**
	 * Writes a change and invalidates everything it reaches.
	 *
	 * markStale is applied on every edit rather than only on the ones that
	 * "obviously" matter, because the ones that do not obviously matter are
	 * exactly where a stale render survives unnoticed.
	 */
	const edit = useCallback(
		(patch: Partial<CinemaNode>) => {
			if (!node) return;
			const withEdit: CinemaGraph = {
				...graph,
				nodes: graph.nodes.map((entry) =>
					entry.id === node.id ? { ...entry, ...patch } : entry,
				),
			};
			onChange(markStale(withEdit, node.id));
		},
		[graph, node, onChange],
	);

	/**
	 * Records a verdict, and shows it immediately.
	 *
	 * Applied to local state before the write lands because a ClickHouse mutation
	 * is asynchronous — re-reading the table here would return the old value and
	 * read as a button that does nothing. If the write fails the row reverts and
	 * says so, which is the honest outcome.
	 */
	const judge = useCallback(
		(take: LedgerRow, accepted: boolean) => {
			if (!ledger || !nodeId) return;
			const stamp = take.at;
			setTakes(
				(rows) =>
					rows?.map((row) => (row.at === stamp ? { ...row, accepted } : row)) ?? rows,
			);
			ledger.judge(graph.id, nodeId, stamp, accepted).catch(() => {
				setTakes(
					(rows) =>
						rows?.map((row) =>
							row.at === stamp ? { ...row, accepted: undefined } : row,
						) ?? rows,
				);
				onNotice("That verdict did not save.", "error");
			});
		},
		[ledger, graph.id, nodeId, onNotice],
	);

	const param = useCallback(
		(key: string, value: unknown) => {
			if (!node) return;
			edit({ params: { ...node.params, [key]: value } });
		},
		[edit, node],
	);

	if (!node) {
		return (
			<div className="cin-insp cin-insp--empty">
				<p>Select a node to edit it.</p>
				<p className="cin-insp__hint">Click a node on the canvas.</p>
				{/* The second thing the ledger exists for, and it lives here because
				    the empty inspector is the only pane in the app with nothing to
				    say. A leaderboard of phrasings that survived a human is worth
				    more than "nothing selected". */}
				{works && works.length > 0 ? (
					<div className="cin-insp__works">
						<span className="cin-insp__label">What has been working</span>
						<ol>
							{works.map((entry) => (
								<li key={entry.prompt}>
									<span>{entry.prompt.slice(0, 140)}</span>
									<em>
										kept {entry.accepted}/{entry.total}
									</em>
								</li>
							))}
						</ol>
					</div>
				) : null}
				{spend && spend.calls > 0 ? (
					<p className="cin-insp__hint">
						{spend.calls} model call{spend.calls === 1 ? "" : "s"} on this film
						{spend.costUsd > 0 ? ` · $${spend.costUsd.toFixed(2)}` : ""}.
					</p>
				) : null}
			</div>
		);
	}

	const spec = nodeSpec(node.kind);
	const sheet = node.output?.sheet ?? [];

	return (
		<div className="cin-insp">
			<header className="cin-insp__head">
				<h3>{spec?.label}</h3>
				{/* Duplicate carries the wires feeding the node, which is the only
				    thing that makes it worth having — a second take on a shot
				    against the same cast and story, without four drags. */}
				<button
					type="button"
					className="pmr-button"
					title="Copy this node and the wires feeding it."
					onClick={() => {
						onChange(duplicateNode(graph, node.id));
						onNotice(`Duplicated ${node.label ?? spec?.label}.`);
					}}
				>
					Duplicate
				</button>
				{spec?.generative ? (
					<button
						type="button"
						className="pmr-button"
						disabled={node.status === "running"}
						onClick={() => onRun(node.id)}
					>
						{node.status === "running" ? "Running…" : node.output ? "Re-run" : "Run"}
					</button>
				) : null}
			</header>
			<p className="cin-insp__summary">{spec?.summary}</p>

			<label className="cin-insp__field">
				<span>Name</span>
				<input
					value={node.label ?? ""}
					placeholder={spec?.label}
					onChange={(event) => edit({ label: event.target.value })}
				/>
			</label>

			{node.kind === "reference" ? (
				<label className="cin-insp__field">
					<span>Image</span>
					<input
						type="file"
						accept="image/png,image/jpeg,image/webp"
						onChange={async (event) => {
							const file = event.target.files?.[0];
							if (!file) return;
							// 8 MB: a reference is a photograph, and anything larger is
							// a mistake that would be carried in the project file.
							if (file.size > 8 * 1024 * 1024) {
								onNotice("That image is over 8 MB. Use a smaller one.", "error");
								return;
							}
							const base64 = await toBase64(file);
							param("image", { base64, mimeType: file.type });
							edit({ label: node.label ?? file.name });
						}}
					/>
					{(node.params.image as { base64?: string } | undefined)?.base64 ? (
						<img
							className="cin-insp__thumb"
							alt=""
							src={`data:${(node.params.image as { mimeType: string }).mimeType};base64,${(node.params.image as { base64: string }).base64}`}
						/>
					) : null}
				</label>
			) : (
				<label className="cin-insp__field">
					<span>{PROMPT_LABEL[node.kind] ?? "Text"}</span>
					<textarea
						rows={node.kind === "beat" || node.kind === "story" ? 6 : 3}
						value={node.text ?? ""}
						placeholder={PLACEHOLDER[node.kind]}
						onChange={(event) => edit({ text: event.target.value })}
					/>
				</label>
			)}

			{node.kind === "scene" ? (
				<>
					<label className="cin-insp__field">
						<span>Aspect</span>
						<select
							value={(node.params.aspect as string) ?? "16:9"}
							onChange={(event) => param("aspect", event.target.value)}
						>
							{ASPECTS.map((aspect) => (
								<option key={aspect} value={aspect}>
									{aspect}
								</option>
							))}
						</select>
					</label>
					<label className="cin-insp__field">
						<span>Which shot</span>
						<input
							type="number"
							min={1}
							value={((node.params.sceneIndex as number) ?? 0) + 1}
							onChange={(event) =>
								param("sceneIndex", Math.max(0, Number(event.target.value) - 1))
							}
						/>
						<small>
							Which of the story's shots this node renders. Left to itself, scenes
							take their order from their position on the canvas.
						</small>
					</label>
				</>
			) : null}

			{node.kind === "scene" ? (
				<div className="cin-insp__craft">
					<span className="cin-insp__label">Craft</span>
					{/* Every one of these is optional and every one is inferred from
					    the shot's own prose when left alone — so the panel is a way
					    to override a decision, not a form to fill in before
					    anything will render. */}
					{(
						[
							["size", "Shot size"],
							["composition", "Composition"],
							["lens", "Lens"],
							["lighting", "Light"],
							["stock", "Stock"],
						] as const
					).map(([key, label]) => (
						<label key={key} className="cin-insp__field">
							<span>{label}</span>
							<select
								value={(node.params[key] as string) ?? ""}
								onChange={(event) => param(key, event.target.value || undefined)}
							>
								<option value="">from the shot</option>
								{CRAFT_OPTIONS[key].map((option) => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						</label>
					))}
					<label className="cin-insp__field">
						<span>Hold the face</span>
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={(node.params.referenceStrength as number) ?? 0.9}
							onChange={(event) =>
								param("referenceStrength", Number(event.target.value))
							}
						/>
						<small>
							How hard to hold the character sheet. Lower it if a shot keeps coming
							back stiff.
						</small>
					</label>
					<label className="cin-insp__field">
						<span>Keep out</span>
						<input
							value={(node.params.negative as string) ?? ""}
							placeholder="modern cars, visible logos"
							onChange={(event) => param("negative", event.target.value)}
						/>
					</label>
				</div>
			) : null}

			{node.kind === "world" ? (
				<label className="cin-insp__field">
					<span>Palette</span>
					<input
						value={(node.params.palette as string) ?? ""}
						placeholder="rust, sea green, bone"
						onChange={(event) => param("palette", event.target.value)}
					/>
					<small>
						Applied to every shot that has no palette of its own. One palette across a
						film is most of why its shots cut together.
					</small>
				</label>
			) : null}

			{node.kind === "character" ? (
				<label className="cin-insp__field">
					<span>Voice</span>
					<select
						value={(node.params.voice as string) ?? ""}
						onChange={(event) => param("voice", event.target.value || undefined)}
					>
						<option value="">from the description</option>
						{Object.entries(VOICES).map(([key, description]) => (
							<option key={key} value={key}>
								{key} — {description}
							</option>
						))}
					</select>
				</label>
			) : null}

			{node.kind === "story" ? (
				<label className="cin-insp__field">
					<span>Target length</span>
					<input
						type="number"
						min={5}
						max={600}
						value={(node.params.targetSeconds as number) ?? 30}
						onChange={(event) => param("targetSeconds", Number(event.target.value))}
					/>
					<small>Seconds. A guide for how many shots to break the beats into.</small>
				</label>
			) : null}

			{node.error ? <p className="cin-insp__error">{node.error}</p> : null}

			{/* The output, shown rather than described. A character sheet is the
			    one thing you cannot judge from a status word. */}
			{sheet.length > 0 ? (
				<div className="cin-insp__sheet">
					<span className="cin-insp__label">
						{node.kind === "character" ? "Character sheet" : "Render"}
					</span>
					<div className="cin-insp__sheet-grid">
						{sheet.map((image, index) => (
							<img
								key={`${node.id}-${index}`}
								alt=""
								src={`data:${image.mimeType};base64,${image.base64}`}
							/>
						))}
					</div>
				</div>
			) : null}

			{node.output?.text && node.kind !== "scene" ? (
				<div className="cin-insp__out">
					<span className="cin-insp__label">What it produced</span>
					<p>{node.output.text}</p>
				</div>
			) : null}

			{node.output?.scenes?.length ? (
				<div className="cin-insp__out">
					<span className="cin-insp__label">{node.output.scenes.length} shots</span>
					<ol className="cin-insp__shots">
						{node.output.scenes.map((scene) => (
							<li key={scene.id}>
								<strong>{scene.camera}</strong> — {scene.action}
								<em>
									{scene.location}, {scene.timeOfDay} · {scene.durationSeconds}s
								</em>
							</li>
						))}
					</ol>
				</div>
			) : null}

			{/* What was actually asked, taken apart again. A prompt assembled from
			    a dozen named pieces and shown as one long sentence is how prompt
			    engineering turns into folklore — nobody can tell which clause did
			    what, so every change is superstition. */}
			{node.output?.prompt ? (
				<div className="cin-insp__clauses">
					<span className="cin-insp__label">What was asked</span>
					{explainPrompt(node.output.prompt).map((clause) => (
						<p key={`${clause.label}-${clause.text.slice(0, 12)}`}>
							<em>{clause.label}</em>
							<span>{clause.text}</span>
						</p>
					))}
				</div>
			) : null}

			{/* History. Only worth showing once something has been tried, and the
			    failures are the interesting rows — they say why a shot keeps not
			    arriving, which a list of successes cannot. */}
			{ledger && takes && takes.length > 0 ? (
				<div className="cin-insp__takes">
					<span className="cin-insp__label">{takes.length} previous take(s)</span>
					{takes.slice(0, 6).map((take) => (
						<div
							key={`${take.at}-${take.nodeId}`}
							className="cin-insp__take"
							data-failed={!take.ok || undefined}
						>
							<p>
								<strong>{take.at.slice(5, 16)}</strong>
								<em>{take.ok ? take.model : (take.errorKind ?? "failed")}</em>
								<span>
									{take.ok
										? `${(take.elapsedMs / 1000).toFixed(1)}s`
										: take.error}
								</span>
							</p>
							{/* Judging is what turns a table of "a call happened" into one
							    that can say which prompts work. Offered per take rather than
							    on the node, so there is never a question of which picture
							    the verdict landed on. Failures need no verdict — the model
							    already gave one. */}
							{take.ok ? (
								<span className="cin-insp__verdict">
									{take.accepted === undefined ? (
										(["Keep", "Discard"] as const).map((choice) => (
											<button
												key={choice}
												type="button"
												onClick={() => judge(take, choice === "Keep")}
											>
												{choice}
											</button>
										))
									) : (
										<em>{take.accepted ? "kept" : "discarded"}</em>
									)}
								</span>
							) : null}
						</div>
					))}
				</div>
			) : null}
			{ledger === null && spec?.generative ? (
				<p className="cin-insp__hint">
					Connect Clickhouse to keep a history of what was tried.
				</p>
			) : null}

			{node.status === "stale" ? (
				<p className="cin-insp__stale">
					An input changed since this ran. Re-run to bring it up to date.
				</p>
			) : null}
		</div>
	);
}

const PROMPT_LABEL: Partial<Record<CinemaNode["kind"], string>> = {
	character: "Who they are",
	world: "The world",
	beat: "What happens",
	story: "Premise",
	trait: "Trait",
	look: "Wardrobe",
	voice: "Voice",
	scene: "Note",
};

const PLACEHOLDER: Partial<Record<CinemaNode["kind"], string>> = {
	character: "A dock worker in her fifties, tired, careful with her hands.",
	world: "Coastal Kerala, monsoon, 1997. Green light, long lenses.",
	beat: "She finds the letter behind the radio.",
	story: "One line is enough — the beats can be generated from it.",
	trait: "Walks with a limp",
	look: "Faded blue overalls, silver rings",
	voice: "Low, unhurried, slight rasp",
};

async function toBase64(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	let binary = "";
	const bytes = new Uint8Array(buffer);
	// Chunked: spreading a megabyte-sized array into String.fromCharCode blows
	// the argument limit and throws.
	for (let i = 0; i < bytes.length; i += 8192) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
	}
	return btoa(binary);
}
