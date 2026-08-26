// A film in a URL.
//
// The problem this solves is specific to being judged. Someone opens the hosted
// build, sees an empty canvas, and has thirty seconds of patience — so the
// interesting thing has to already be on screen. A link that carries the whole
// graph means the film you want them to see *is* the thing they land on.
//
// What travels is the recipe, not the footage. `exportFilm` already strips
// uploaded images and rendered output, which is exactly right here for a second
// reason: frames are megabytes and no URL survives that, and a shared film that
// arrives un-run is a film the recipient watches being made rather than one
// they are shown the end of.
//
// Deflate then base64url. A five-node graph is around 1.5 kB of JSON and lands
// near 500 characters — comfortably inside every browser's limit, and inside
// the ~2000 characters that survive being pasted into a chat window.

import { exportFilm, type ImportResult, importFilm } from "./deliver";
import type { CinemaGraph } from "./nodes";

/** The fragment key. In the fragment, not the query, so it never reaches a server. */
export const SHARE_KEY = "film";

const toBase64Url = (bytes: Uint8Array): string => {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string): Uint8Array => {
	const padded = text.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

async function squeeze(text: string, mode: "deflate-raw"): Promise<Uint8Array> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream(mode));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unsqueeze(bytes: Uint8Array, mode: "deflate-raw"): Promise<string> {
	// `bytes.buffer` rather than the view: a Uint8Array backed by a
	// SharedArrayBuffer is not a BlobPart, and the type that says so is right —
	// a shared buffer could be written to while the Blob reads it.
	const copy = new Uint8Array(bytes).slice().buffer as ArrayBuffer;
	const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream(mode));
	return new Response(stream).text();
}

/** The fragment payload for this film. */
export async function encodeFilm(graph: CinemaGraph): Promise<string> {
	return toBase64Url(await squeeze(exportFilm(graph), "deflate-raw"));
}

/**
 * A whole link, ready to paste.
 *
 * The existing fragment is replaced rather than appended to: two films in one
 * URL is not a state anything downstream knows how to read.
 */
export async function shareLink(graph: CinemaGraph, href: string): Promise<string> {
	const url = new URL(href);
	url.hash = `${SHARE_KEY}=${await encodeFilm(graph)}`;
	return url.toString();
}

/** The payload in a URL's fragment, or null when there is none. */
export function payloadIn(href: string): string | null {
	const hash = new URL(href).hash.replace(/^#/, "");
	if (!hash) return null;
	const found = new URLSearchParams(hash).get(SHARE_KEY);
	return found && found.length > 0 ? found : null;
}

/**
 * Reads a film out of a link.
 *
 * Every failure comes back as a message rather than a throw, matching
 * `importFilm`: a corrupted link is something a person pasted, and they need to
 * be told it did not work rather than watching the page do nothing.
 */
export async function decodeFilm(payload: string, id: string): Promise<ImportResult> {
	let json: string;
	try {
		json = await unsqueeze(fromBase64Url(payload), "deflate-raw");
	} catch {
		return { error: "That link is damaged — the film in it could not be unpacked." };
	}
	return importFilm(json, id);
}
