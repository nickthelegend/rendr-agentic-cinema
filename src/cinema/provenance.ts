// What was generated, and how anyone else can check.
//
// Generative film has one question it cannot answer with a claim: which frames
// came out of a model, from what prompt, with what seed. Saying so in a README
// asks to be believed. Writing a digest of the render manifest onto a public
// chain does not — the record sits somewhere we do not control, stamped with a
// time we did not choose, and anybody can read it without asking us.
//
// The manifest is built here rather than on the server for a reason. The
// browser is where the film actually exists, so it is the only place that knows
// the truth; the server's job is to hold a key and sign, not to be told what
// happened. And because the digest is computed on both sides independently, a
// server that signed something *other* than what it was handed is caught by the
// client comparing its own digest against the receipt.
//
// Key order is the whole ballgame for a digest, so `manifestOf` builds its
// object in one fixed order and nothing else is allowed to assemble one.

import { readyScenes } from "./commit";
import type { CinemaGraph } from "./nodes";

export interface Manifest {
	/** Fixed key order — the digest depends on it. */
	film: string;
	shots: number;
	model: string;
	seed: number | null;
	prompts: string[];
	frames: string[];
}

export interface Receipt {
	hash: string;
	ledger: number;
	account: string;
	digest: string;
	network: string;
	explorer: string;
}

export interface Verification {
	/** What the chain says. */
	record: Receipt & { at?: string };
	/** What this film hashes to right now. */
	expected: string;
	/** Whether those agree — the only line that matters. */
	matches: boolean;
}

/**
 * A cheap, stable fingerprint of one frame.
 *
 * Not a cryptographic hash: `crypto.subtle` is async and this runs inside a
 * synchronous manifest build, and the frame digests are here to distinguish
 * shots from one another inside a manifest that is *itself* SHA-256'd. The
 * strong guarantee is on the manifest; this only has to be stable and
 * collision-resistant enough that two different frames do not look identical.
 *
 * FNV-1a over the base64, folded to 64 bits by running two offsets.
 */
function shortDigest(base64: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < base64.length; i++) {
		const code = base64.charCodeAt(i);
		a = Math.imul(a ^ code, 0x01000193) >>> 0;
		b = Math.imul(b ^ code, 0x811c9dc5) >>> 0;
	}
	return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * A stable digest of anything with a fixed key order.
 *
 * `JSON.stringify` preserves insertion order for string keys, and `manifestOf`
 * is the only thing that builds a manifest, so the two sides agree without
 * needing a canonicalisation library.
 */
export async function digestOf(manifest: Manifest): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(manifest));
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The record of what this film actually rendered.
 *
 * Only nodes that produced something are included. A manifest listing shots
 * that never ran would notarise an intention rather than an act, which is worse
 * than notarising nothing — it would let a film claim provenance for frames it
 * never made.
 */
export function manifestOf(graph: CinemaGraph): Manifest {
	// readyScenes rather than a filter of our own: it already knows that a
	// scene's frame lives in `sheet[0]`, and that a scene without a spec is not
	// part of the cut. Two answers to "which shots exist" would drift.
	const rendered = readyScenes(graph);
	const prompts = rendered
		.map((entry) => String(entry.node.output?.prompt ?? ""))
		.filter((prompt) => prompt.length > 0);
	const models = new Set(
		graph.nodes.map((node) => String(node.output?.model ?? "")).filter(Boolean),
	);
	const character = graph.nodes.find((node) => node.kind === "character" && node.output?.seed);
	return {
		film: graph.name || "untitled",
		shots: rendered.length,
		// One model is the normal case; more than one is worth recording as such
		// rather than silently picking the first.
		model: [...models].sort().join("+") || "unknown",
		seed: typeof character?.output?.seed === "number" ? character.output.seed : null,
		prompts,
		// The frames themselves are megabytes, so what goes on chain is their
		// digests — enough to prove a frame is the one that was notarised, and
		// small enough to fit in a request.
		frames: rendered.map((entry) => shortDigest(entry.image.base64)),
	};
}

/** Whether there is anything worth notarising yet. */
export const notarisable = (graph: CinemaGraph): boolean => manifestOf(graph).shots > 0;

/**
 * Signs this film's manifest onto the chain.
 *
 * Throws rather than returning a sentinel: notarising is an explicit act the
 * user asked for, and "it quietly didn't happen" is the one outcome that would
 * make the feature a lie.
 */
export async function notarise(graph: CinemaGraph, base = ""): Promise<Receipt> {
	const manifest = manifestOf(graph);
	if (manifest.shots === 0) {
		throw new Error("Nothing has rendered yet, so there is nothing to notarise.");
	}
	const response = await fetch(`${base}/notarise`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(manifest),
	});
	const payload = (await response.json()) as Receipt & { error?: string };
	if (!response.ok) throw new Error(payload.error ?? `The notary refused (${response.status}).`);

	const expected = await digestOf(manifest);
	if (payload.digest !== expected) {
		// The server signed something that is not this film. Better to fail loudly
		// than to hand back a receipt that verifies against the wrong thing.
		throw new Error(
			`The notary signed a different digest (${payload.digest.slice(0, 12)}… ` +
				`rather than ${expected.slice(0, 12)}…).`,
		);
	}
	return payload;
}

/**
 * Reads a notarisation back and checks it against the film in front of you.
 *
 * The comparison is done here, on a digest computed locally, against bytes
 * fetched from the chain. Nothing in this function trusts the receipt.
 */
export async function verify(graph: CinemaGraph, hash: string, base = ""): Promise<Verification> {
	const response = await fetch(`${base}/provenance/${hash}`);
	const record = (await response.json()) as Receipt & { at?: string; error?: string };
	if (!response.ok) throw new Error(record.error ?? `No record for ${hash.slice(0, 12)}….`);
	const expected = await digestOf(manifestOf(graph));
	return { record, expected, matches: record.digest === expected };
}
