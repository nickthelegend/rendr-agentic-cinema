// A local stand-in for the model, for developing without a key.
//
// This is a test double, not a feature. It draws a labelled placeholder card
// instead of an image and returns canned structure instead of prose, and it
// says so on every frame it produces — "STUB" is painted into the picture so a
// placeholder can never be mistaken for a render in a screenshot or a demo.
//
// It exists because the pipeline is worth exercising end to end without
// spending quota: the runner, the staleness rules, the inspector, the sheet
// display and the timeline plan are all independent of which model answered.
// What it cannot verify is the one thing only the real API can — whether the
// request shape is right.

import type { CinemaProvider, ImageBytes } from "./provider";

/** Deterministic, so a rerun of the same prompt draws the same card. */
function hash(text: string): number {
	let value = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		value ^= text.charCodeAt(i);
		value = Math.imul(value, 0x01000193);
	}
	return Math.abs(value);
}

const PALETTE = ["#2E4057", "#48A9A6", "#4B3F72", "#7D4E57", "#3D5A6C", "#5C6672"];

function placeholder(prompt: string, aspect: string, seed: number): ImageBytes {
	const [w, h] =
		aspect === "9:16"
			? [540, 960]
			: aspect === "4:5"
				? [720, 900]
				: aspect === "1:1"
					? [800, 800]
					: [960, 540];
	const tint = PALETTE[seed % PALETTE.length];
	// Wrapped by hand: an SVG <text> does not wrap, and a single long line
	// running off the card tells you nothing about what was asked for.
	const words = prompt.split(/\s+/);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		if ((line + word).length > 42) {
			lines.push(line.trim());
			line = "";
			if (lines.length >= 7) break;
		}
		line += `${word} `;
	}
	if (line.trim() && lines.length < 8) lines.push(line.trim());

	const escaped = (text: string) =>
		text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${tint}"/>
<rect x="12" y="12" width="${w - 24}" height="${h - 24}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2" stroke-dasharray="10 8"/>
<text x="26" y="52" fill="rgba(255,255,255,.9)" font-family="monospace" font-size="26" font-weight="700">STUB · no model was called</text>
${lines
	.map(
		(text, index) =>
			`<text x="26" y="${104 + index * 26}" fill="rgba(255,255,255,.72)" font-family="monospace" font-size="17">${escaped(text)}</text>`,
	)
	.join("\n")}
<text x="26" y="${h - 24}" fill="rgba(255,255,255,.5)" font-family="monospace" font-size="15">seed ${seed}</text>
</svg>`;

	return { base64: btoa(unescape(encodeURIComponent(svg))), mimeType: "image/svg+xml" };
}

/**
 * Canned scenes for a decomposition, so the story path runs without a model.
 *
 * Varied deliberately — framings differ and the time of day holds — so the
 * continuity checker has something realistic to pass, rather than a set that
 * trivially satisfies it.
 */
function cannedScenes(castNames: string[]): string {
	const who = castNames.length ? [castNames[0]] : [];
	return JSON.stringify({
		scenes: [
			{
				characterNames: [],
				location: "a rain-dark street",
				timeOfDay: "night",
				camera: "wide establishing, static",
				action: "the street empties",
				durationSeconds: 4,
			},
			{
				characterNames: who,
				location: "a rain-dark street",
				timeOfDay: "night",
				camera: "medium, slow push",
				action: "they stop under the awning",
				durationSeconds: 3.5,
			},
			{
				characterNames: who,
				location: "a rain-dark street",
				timeOfDay: "night",
				camera: "close on their hands",
				action: "they unfold the paper",
				dialogue: "You kept it.",
				durationSeconds: 3,
			},
		],
	});
}

export function createStubProvider(): CinemaProvider {
	return {
		name: "stub",

		async text(request) {
			await new Promise((resolve) => setTimeout(resolve, 140));
			if (request.schema) {
				// The cast names are in the prompt; pulling them back out keeps the
				// stub's scenes referencing characters that actually exist, which is
				// what makes the name-matching path testable.
				const match = /The cast: ([^.]+)\./.exec(request.prompt);
				const names = match ? match[1].split(",").map((name) => name.trim()) : [];
				return { text: cannedScenes(names), model: "stub-text", elapsedMs: 140 };
			}
			return {
				text: `[stub] ${request.prompt.slice(0, 160)}`,
				model: "stub-text",
				elapsedMs: 140,
			};
		},

		async image(request) {
			// Slow enough that the running state is visible on the canvas, fast
			// enough that a full graph finishes while you watch it.
			await new Promise((resolve) => setTimeout(resolve, 260));
			const seed = request.seed ?? hash(request.prompt);
			return {
				image: placeholder(request.prompt, request.aspect ?? "16:9", seed),
				model: "stub-image",
				elapsedMs: 260,
			};
		},
	};
}
