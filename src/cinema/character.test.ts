// The character lock.
//
// The behaviour worth pinning hardest is the sequencing: every angle after the
// first must carry the front view as a reference. Four independent generations
// from one description produce four different people, and no amount of prompt
// wording fixes it — so a test asserts the attachment rather than trusting it.

import { describe, expect, it, vi } from "vitest";

import { gatherIngredients, lockCharacter, seedFrom, sheetsFor } from "./character";
import type { CinemaGraph, CinemaNode } from "./nodes";
import type { CinemaProvider, ImageBytes } from "./provider";

const bytes = (tag: string): ImageBytes => ({ base64: tag, mimeType: "image/png" });

function fakeProvider(): CinemaProvider & { imageCalls: Array<{ refs: ImageBytes[] }> } {
	const imageCalls: Array<{ refs: ImageBytes[] }> = [];
	let n = 0;
	return {
		name: "fake",
		imageCalls,
		text: async () => ({ text: "a person", model: "fake-text", elapsedMs: 1 }),
		image: async (request) => {
			imageCalls.push({ refs: request.references ?? [] });
			n += 1;
			return { image: bytes(`shot-${n}`), model: "fake-image", elapsedMs: 1 };
		},
	};
}

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

describe("lockCharacter", () => {
	it("generates four views", async () => {
		const provider = fakeProvider();
		const locked = await lockCharacter(provider, "a tall woman", []);
		expect(locked.sheet).toHaveLength(4);
	});

	it("attaches the front view to every later angle", async () => {
		// This is the whole mechanism. Without the attachment the sheet is four
		// strangers, and the failure is invisible until scene three.
		const provider = fakeProvider();
		await lockCharacter(provider, "a tall woman", []);
		const [first, ...rest] = provider.imageCalls;
		expect(first.refs).toHaveLength(0);
		for (const call of rest) {
			expect(call.refs[0]?.base64).toBe("shot-1");
		}
	});

	it("keeps wired-in references on every angle too", async () => {
		const provider = fakeProvider();
		await lockCharacter(provider, "a tall woman", [bytes("user-photo")]);
		expect(provider.imageCalls[0].refs.map((r) => r.base64)).toEqual(["user-photo"]);
		expect(provider.imageCalls[1].refs.map((r) => r.base64)).toEqual(["shot-1", "user-photo"]);
	});

	it("uses one seed across the whole sheet", async () => {
		const provider = fakeProvider();
		const seen: Array<number | undefined> = [];
		const wrapped: CinemaProvider = {
			...provider,
			image: async (request) => {
				seen.push(request.seed);
				return provider.image(request);
			},
		};
		await lockCharacter(wrapped, "a tall woman", []);
		expect(new Set(seen).size).toBe(1);
	});
});

describe("seedFrom", () => {
	it("gives the same description the same face", () => {
		expect(seedFrom("a tall woman")).toBe(seedFrom("a tall woman"));
	});

	it("recasts when the description changes", () => {
		expect(seedFrom("a tall woman")).not.toBe(seedFrom("a short woman"));
	});

	it("stays inside the range providers accept", () => {
		for (const text of ["", "x", "a".repeat(500), "🎬 emoji"]) {
			const seed = seedFrom(text);
			expect(seed).toBeGreaterThanOrEqual(0);
			expect(seed).toBeLessThan(2_147_483_647);
		}
	});
});

describe("gatherIngredients", () => {
	it("collects traits, looks and references through a look node", () => {
		const graph: CinemaGraph = {
			id: "g",
			name: "n",
			auto: false,
			nodes: [
				node("t1", "trait", { text: "nervous" }),
				node("t2", "trait", { text: "silver rings" }),
				node("lk", "look", { text: "grey overcoat" }),
				node("ref", "reference", { params: { image: bytes("face") } }),
				node("c", "character"),
			],
			edges: [
				{ id: "1", from: "t1", to: "c" },
				{ id: "2", from: "lk", to: "c" },
				{ id: "3", from: "t2", to: "lk" },
				{ id: "4", from: "ref", to: "c" },
			],
		};
		const got = gatherIngredients(graph, "c");
		expect(got.traits).toEqual(["nervous"]);
		expect(got.looks).toEqual(["grey overcoat", "silver rings"]);
		expect(got.references.map((r) => r.base64)).toEqual(["face"]);
	});
});

describe("sheetsFor", () => {
	it("attaches one view per character, not the whole sheet", () => {
		// A three-hander attaching four views each arrives with twelve images and
		// the model starts averaging faces. The front view carries identity.
		const graph: CinemaGraph = {
			id: "g",
			name: "n",
			auto: false,
			nodes: [
				node("a", "character", {
					output: { sheet: [bytes("a1"), bytes("a2")] },
				}),
				node("b", "character", {
					output: { sheet: [bytes("b1"), bytes("b2")] },
				}),
			],
			edges: [],
		};
		expect(sheetsFor(graph, ["a", "b"]).map((s) => s.base64)).toEqual(["a1", "b1"]);
	});

	it("skips a character that has not been locked yet", () => {
		const graph: CinemaGraph = {
			id: "g",
			name: "n",
			auto: false,
			nodes: [node("a", "character")],
			edges: [],
		};
		expect(sheetsFor(graph, ["a", "missing"])).toEqual([]);
	});
});
