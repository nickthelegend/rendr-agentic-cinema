// Editing one node.
//
// Every field here marks the node and everything downstream of it stale on
// change. That is the whole reason this is not a plain form: editing a
// character's look has to invalidate the six scenes they appear in, or the
// canvas shows renders of a person who has since been redressed and looks
// current while being wrong.

import { useCallback } from "react";

import type { CinemaGraph, CinemaNode } from "./nodes";
import { nodeSpec } from "./nodes";
import { markStale } from "./run";

const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;

export interface CinemaInspectorProps {
	graph: CinemaGraph;
	nodeId: string | null;
	onChange: (next: CinemaGraph) => void;
	onRun: (nodeId: string) => void;
	onNotice: (message: string, tone?: "error" | "info") => void;
}

export function CinemaInspector({
	graph,
	nodeId,
	onChange,
	onRun,
	onNotice,
}: CinemaInspectorProps) {
	const node = graph.nodes.find((entry) => entry.id === nodeId);

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
				<p className="cin-insp__hint">Double-click a node on the canvas.</p>
			</div>
		);
	}

	const spec = nodeSpec(node.kind);
	const sheet = node.output?.sheet ?? [];

	return (
		<div className="cin-insp">
			<header className="cin-insp__head">
				<h3>{spec?.label}</h3>
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
