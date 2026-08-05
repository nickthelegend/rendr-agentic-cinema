// Does the real API accept what this project sends?
//
// The one thing a stub cannot answer. Every generative path here is tested
// against a fake provider, which proves the sequencing and the parsing and
// proves nothing about the request shape — and the request shape is exactly
// where a project like this breaks, because the fields are guessable and wrong
// guesses fail quietly.
//
//   GEMINI_API_KEY=... node scripts/preflight.mjs
//
// Writes preflight-out/ so the images can be looked at rather than trusted.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const KEY = process.env.GEMINI_API_KEY ?? process.env.VITE_GEMINI_API_KEY ?? "";
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-3.6-flash";
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
const OUT = "preflight-out";

if (!KEY) {
	console.error(
		"No key. GEMINI_API_KEY=... node scripts/preflight.mjs\n" +
			"Get one from aistudio.google.com — that is a different product from a\n" +
			"Gemini app subscription, which carries no API quota.",
	);
	process.exit(1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures += 1;
};

async function post(model, body) {
	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
			body: JSON.stringify(body),
		},
	);
	const raw = await response.text();
	return { status: response.status, raw };
}

async function main() {
	await mkdir(OUT, { recursive: true });
	console.log(`text  ${TEXT_MODEL}\nimage ${IMAGE_MODEL}\n`);

	// 1 — plain text.
	const plain = await post(TEXT_MODEL, {
		contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }],
	});
	check("text model reachable", plain.status === 200, `HTTP ${plain.status}`);
	if (plain.status !== 200) {
		console.error(plain.raw.slice(0, 400));
		process.exit(1);
	}

	// 2 — the schema call the story decomposition depends on. If structured
	// output is not honoured, parseScenes gets prose and throws.
	const schema = await post(TEXT_MODEL, {
		contents: [{ role: "user", parts: [{ text: "Two shots of someone leaving a room." }] }],
		generationConfig: {
			responseMimeType: "application/json",
			responseSchema: {
				type: "object",
				properties: {
					scenes: {
						type: "array",
						items: {
							type: "object",
							properties: { camera: { type: "string" }, action: { type: "string" } },
							required: ["camera", "action"],
						},
					},
				},
				required: ["scenes"],
			},
		},
	});
	check("structured output accepted", schema.status === 200, `HTTP ${schema.status}`);
	if (schema.status === 200) {
		const text =
			JSON.parse(schema.raw).candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
			"";
		let parsed = null;
		try {
			parsed = JSON.parse(text);
		} catch {}
		check("schema response parses as JSON", Boolean(parsed?.scenes), text.slice(0, 80));
	}

	// 3 — an image, with the aspect field this project actually sends. A wrong
	// field name does not error; it is ignored, and every shot comes back the
	// default shape. So the dimensions are measured rather than assumed.
	const image = await post(IMAGE_MODEL, {
		contents: [
			{ role: "user", parts: [{ text: "A plain grey studio backdrop, nothing else." }] },
		],
		response_format: { type: "image", aspect_ratio: "16:9" },
	});
	check("image model reachable", image.status === 200, `HTTP ${image.status}`);
	if (image.status !== 200) {
		console.error(image.raw.slice(0, 500));
	} else {
		const parts = JSON.parse(image.raw).candidates?.[0]?.content?.parts ?? [];
		const inline = parts.find((part) => part.inlineData?.data)?.inlineData;
		check("image bytes returned", Boolean(inline?.data));
		if (inline?.data) {
			const bytes = Buffer.from(inline.data, "base64");
			await writeFile(join(OUT, "aspect.png"), bytes);
			const size = pngSize(bytes);
			check(
				"aspect_ratio honoured",
				size ? Math.abs(size.w / size.h - 16 / 9) < 0.12 : false,
				size ? `${size.w}x${size.h}` : "not a PNG",
			);
		}
	}

	// 4 — the mechanism the whole project rests on: does attaching an image as
	// context actually condition the next generation?
	if (image.status === 200) {
		const first = JSON.parse(image.raw).candidates?.[0]?.content?.parts?.find(
			(p) => p.inlineData?.data,
		)?.inlineData;
		if (first?.data) {
			const followUp = await post(IMAGE_MODEL, {
				contents: [
					{
						role: "user",
						parts: [
							{ inlineData: { mimeType: first.mimeType, data: first.data } },
							{ text: "The same backdrop, seen from further back." },
						],
					},
				],
			});
			check("reference-image conditioning accepted", followUp.status === 200, `HTTP ${followUp.status}`);
			if (followUp.status === 200) {
				const bytes = JSON.parse(followUp.raw).candidates?.[0]?.content?.parts?.find(
					(p) => p.inlineData?.data,
				)?.inlineData;
				if (bytes?.data) {
					await writeFile(join(OUT, "conditioned.png"), Buffer.from(bytes.data, "base64"));
				}
				check("conditioned image returned", Boolean(bytes?.data));
			}
		}
	}

	console.log(
		failures === 0
			? `\nAll good. Images in ${OUT}/ — look at them, do not just trust the ticks.`
			: `\n${failures} check(s) failed. The request shape needs fixing before the graph will work.`,
	);
	process.exit(failures === 0 ? 0 : 1);
}

/** Width and height from a PNG header, so "did aspect work" is measurable. */
function pngSize(buffer) {
	if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
	return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
