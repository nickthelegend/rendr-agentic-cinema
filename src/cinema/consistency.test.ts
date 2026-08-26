// The consistency proof.
//
// This is the project's central claim, so the cases that matter are the ones
// where the panel could quietly overstate it: counting a shot that has not
// rendered, double-counting a duplicated scene node, or burying the lead.

import { describe, expect, it } from "vitest";

import { castConsistency, consistencySummary } from "./consistency";
import type { CinemaGraph, CinemaNode, SceneSpec } from "./nodes";

const img = (tag: string) => ({ base64: tag, mimeType: "image/png" });

const node = (
	id: string,
	kind: CinemaNode["kind"],
	over: Partial<CinemaNode> = {},
): CinemaNode => ({
	id,
	kind,
	x: 0,
	y: 0,
	params: {},
	status: "idle",
	...over,
});

const spec = (index: number, who: string[], over: Partial<SceneSpec> = {}): SceneSpec => ({
	id: `s${index}`,
	index,
	characterIds: who,
	location: "a street",
	timeOfDay: "night",
	camera: "medium",
	action: "they wait",
	durationSeconds: 3,
	...over,
});

const film = (): CinemaGraph => ({
	id: "g",
	name: "T",
	auto: false,
	nodes: [
		node("lead", "character", {
			label: "Lead",
			output: { sheet: [img("a"), img("b")], seed: 7 },
		}),
		node("extra", "character", { label: "Extra", output: { sheet: [img("x")] } }),
		node("story", "story", {
			output: { scenes: [spec(0, ["lead"]), spec(1, ["lead", "extra"]), spec(2, ["lead"])] },
		}),
		node("sc0", "scene", { params: { sceneIndex: 0 }, output: { sheet: [img("f0")] } }),
		node("sc1", "scene", { params: { sceneIndex: 1 }, output: { sheet: [img("f1")] } }),
		// Shot 2 has a node but has not rendered.
		node("sc2", "scene", { params: { sceneIndex: 2 } }),
	],
	edges: [],
});

describe("castConsistency", () => {
	it("gathers each character's sheet and the frames they appear in", () => {
		const [lead] = castConsistency(film());
		expect(lead.name).toBe("Lead");
		expect(lead.sheet).toHaveLength(2);
		expect(lead.seed).toBe(7);
		expect(lead.appearances.map((a) => a.sceneIndex)).toEqual([0, 1]);
	});

	it("puts whoever carries the film first", () => {
		// A panel that opens on a one-shot extra buries the argument it exists
		// to make.
		expect(castConsistency(film()).map((who) => who.name)).toEqual(["Lead", "Extra"]);
	});

	it("does not count a shot that has not rendered", () => {
		const [lead] = castConsistency(film());
		expect(lead.appearances.some((a) => a.sceneIndex === 2)).toBe(false);
		expect(lead.pending).toBe(1);
	});

	it("carries the camera so a face can be judged against its framing", () => {
		const [lead] = castConsistency(film());
		expect(lead.appearances[0].camera).toBe("medium");
	});

	it("does not double-count two scene nodes pointing at one shot", () => {
		const doubled = film();
		doubled.nodes.push(
			node("dupe", "scene", { params: { sceneIndex: 0 }, output: { sheet: [img("f0b")] } }),
		);
		const [lead] = castConsistency(doubled);
		expect(lead.appearances.filter((a) => a.sceneIndex === 0)).toHaveLength(1);
	});

	it("returns an empty list for a film with no cast", () => {
		expect(castConsistency({ id: "g", name: "T", auto: false, nodes: [], edges: [] })).toEqual(
			[],
		);
	});
});

describe("consistencySummary", () => {
	it("says so when there is no cast", () => {
		expect(consistencySummary([])).toMatch(/No characters/);
	});

	it("reports coverage once shots have rendered", () => {
		expect(consistencySummary(castConsistency(film()))).toBe(
			"2 of 2 locked, carried across 3 rendered shots.",
		);
	});

	it("asks for a render when the cast is locked but nothing is shot", () => {
		const unshot = film();
		unshot.nodes = unshot.nodes.filter((n) => n.kind !== "scene");
		expect(consistencySummary(castConsistency(unshot))).toMatch(/Render some scenes/);
	});

	it("claims nothing about whether two pictures match", () => {
		// No code here can judge that, and a summary that implied it would be
		// the one dishonest sentence in the project.
		expect(consistencySummary(castConsistency(film()))).not.toMatch(
			/match|identical|same face/i,
		);
	});
});
