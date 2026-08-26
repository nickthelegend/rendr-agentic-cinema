// A film has to survive the round trip through a URL.
//
// The failure mode worth pinning is silent: a link that decodes into *almost*
// the film, missing an edge or a param, produces a graph that looks right and
// renders something else. So this checks the structure that comes back rather
// than only that decoding did not throw.

import { describe, expect, it } from "vitest";

import type { CinemaGraph } from "./nodes";
import { decodeFilm, encodeFilm, payloadIn, shareLink } from "./share";

const film = (): CinemaGraph =>
	({
		id: "f1",
		name: "A missed train",
		auto: false,
		nodes: [
			{
				id: "c1",
				kind: "character",
				x: 10,
				y: 20,
				label: "Mara",
				text: "A dock worker in her fifties",
				params: { voice: "low" },
			},
			{ id: "s1", kind: "story", x: 200, y: 20, params: { shots: 5 } },
			{ id: "t1", kind: "timeline", x: 400, y: 20, params: {} },
		],
		edges: [
			{ from: "c1", to: "s1" },
			{ from: "s1", to: "t1" },
		],
	}) as unknown as CinemaGraph;

describe("share round trip", () => {
	it("brings back every node and edge", async () => {
		const { graph, error } = await decodeFilm(await encodeFilm(film()), "f2");
		expect(error).toBeUndefined();
		expect(graph?.nodes.map((node) => node.id)).toEqual(["c1", "s1", "t1"]);
		expect(graph?.edges).toHaveLength(2);
	});

	it("keeps the name, the labels and the params", async () => {
		// The quiet failure: a link that decodes to a graph with the right shape
		// and the wrong content renders a different film with no error anywhere.
		const { graph } = await decodeFilm(await encodeFilm(film()), "f2");
		expect(graph?.name).toBe("A missed train");
		const mara = graph?.nodes.find((node) => node.id === "c1");
		expect(mara?.label).toBe("Mara");
		expect(mara?.text).toBe("A dock worker in her fifties");
		expect(mara?.params.voice).toBe("low");
	});

	it("takes the id it is given rather than the one it was shared with", async () => {
		// Two people opening the same link must not end up with colliding ids in
		// the same project.
		const { graph } = await decodeFilm(await encodeFilm(film()), "somewhere-else");
		expect(graph?.id).toBe("somewhere-else");
	});

	it("is small enough to paste", async () => {
		// A URL that survives a chat window is under about 2000 characters.
		const link = await shareLink(film(), "https://example.invalid/");
		expect(link.length).toBeLessThan(2000);
	});

	it("compresses rather than just encoding", async () => {
		const payload = await encodeFilm(film());
		// base64 of the raw JSON would be longer than the JSON itself.
		expect(payload.length).toBeLessThan(JSON.stringify(film()).length);
	});
});

describe("payloadIn", () => {
	it("finds a film in a fragment", async () => {
		const link = await shareLink(film(), "https://example.invalid/app");
		expect(payloadIn(link)).toBeTruthy();
	});

	it("is null for an ordinary URL", () => {
		expect(payloadIn("https://example.invalid/app")).toBeNull();
	});

	it("is null for a fragment that carries something else", () => {
		expect(payloadIn("https://example.invalid/app#section=2")).toBeNull();
	});

	it("replaces an existing film rather than appending a second", async () => {
		const once = await shareLink(film(), "https://example.invalid/app");
		const twice = await shareLink(film(), once);
		expect(twice.split("film=").length - 1).toBe(1);
	});
});

describe("a damaged link", () => {
	it("comes back as a message, not a throw", async () => {
		const { error } = await decodeFilm("not-actually-deflate-data", "f2");
		expect(error).toMatch(/damaged/i);
	});

	it("still refuses something that unpacks but is not a film", async () => {
		// Valid deflate, valid JSON, wrong thing entirely.
		const stream = new Blob(['{"format":"something-else"}'])
			.stream()
			.pipeThrough(new CompressionStream("deflate-raw"));
		const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		const payload = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
		const { error } = await decodeFilm(payload, "f2");
		expect(error).toBeTruthy();
	});
});
