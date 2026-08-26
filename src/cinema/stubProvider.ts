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

/**
 * A labelled placeholder card, as a PNG.
 *
 * PNG rather than SVG, which is what this drew first. The media library accepts
 * PNG, JPEG and HEIC, so an SVG placeholder imported as nothing and the whole
 * commit refused — the stub was producing something the rest of the app could
 * not accept, which made it useless for testing the one path it exists to test.
 * Real providers return PNG anyway, so this is also closer to the thing it
 * stands in for.
 */
function placeholder(prompt: string, aspect: string, seed: number): ImageBytes {
	const [w, h] =
		aspect === "9:16"
			? [540, 960]
			: aspect === "4:5"
				? [720, 900]
				: aspect === "1:1"
					? [800, 800]
					: [960, 540];

	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const context = canvas.getContext("2d");
	if (!context) {
		// A 1x1 transparent PNG, so a caller still gets bytes it can import.
		return {
			base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			mimeType: "image/png",
		};
	}

	context.fillStyle = PALETTE[seed % PALETTE.length];
	context.fillRect(0, 0, w, h);
	context.strokeStyle = "rgba(255,255,255,.28)";
	context.lineWidth = 2;
	context.setLineDash([10, 8]);
	context.strokeRect(12, 12, w - 24, h - 24);

	context.fillStyle = "rgba(255,255,255,.92)";
	context.font = "700 26px monospace";
	context.fillText("STUB · no model was called", 26, 52);

	// Wrapped by hand: canvas fillText does not wrap, and one long line running
	// off the card tells you nothing about what was asked for.
	context.font = "17px monospace";
	context.fillStyle = "rgba(255,255,255,.74)";
	let line = "";
	let y = 104;
	for (const word of prompt.split(/\s+/)) {
		if ((line + word).length > 46) {
			context.fillText(line.trim(), 26, y);
			line = "";
			y += 26;
			if (y > h - 60) break;
		}
		line += `${word} `;
	}
	if (line.trim() && y <= h - 60) context.fillText(line.trim(), 26, y);

	context.font = "15px monospace";
	context.fillStyle = "rgba(255,255,255,.5)";
	context.fillText(`seed ${seed}`, 26, h - 24);

	return {
		base64: canvas.toDataURL("image/png").split(",")[1] ?? "",
		mimeType: "image/png",
	};
}

/**
 * Canned scenes for a decomposition, so the story path runs without a model.
 *
 * Varied deliberately — framings differ and the time of day holds — so the
 * continuity checker has something realistic to pass, rather than a set that
 * trivially satisfies it.
 */
function cannedScenes(castNames: string[], beats: number): string {
	const who = castNames.length ? [castNames[0]] : [];
	// One shot per beat, which is the shape a real decomposition returns. The
	// first version always returned exactly three regardless of the story, so a
	// five-beat film came back with five scene nodes and three shots to fill
	// them — and the runner quietly rendered the last shot three times. A test
	// double may invent the content; it must not invent a different shape.
	const FRAMINGS = [
		{ camera: "wide establishing, static", action: "the street empties" },
		{ camera: "medium, slow push", action: "they stop under the awning" },
		{ camera: "close on their hands", action: "they unfold the paper" },
		{ camera: "over the shoulder, favouring them", action: "they read it again" },
		{ camera: "extreme close on their eyes", action: "they decide" },
		{ camera: "wide, static, holding", action: "they walk out of frame" },
	];
	return JSON.stringify({
		scenes: Array.from({ length: Math.max(1, beats) }, (_, index) => {
			const framing = FRAMINGS[index % FRAMINGS.length];
			return {
				characterNames: index === 0 ? [] : who,
				location: "a rain-dark street",
				timeOfDay: "night",
				camera: framing.camera,
				action: framing.action,
				// Varied so the pacing check has something realistic to judge
				// rather than a metronome it would always flag.
				durationSeconds: [4, 3.5, 3, 5, 2.5, 4.5][index % 6],
				...(index === 2 ? { dialogue: "You kept it." } : {}),
			};
		}),
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
				// The beat lines are numbered in the prompt; counting them is how
				// the stub returns one shot per beat the way a model would.
				const beats = (request.prompt.match(/^\d+\. \[/gm) ?? []).length;
				return { text: cannedScenes(names, beats), model: "stub-text", elapsedMs: 140 };
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
