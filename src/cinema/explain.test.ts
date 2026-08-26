// Reading a prompt back.
//
// The one rule: never attribute a clause the tables did not write. An explainer
// that guesses teaches a false model of what the words do, which is worse than
// no explainer at all.

import { describe, expect, it } from "vitest";
import { explainPrompt, shotSizeHistogram, storyboardHtml } from "./explain";
import type { CinemaGraph, SceneSpec } from "./nodes";
import { buildScenePrompt } from "./scene";

const graph = (): CinemaGraph => ({ id: "g", name: "T", auto: false, nodes: [], edges: [] });
const spec = (over: Partial<SceneSpec> = {}): SceneSpec => ({
	id: "s0",
	index: 0,
	characterIds: [],
	location: "a street",
	timeOfDay: "night",
	camera: "wide establishing, static",
	action: "the street empties",
	durationSeconds: 4,
	...over,
});

describe("explainPrompt", () => {
	const built = () =>
		buildScenePrompt(graph(), spec(), undefined, {
			lens: "85mm",
			stock: "tri-x",
			palette: "rust, bone",
			referenceStrength: 1,
		});

	it("labels every preset it recognises", () => {
		const labels = explainPrompt(built()).map((c) => c.label);
		expect(labels).toEqual(expect.arrayContaining(["Shot size", "Lens", "Stock", "Palette"]));
	});

	it("pulls the palette's value out, not the whole sentence", () => {
		const palette = explainPrompt(built()).find((c) => c.label === "Palette");
		expect(palette?.text).toBe("rust, bone");
	});

	it("labels the negative clause as what is kept out", () => {
		expect(explainPrompt(built()).find((c) => c.label === "Kept out")?.text).toMatch(
			/watermark/,
		);
	});

	it("puts what the story wrote first", () => {
		// The prose is the thing a person recognises; presets are the machinery.
		expect(explainPrompt(built())[0].label).toBe("Written");
		expect(explainPrompt(built())[0].text).toMatch(/the street empties/);
	});

	it("attributes nothing in a prompt nobody assembled", () => {
		const out = explainPrompt("just some words a person typed");
		expect(out).toEqual([{ label: "Written", text: "just some words a person typed" }]);
	});

	it("does not claim a lens that is not there", () => {
		const plain = buildScenePrompt(graph(), spec());
		expect(explainPrompt(plain).some((c) => c.label === "Lens")).toBe(false);
	});
});

describe("shotSizeHistogram", () => {
	it("counts by size, commonest first", () => {
		const out = shotSizeHistogram([
			spec({ index: 0, camera: "medium" }),
			spec({ index: 1, camera: "medium, slow push" }),
			spec({ index: 2, camera: "wide establishing" }),
		]);
		expect(out[0]).toEqual({ size: "medium", count: 2 });
		expect(out[1]).toEqual({ size: "establishing", count: 1 });
	});

	it("does not pad with sizes the cut does not use", () => {
		// A histogram of eight zeroes hides the one number that matters.
		expect(shotSizeHistogram([spec({ camera: "close on her hands" })])).toHaveLength(1);
	});

	it("names an unreadable camera direction rather than dropping the shot", () => {
		expect(shotSizeHistogram([spec({ camera: "the camera does something odd" })])).toEqual([
			{ size: "unclassified", count: 1 },
		]);
	});

	it("is empty for an empty cut", () => {
		expect(shotSizeHistogram([])).toEqual([]);
	});
});

describe("storyboardHtml", () => {
	const frames = new Map([[0, { base64: "AAAA", mimeType: "image/png" }]]);

	it("inlines the frames so the page survives being sent to somebody", () => {
		const html = storyboardHtml("Film", [spec()], frames);
		expect(html).toContain("data:image/png;base64,AAAA");
		expect(html).not.toContain("http://");
	});

	it("says so where a shot has not rendered", () => {
		const html = storyboardHtml("Film", [spec({ index: 1 })], frames);
		expect(html).toContain("not rendered");
	});

	it("escapes text that would otherwise break the page", () => {
		const html = storyboardHtml(
			"Film",
			[spec({ action: '<script>alert("x")</script>' })],
			frames,
		);
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
	});

	it("orders by the story's index", () => {
		const html = storyboardHtml("Film", [spec({ index: 1 }), spec({ index: 0 })], frames);
		expect(html.indexOf("1. wide")).toBeLessThan(html.indexOf("2. wide"));
	});

	it("carries the runtime in the header", () => {
		expect(storyboardHtml("Film", [spec({ durationSeconds: 4 })], frames)).toContain("4.0s");
	});
});
