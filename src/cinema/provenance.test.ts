// The manifest has to be honest and it has to be stable.
//
// Honest: it may only describe shots that actually rendered. A manifest that
// lists intentions would let a film claim provenance for frames it never made,
// which is worse than notarising nothing at all.
//
// Stable: the digest is the whole mechanism, so the same film has to hash to
// the same value every time, and any change to what was rendered has to change
// it. Both directions are tested, because a hash that never changes and a hash
// that changes for no reason are equally useless.

import { describe, expect, it, vi } from "vitest";

import type { CinemaGraph } from "./nodes";
import { digestOf, manifestOf, notarisable, notarise, verify } from "./provenance";

function film(overrides: Partial<CinemaGraph> = {}): CinemaGraph {
	return {
		id: "f1",
		name: "A missed train",
		nodes: [
			{
				id: "story",
				kind: "story",
				position: { x: 0, y: 0 },
				params: {},
				output: {
					model: "gemini-3.6-flash",
					scenes: [
						{
							id: "s1",
							index: 0,
							camera: "wide",
							action: "the street empties",
							durationSeconds: 4,
						},
						{
							id: "s2",
							index: 1,
							camera: "medium",
							action: "she stops",
							durationSeconds: 3,
						},
					],
				},
			},
			{
				id: "char",
				kind: "character",
				position: { x: 0, y: 0 },
				params: {},
				output: { seed: 1297369146, model: "gemini-3.1-flash-image" },
			},
			{
				id: "sc1",
				kind: "scene",
				position: { x: 0, y: 0 },
				params: { sceneIndex: 0 },
				output: {
					prompt: "wide establishing, static",
					sheet: [{ base64: "AAAA", mimeType: "image/png" }],
				},
			},
			{
				id: "sc2",
				kind: "scene",
				position: { x: 0, y: 0 },
				params: { sceneIndex: 1 },
				// Never ran.
				output: undefined,
			},
		],
		edges: [],
		...overrides,
	} as CinemaGraph;
}

describe("manifestOf", () => {
	it("describes only the shots that actually rendered", () => {
		// Two scene nodes, one frame. A manifest claiming two would be a lie the
		// chain would then carry forever.
		expect(manifestOf(film()).shots).toBe(1);
		expect(manifestOf(film()).prompts).toEqual(["wide establishing, static"]);
	});

	it("carries the locked seed, which is what makes a run reproducible", () => {
		expect(manifestOf(film()).seed).toBe(1297369146);
	});

	it("records every model that ran rather than picking one", () => {
		expect(manifestOf(film()).model).toBe("gemini-3.1-flash-image+gemini-3.6-flash");
	});

	it("has nothing to notarise before anything has rendered", () => {
		const blank = film();
		blank.nodes = blank.nodes.map((node) =>
			node.kind === "scene" ? { ...node, output: undefined } : node,
		);
		expect(notarisable(blank)).toBe(false);
		expect(manifestOf(blank).shots).toBe(0);
	});

	it("fingerprints different frames differently", () => {
		const other = film();
		const scene = other.nodes.find((node) => node.id === "sc1");
		if (scene?.output?.sheet) scene.output.sheet[0] = { base64: "BBBB", mimeType: "image/png" };
		expect(manifestOf(other).frames[0]).not.toBe(manifestOf(film()).frames[0]);
	});
});

describe("digestOf", () => {
	it("is stable for the same film", async () => {
		expect(await digestOf(manifestOf(film()))).toBe(await digestOf(manifestOf(film())));
	});

	it("changes when the film does", async () => {
		const renamed = film({ name: "A caught train" });
		expect(await digestOf(manifestOf(renamed))).not.toBe(await digestOf(manifestOf(film())));
	});

	it("is a sha-256, in hex", async () => {
		expect(await digestOf(manifestOf(film()))).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("notarise", () => {
	it("refuses a film with nothing rendered rather than signing an empty claim", async () => {
		const blank = film();
		blank.nodes = blank.nodes.map((node) =>
			node.kind === "scene" ? { ...node, output: undefined } : node,
		);
		await expect(notarise(blank)).rejects.toThrow(/nothing to notarise/i);
	});

	it("rejects a receipt whose digest is not this film's", async () => {
		// The check that makes the server untrusted: a notary that signed some
		// other manifest hands back a receipt that verifies against the wrong
		// thing, and silently accepting it would be the whole feature failing
		// quietly.
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ hash: "a".repeat(64), digest: "b".repeat(64), ledger: 1 }),
						{ status: 200 },
					),
			),
		);
		await expect(notarise(film())).rejects.toThrow(/signed a different digest/i);
		vi.unstubAllGlobals();
	});

	it("returns the receipt when the digest agrees", async () => {
		const expected = await digestOf(manifestOf(film()));
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							hash: "c".repeat(64),
							digest: expected,
							ledger: 42,
							account: "GABC",
							network: "stellar-testnet",
							explorer: "https://example.invalid",
						}),
						{ status: 200 },
					),
			),
		);
		await expect(notarise(film())).resolves.toMatchObject({ ledger: 42 });
		vi.unstubAllGlobals();
	});
});

describe("verify", () => {
	it("says match when the chain's digest is this film's", async () => {
		const expected = await digestOf(manifestOf(film()));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ digest: expected }), { status: 200 })),
		);
		await expect(verify(film(), "d".repeat(64))).resolves.toMatchObject({ matches: true });
		vi.unstubAllGlobals();
	});

	it("says mismatch when the film has changed since it was notarised", async () => {
		// This is the useful case, not the failure case: it tells an editor that
		// the cut in front of them is not the one that was signed.
		const stale = await digestOf(manifestOf(film({ name: "An older cut" })));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ digest: stale }), { status: 200 })),
		);
		const result = await verify(film(), "e".repeat(64));
		expect(result.matches).toBe(false);
		expect(result.expected).not.toBe(stale);
		vi.unstubAllGlobals();
	});
});
