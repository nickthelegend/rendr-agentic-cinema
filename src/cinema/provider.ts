// What the graph needs from a model, and the Gemini implementation of it.
//
// Behind an interface on purpose. Veo is not on the free tier, so scenes render
// as stills today; when billing exists a video provider drops in and no node
// changes. The graph asks for "a shot", not "a Veo call".
//
// The key is read from the environment and never logged, never put in a
// receipt, and never written to the ledger.

export interface TextRequest {
	prompt: string;
	/** Steer the shape of the answer. JSON mode when a schema is given. */
	schema?: Record<string, unknown>;
	system?: string;
	temperature?: number;
}

export interface ImageRequest {
	prompt: string;
	/**
	 * Images the model should hold on to — a character sheet, a reference photo.
	 *
	 * This is the whole consistency mechanism. Text cannot describe a face
	 * precisely enough to reproduce it; an image can, and passing the locked
	 * sheet on every shot is what stops the cast drifting.
	 */
	references?: ImageBytes[];
	aspect?: "16:9" | "9:16" | "1:1" | "4:5";
	/** Reruns with the same seed and prompt should land in the same place. */
	seed?: number;
}

export interface ImageBytes {
	/** Base64, no data: prefix. */
	base64: string;
	mimeType: string;
}

export interface TextResult {
	text: string;
	model: string;
	elapsedMs: number;
	/** For the ledger. Absent when the provider does not report it. */
	tokensIn?: number;
	tokensOut?: number;
}

export interface ImageResult {
	image: ImageBytes;
	model: string;
	elapsedMs: number;
	seed?: number;
}

export interface CinemaProvider {
	readonly name: string;
	text(request: TextRequest): Promise<TextResult>;
	image(request: ImageRequest): Promise<ImageResult>;
	/** Absent until there is a video model with API quota. */
	video?(request: ImageRequest & { seconds: number }): Promise<{ url: string; model: string }>;
}

/**
 * Refusals that are worth telling apart.
 *
 * A quota error and a safety block need different responses from the caller —
 * one is "wait or pay", the other is "change the prompt" — and collapsing them
 * into a generic failure makes an auto-mode run impossible to reason about.
 */
export class ProviderError extends Error {
	constructor(
		message: string,
		readonly kind: "auth" | "quota" | "safety" | "network" | "malformed" | "unknown",
		readonly retryable: boolean,
	) {
		super(message);
		this.name = "ProviderError";
	}
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Text and reasoning. */
export const TEXT_MODEL = "gemini-2.5-flash";
/**
 * Images. Chosen specifically for holding a subject across generations, which
 * is the one property this whole project depends on.
 */
export const IMAGE_MODEL = "gemini-2.5-flash-image";

function classify(status: number, body: string): ProviderError {
	if (status === 401 || status === 403) {
		return new ProviderError("The API key was rejected.", "auth", false);
	}
	if (status === 429) {
		return new ProviderError("Rate limited or out of quota.", "quota", true);
	}
	if (status >= 500) {
		return new ProviderError(`The model service failed (${status}).`, "network", true);
	}
	if (/safety|blocked|policy/i.test(body)) {
		return new ProviderError(
			"The request was blocked by a safety filter. Rewording usually clears it.",
			"safety",
			false,
		);
	}
	return new ProviderError(`Request failed (${status}): ${body.slice(0, 200)}`, "unknown", false);
}

export function createGeminiProvider(apiKey: string): CinemaProvider {
	if (!apiKey) {
		throw new ProviderError(
			"No Gemini API key. Put GEMINI_API_KEY in .env.local — an AI Studio key, which is a different product from a Gemini app subscription.",
			"auth",
			false,
		);
	}

	async function post(model: string, body: unknown): Promise<Record<string, unknown>> {
		let response: Response;
		try {
			response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
				method: "POST",
				// Header rather than a query parameter: a key in a URL ends up in
				// logs, proxies and error messages.
				headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
				body: JSON.stringify(body),
			});
		} catch (error) {
			throw new ProviderError(`Could not reach the model: ${String(error)}`, "network", true);
		}
		const raw = await response.text();
		if (!response.ok) throw classify(response.status, raw);
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			throw new ProviderError(
				"The model returned something that is not JSON.",
				"malformed",
				true,
			);
		}
	}

	return {
		name: "gemini",

		async text(request) {
			const started = Date.now();
			const payload = await post(TEXT_MODEL, {
				contents: [{ role: "user", parts: [{ text: request.prompt }] }],
				...(request.system
					? { systemInstruction: { parts: [{ text: request.system }] } }
					: {}),
				generationConfig: {
					temperature: request.temperature ?? 0.8,
					// Asking for JSON with a schema rather than parsing prose. A
					// decomposition that comes back as a paragraph is a decomposition
					// that silently loses fields.
					...(request.schema
						? { responseMimeType: "application/json", responseSchema: request.schema }
						: {}),
				},
			});

			const candidates = payload.candidates as
				| Array<{ content?: { parts?: Array<{ text?: string }> } }>
				| undefined;
			const text =
				candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
			if (!text) {
				throw new ProviderError(
					"The model returned no text. Usually a safety block on the prompt.",
					"safety",
					false,
				);
			}
			return {
				text,
				model: TEXT_MODEL,
				elapsedMs: Date.now() - started,
				tokensIn: (payload.usageMetadata as { promptTokenCount?: number } | undefined)
					?.promptTokenCount,
				tokensOut: (payload.usageMetadata as { candidatesTokenCount?: number } | undefined)
					?.candidatesTokenCount,
			};
		},

		async image(request) {
			const started = Date.now();
			// References first, prompt last. The model weights the trailing
			// instruction most, and the references are context for it rather than
			// the subject of it.
			const parts: Array<Record<string, unknown>> = [
				...(request.references ?? []).map((reference) => ({
					inlineData: { mimeType: reference.mimeType, data: reference.base64 },
				})),
				{ text: request.prompt },
			];

			const payload = await post(IMAGE_MODEL, {
				contents: [{ role: "user", parts }],
				generationConfig: {
					...(request.seed !== undefined ? { seed: request.seed } : {}),
					...(request.aspect ? { imageConfig: { aspectRatio: request.aspect } } : {}),
				},
			});

			const candidates = payload.candidates as
				| Array<{
						content?: {
							parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
						};
				  }>
				| undefined;
			const inline = candidates?.[0]?.content?.parts?.find(
				(part) => part.inlineData?.data,
			)?.inlineData;
			if (!inline?.data) {
				throw new ProviderError(
					"The model returned no image. Safety filters block people-generation prompts more often than object ones.",
					"safety",
					false,
				);
			}
			return {
				image: { base64: inline.data, mimeType: inline.mimeType ?? "image/png" },
				model: IMAGE_MODEL,
				elapsedMs: Date.now() - started,
				seed: request.seed,
			};
		},

		// No video: Veo needs pay-as-you-go billing, and a consumer Gemini
		// subscription does not carry API quota however much it includes in the
		// app. Scenes render as stills with a camera move until that changes;
		// leaving this undefined is what lets callers detect it rather than
		// discovering it through a failed call.
	};
}
