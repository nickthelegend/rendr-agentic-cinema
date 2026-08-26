// Making the film actually speak.
//
// `sound.ts` has always decided who says what and where it lands. Nothing ever
// said it. A silent film is half a demo, and the half that is missing is the
// one that makes a cut feel like a cut rather than a slideshow.
//
// Kokoro runs entirely on the machine looking at the page — no key, no account,
// no request to anybody's API. That is the reason it is here rather than a
// hosted voice: this project's whole generative half is currently stubbed for
// want of a Gemini key, and narration is the one part that can be genuinely,
// unambiguously real in front of a judge with no credential at all.
//
// The model is about ninety megabytes and is fetched on first use, so the
// import is dynamic. Pulling it into the main bundle would make every visitor
// who never asks for narration pay for it.

import { type Line, VOICES, type VoiceName } from "./sound";

/**
 * Which Kokoro voice speaks each of the film's described voices.
 *
 * The app describes voices rather than naming them — "dry, clipped, slightly
 * bored" survives the engine changing and reads better in a cast list. This is
 * the one place that has to know an engine's actual voice ids, so it is the one
 * place that breaks if the engine is swapped.
 */
export const KOKORO_VOICE: Record<VoiceName, string> = {
	warm: "af_heart",
	dry: "bm_george",
	bright: "af_nova",
	low: "am_fenrir",
	young: "af_sky",
	formal: "bm_daniel",
};

export interface SpokenLine {
	line: Line;
	/** WAV bytes, ready to become a library asset. */
	blob: Blob;
	/** How long it actually takes to say, which is rarely the estimate. */
	seconds: number;
	/** True when the real line runs past the shot it belongs to. */
	overruns: boolean;
}

export interface NarrationProgress {
	done: number;
	total: number;
	/** What is being said right now, for something honest to put on screen. */
	saying: string;
}

/** The engine, loaded once and kept — reloading it re-downloads the model. */
let engine: Promise<unknown> | null = null;

/**
 * Loads Kokoro, lazily.
 *
 * `kokoro-web` is an alias, not a package. `kokoro-js` publishes an `exports`
 * map whose only condition points at the Node build — which imports `node:fs`
 * and dies in a browser tab — and that map also blocks reaching the web build
 * by subpath. The alias in the Vite configs points straight at the file.
 */
async function tts(): Promise<{
	generate: (text: string, options: { voice: string }) => Promise<{ toWav: () => ArrayBuffer }>;
}> {
	if (!engine) {
		engine = import("kokoro-web").then(({ KokoroTTS }) =>
			KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
				// q8 rather than fp32: a quarter of the download for speech that is
				// indistinguishable at demo volume.
				dtype: "q8",
			}),
		);
	}
	return engine as Promise<{
		generate: (
			text: string,
			options: { voice: string },
		) => Promise<{ toWav: () => ArrayBuffer }>;
	}>;
}

/** How many seconds of audio a WAV holds, read from its own header. */
export function wavSeconds(bytes: ArrayBuffer): number {
	const view = new DataView(bytes);
	if (view.byteLength < 44) return 0;
	// Canonical 44-byte header: sample rate at 24, byte rate at 28, data size at 40.
	const byteRate = view.getUint32(28, true);
	const dataSize = view.getUint32(40, true);
	if (byteRate === 0) return 0;
	return Number((dataSize / byteRate).toFixed(3));
}

/**
 * Speaks every line in the cut.
 *
 * Sequential on purpose. The model is one WASM instance and asking it for six
 * lines at once queues them anyway, but doing it explicitly means the progress
 * callback reports something true rather than six lines all finishing at once.
 */
export async function speak(
	all: readonly Line[],
	voiceOf: (line: Line) => VoiceName,
	onProgress?: (progress: NarrationProgress) => void,
): Promise<SpokenLine[]> {
	if (all.length === 0) return [];
	const engineReady = await tts();
	const spoken: SpokenLine[] = [];

	for (const [index, line] of all.entries()) {
		onProgress?.({ done: index, total: all.length, saying: line.text });
		const audio = await engineReady.generate(line.text, {
			voice: KOKORO_VOICE[voiceOf(line)] ?? KOKORO_VOICE.warm,
		});
		const wav = audio.toWav();
		const seconds = wavSeconds(wav);
		spoken.push({
			line,
			blob: new Blob([wav], { type: "audio/wav" }),
			seconds,
			// The estimate in sound.ts is two and a half words a second. Now that
			// the line has actually been said, the truth is known — and a line
			// that runs past its shot is a note worth giving.
			overruns: seconds > line.within + 0.05,
		});
	}
	onProgress?.({ done: all.length, total: all.length, saying: "" });
	return spoken;
}

/** A filename that says which line it is, for the library. */
export const narrationName = (line: Line, index: number): string =>
	`${index + 1}. ${line.speaker} — ${line.text.slice(0, 40).trim()}.wav`;

/** The described voice, for a cast list. */
export const voiceDescription = (voice: VoiceName): string => VOICES[voice];
