/**
 * What this build is for.
 *
 * The cinema build is a fork of a screen recorder, and most of the recorder is
 * still here — deleting it would be days of untangling for no benefit, and it
 * stays useful for reference footage. So it is gated rather than removed: the
 * code compiles, its tests run, and upstream fixes still merge, but nothing
 * reaches the UI or the agent surface.
 *
 * A flag rather than a build-time define, so a single switch flips it back for
 * anyone who wants the recorder.
 */
export interface Capabilities {
	/** Screen capture, cursor telemetry, the record button, recording MCP tools. */
	recording: boolean;
	/** The generative graph: characters, story, scenes. */
	generation: boolean;
	/** The editor. Always on — a generated scene is worthless if you cannot cut it. */
	timeline: boolean;
}

export const CAPABILITIES: Capabilities = {
	recording: false,
	generation: true,
	timeline: true,
};

export const can = (feature: keyof Capabilities): boolean => CAPABILITIES[feature];
