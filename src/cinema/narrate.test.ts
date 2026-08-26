// The parts of narration that can be checked without downloading a model.
//
// `speak` needs ninety megabytes of ONNX and a WASM runtime, so it is exercised
// in the browser rather than here. What *is* testable is everything that
// decides what gets spoken and how long it turned out to be — including the
// WAV header read, which is the thing that lets a line's real duration replace
// the two-and-a-half-words-a-second estimate.

import { describe, expect, it } from "vitest";

import { KOKORO_VOICE, narrationName, voiceDescription, wavSeconds } from "./narrate";
import { VOICES } from "./sound";

/** A canonical 44-byte WAV header followed by `dataSize` bytes of nothing. */
function wav(sampleRate: number, seconds: number): ArrayBuffer {
	const bytesPerSample = 2;
	const byteRate = sampleRate * bytesPerSample;
	const dataSize = Math.round(byteRate * seconds);
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	view.setUint32(28, byteRate, true);
	view.setUint32(40, dataSize, true);
	return buffer;
}

describe("wavSeconds", () => {
	it("reads a duration out of the header", () => {
		expect(wavSeconds(wav(24000, 2.5))).toBeCloseTo(2.5, 2);
	});

	it("is not fooled by a different sample rate", () => {
		// The estimate has to survive the engine changing its output rate, or a
		// line's real length silently becomes wrong by a factor of two.
		expect(wavSeconds(wav(48000, 1.25))).toBeCloseTo(1.25, 2);
	});

	it("returns zero for something too short to be a WAV", () => {
		expect(wavSeconds(new ArrayBuffer(10))).toBe(0);
	});

	it("returns zero rather than dividing by a zero byte rate", () => {
		const buffer = new ArrayBuffer(64);
		new DataView(buffer).setUint32(40, 1000, true);
		expect(wavSeconds(buffer)).toBe(0);
	});
});

describe("voice mapping", () => {
	it("maps every described voice to an engine voice", () => {
		// A missing entry would silently fall back to one voice for the whole
		// cast, which is exactly the failure nobody notices until playback.
		for (const name of Object.keys(VOICES)) {
			expect(KOKORO_VOICE[name as keyof typeof VOICES], name).toBeTruthy();
		}
	});

	it("gives different characters different voices", () => {
		const distinct = new Set(Object.values(KOKORO_VOICE));
		expect(distinct.size).toBe(Object.keys(VOICES).length);
	});

	it("still describes a voice rather than naming an engine's id", () => {
		expect(voiceDescription("dry")).toContain("clipped");
	});
});

describe("narrationName", () => {
	it("names a clip by its position, speaker and opening words", () => {
		const name = narrationName(
			{
				sceneIndex: 0,
				speaker: "Mara",
				text: "The last one left an hour ago.",
				at: 0,
				within: 4,
			},
			2,
		);
		expect(name).toBe("3. Mara — The last one left an hour ago..wav");
	});

	it("truncates a long line rather than making an unusable filename", () => {
		const long = "a".repeat(200);
		const name = narrationName(
			{ sceneIndex: 0, speaker: "X", text: long, at: 0, within: 1 },
			0,
		);
		expect(name.length).toBeLessThan(60);
	});
});
