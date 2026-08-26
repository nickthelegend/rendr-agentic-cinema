// The Kokoro web build, declared under its alias.
//
// `kokoro-js` publishes an `exports` map whose only condition points at the
// Node build, which imports `node:fs` and dies in a browser tab. The web build
// ships in the same package but that map hides it, so the Vite configs alias
// `kokoro-web` straight at the file. This describes the small part of it this
// project actually calls rather than pulling in types written for the Node
// entry.
declare module "kokoro-web" {
	export interface KokoroAudio {
		toWav(): ArrayBuffer;
	}
	export interface KokoroEngine {
		generate(text: string, options: { voice: string }): Promise<KokoroAudio>;
	}
	export const KokoroTTS: {
		from_pretrained(model: string, options?: { dtype?: string }): Promise<KokoroEngine>;
	};
}
