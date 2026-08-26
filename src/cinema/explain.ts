// Reading a prompt back, and reading a cut's grammar.
//
// A generated prompt is assembled from a dozen named pieces and then shown as
// one long sentence, which is how prompt engineering turns into folklore:
// nobody can tell which clause did what, so every change is superstition. This
// takes an assembled prompt apart again and labels the parts.
//
// The histogram is the same idea for the edit — a cut's shot sizes as counts,
// so "it's all mediums" stops being a feeling and becomes a number.

import { COMPOSITIONS, LENSES, LIGHTING, SHOT_SIZES, STOCKS, sizeFromCamera } from "./craft";
import type { SceneSpec } from "./nodes";

export interface Clause {
	/** What this piece of the prompt is for. */
	label: string;
	text: string;
}

const TABLES: Array<[string, Record<string, string>]> = [
	["Shot size", SHOT_SIZES],
	["Composition", COMPOSITIONS],
	["Lens", LENSES],
	["Light", LIGHTING],
	["Stock", STOCKS],
];

/**
 * Splits an assembled scene prompt back into labelled parts.
 *
 * Matched against the same tables that wrote it, so a clause is only labelled
 * when it really came from a known preset. Anything unrecognised is reported
 * as "Written" rather than guessed at — a explainer that invents attributions
 * is worse than none, because it teaches a false model of what the words do.
 */
export function explainPrompt(prompt: string): Clause[] {
	let rest = prompt;
	const found: Clause[] = [];

	for (const [label, table] of TABLES) {
		for (const phrase of Object.values(table)) {
			if (!rest.includes(phrase)) continue;
			found.push({ label, text: phrase });
			rest = rest.replace(phrase, " ");
			break;
		}
	}

	const palette = /Colour palette: ([^.]+)\./.exec(rest);
	if (palette) {
		found.push({ label: "Palette", text: palette[1].trim() });
		rest = rest.replace(palette[0], " ");
	}

	const reference =
		/(The person must match[^.]+\.|Keep the person recognisably[^.]+\.|Use the attached reference[^.]+\.)/.exec(
			rest,
		);
	if (reference) {
		found.push({ label: "Reference", text: reference[1].trim() });
		rest = rest.replace(reference[0], " ");
	}

	const cast = /In frame: ([^.]+)\./.exec(rest);
	if (cast) {
		found.push({ label: "In frame", text: cast[1].trim() });
		rest = rest.replace(cast[0], " ");
	}

	const negative = /(No text, no watermark[^]*?hands\.)/.exec(rest);
	if (negative) {
		found.push({ label: "Kept out", text: negative[1].trim() });
		rest = rest.replace(negative[0], " ");
	}

	const craftWords = "Cinematic still, filmic colour, shallow depth of field.";
	if (rest.includes(craftWords)) {
		found.push({ label: "House style", text: craftWords });
		rest = rest.replace(craftWords, " ");
	}

	const written = rest.replace(/\s+/g, " ").trim();
	if (written) found.unshift({ label: "Written", text: written });

	return found;
}

/**
 * How many shots of each size a cut contains.
 *
 * Only the sizes actually present, largest group first. A histogram padded with
 * eight zeroes hides the one number that matters, which is usually that a
 * single size accounts for most of the film.
 */
export function shotSizeHistogram(scenes: SceneSpec[]): Array<{ size: string; count: number }> {
	const counts = new Map<string, number>();
	for (const scene of scenes) {
		const size = sizeFromCamera(scene.camera) ?? "unclassified";
		counts.set(size, (counts.get(size) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([size, count]) => ({ size, count }))
		.sort((a, b) => b.count - a.count || a.size.localeCompare(b.size));
}

/**
 * The film as a storyboard, in one printable page.
 *
 * Self-contained HTML with the frames inlined, because a storyboard emailed to
 * somebody must not turn into a page of broken images the moment it leaves this
 * machine.
 */
export function storyboardHtml(
	name: string,
	scenes: SceneSpec[],
	frames: Map<number, { base64: string; mimeType: string }>,
): string {
	const escape = (text: string) =>
		text.replace(
			/[&<>"]/g,
			(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
		);

	const cells = [...scenes]
		.sort((a, b) => a.index - b.index)
		.map((scene) => {
			const frame = frames.get(scene.index);
			const image = frame
				? `<img alt="Shot ${scene.index + 1}" src="data:${frame.mimeType};base64,${frame.base64}">`
				: `<div class="none">not rendered</div>`;
			return `<figure>
	${image}
	<figcaption>
		<b>${scene.index + 1}. ${escape(scene.camera)}</b>
		<span>${escape(scene.action)}</span>
		<em>${escape(scene.location)}, ${escape(scene.timeOfDay)} · ${scene.durationSeconds}s</em>
		${scene.dialogue ? `<q>${escape(scene.dialogue)}</q>` : ""}
	</figcaption>
</figure>`;
		})
		.join("\n");

	return `<!doctype html>
<meta charset="utf-8">
<title>${escape(name)} — storyboard</title>
<style>
	body { margin: 0; padding: 32px; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; background: #fff; color: #111; }
	h1 { font-size: 20px; margin: 0 0 4px; }
	p.sub { margin: 0 0 24px; color: #666; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px; }
	figure { margin: 0; break-inside: avoid; }
	img, .none { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; background: #f4f4f5; }
	.none { display: grid; place-items: center; color: #999; font-size: 11px; }
	figcaption { display: grid; gap: 2px; margin-top: 7px; }
	figcaption b { font-size: 12px; }
	figcaption span { color: #333; }
	figcaption em { font-style: normal; color: #777; font-size: 11px; }
	figcaption q { color: #444; font-style: italic; }
	@media print { body { padding: 0; } }
</style>
<h1>${escape(name)}</h1>
<p class="sub">${scenes.length} shot${scenes.length === 1 ? "" : "s"} · ${scenes
		.reduce((sum, s) => sum + s.durationSeconds, 0)
		.toFixed(1)}s</p>
<div class="grid">
${cells}
</div>`;
}
