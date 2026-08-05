// Does the configured key actually work, and does the API accept what we send?
//
// The same five checks as scripts/preflight.mjs, callable from the UI so the
// answer arrives in the app rather than in a terminal. Worth having in both
// places: the script is what CI or a fresh clone runs, this is what somebody
// clicks when a render fails and they want to know whether it is their key,
// their quota, or the request shape.
//
// Every check reports what it actually observed, not just pass or fail — a
// tick that says "1024x1024" when 16:9 was asked for is more useful than a
// cross that says "aspect wrong".

import { type CinemaProvider, IMAGE_MODEL, ProviderError, TEXT_MODEL } from "./provider";

export interface CheckResult {
	name: string;
	ok: boolean;
	detail: string;
}

/** Width and height from a PNG header, so "did aspect work" is measurable. */
function pngSize(base64: string): { w: number; h: number } | null {
	try {
		const binary = atob(base64.slice(0, 64));
		const byte = (i: number) => binary.charCodeAt(i);
		if (byte(0) !== 0x89 || byte(1) !== 0x50) return null;
		const read = (at: number) =>
			(byte(at) << 24) | (byte(at + 1) << 16) | (byte(at + 2) << 8) | byte(at + 3);
		return { w: read(16), h: read(20) };
	} catch {
		return null;
	}
}

export async function checkConnection(provider: CinemaProvider): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	const say = (name: string, ok: boolean, detail: string) => {
		results.push({ name, ok, detail });
		return ok;
	};
	const why = (error: unknown) =>
		error instanceof ProviderError
			? `${error.kind}: ${error.message}`
			: error instanceof Error
				? error.message
				: String(error);

	// 1 — is the key good and the text model reachable at all.
	try {
		const reply = await provider.text({ prompt: "Reply with the single word: ready" });
		say("text model", true, `${reply.model} in ${reply.elapsedMs}ms`);
	} catch (error) {
		say("text model", false, why(error));
		// Nothing below can pass if this failed, and each one costs a call.
		return results;
	}

	// 2 — structured output. The story decomposition is unusable without it,
	// and it fails by returning prose rather than by erroring.
	try {
		const reply = await provider.text({
			prompt: "Two shots of someone leaving a room.",
			schema: {
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
		});
		const parsed = JSON.parse(reply.text) as { scenes?: unknown[] };
		say(
			"structured output",
			Array.isArray(parsed.scenes),
			Array.isArray(parsed.scenes)
				? `${parsed.scenes.length} scenes parsed`
				: "came back without a scenes array",
		);
	} catch (error) {
		say("structured output", false, why(error));
	}

	// 3 and 4 — an image, and whether the aspect field is the one the API reads.
	// A wrong field name is ignored rather than rejected, so this is measured.
	let first: { base64: string; mimeType: string } | null = null;
	try {
		const shot = await provider.image({
			prompt: "A plain grey studio backdrop, nothing else.",
			aspect: "16:9",
		});
		first = shot.image;
		say("image model", true, `${shot.model} in ${shot.elapsedMs}ms`);

		const size = pngSize(shot.image.base64);
		if (!size) {
			say("aspect ratio", false, `not a PNG (${shot.image.mimeType}) — cannot measure`);
		} else {
			const ratio = size.w / size.h;
			say(
				"aspect ratio",
				Math.abs(ratio - 16 / 9) < 0.12,
				`${size.w}×${size.h} (${ratio.toFixed(2)}, wanted 1.78)`,
			);
		}
	} catch (error) {
		say("image model", false, why(error));
	}

	// 5 — the mechanism everything rests on. If a reference image is not
	// accepted as context, character consistency has no basis at all.
	if (first) {
		try {
			const shot = await provider.image({
				prompt: "The same backdrop, seen from further back.",
				references: [first],
			});
			say("reference conditioning", true, `accepted, ${shot.elapsedMs}ms`);
		} catch (error) {
			say("reference conditioning", false, why(error));
		}
	}

	return results;
}

export const CHECK_MODELS = () => `${TEXT_MODEL} · ${IMAGE_MODEL}`;
