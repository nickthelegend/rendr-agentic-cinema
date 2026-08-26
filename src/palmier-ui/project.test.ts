import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CURSOR } from "./cursor";
import type { AssetModel } from "./media";
import { withDefaults } from "./model";
import {
	countOfflineAssets,
	offlineAsset,
	PROJECT_VERSION,
	ProjectParseError,
	parseProject,
	readAutosave,
	relinkAssets,
	serializeProject,
	toManifest,
	toProjectFile,
	writeAutosave,
} from "./project";
import type { TimelineModel } from "./reducers";
import { DEFAULT_WEBCAM } from "./webcam";

const timeline: TimelineModel = {
	id: "tl",
	name: "Main",
	fps: 30,
	width: 1920,
	height: 1080,
	tracks: [
		{
			id: "v1",
			name: "V1",
			kind: "video",
			muted: false,
			hidden: false,
			clips: [
				withDefaults({
					id: "c1",
					name: "Take 1.mp4",
					mediaType: "video",
					assetId: "a1",
					startFrame: 0,
					endFrame: 120,
				}),
			],
		},
	],
};

const asset = (over: Partial<AssetModel> = {}): AssetModel => ({
	id: "a1",
	name: "Take 1.mp4",
	type: "video",
	durationSeconds: 4,
	width: 1920,
	height: 1080,
	hasAudio: true,
	url: "blob:fake",
	...over,
});

const project = () =>
	serializeProject({
		projectName: "Cut",
		timelines: [timeline],
		activeTimelineId: "tl",
		assets: [asset()],
		savedAt: "2026-01-01T00:00:00.000Z",
	});

describe("serializeProject", () => {
	it("writes the current version and the timeline", () => {
		const file = project();
		expect(file.version).toBe(PROJECT_VERSION);
		expect(file.timelines[0].tracks[0].clips[0].id).toBe("c1");
	});

	it("never embeds a blob URL — projects reference media, they don't carry it", () => {
		expect(JSON.stringify(project())).not.toContain("blob:");
	});

	it("keeps enough about each asset to relink it later", () => {
		const entry = toManifest(asset());
		expect(entry).toMatchObject({ id: "a1", name: "Take 1.mp4", durationSeconds: 4 });
		expect("url" in entry).toBe(false);
	});
});

describe("parseProject", () => {
	it("round-trips a saved project", () => {
		const parsed = parseProject(JSON.stringify(project()));
		expect(parsed.projectName).toBe("Cut");
		expect(parsed.timelines[0].tracks[0].clips[0].name).toBe("Take 1.mp4");
	});

	it("rejects text that isn't JSON", () => {
		expect(() => parseProject("not json")).toThrow(ProjectParseError);
	});

	it("rejects JSON that isn't a project", () => {
		expect(() => parseProject('{"hello":true}')).toThrow(ProjectParseError);
	});

	it("rejects a project with no timelines", () => {
		expect(() => parseProject('{"version":2,"timelines":[]}')).toThrow(ProjectParseError);
	});

	it("refuses a file from a newer Rendr rather than mangling it", () => {
		expect(() => parseProject(JSON.stringify({ ...project(), version: 99 }))).toThrow(
			/newer version/,
		);
	});

	it("fills in a missing name rather than failing", () => {
		const file = JSON.parse(JSON.stringify(project()));
		file.projectName = undefined;
		expect(parseProject(JSON.stringify(file)).projectName).toBe("Untitled Project");
	});
});

describe("relinking", () => {
	it("marks restored assets offline", () => {
		const restored = offlineAsset(toManifest(asset()));
		expect(restored.offline).toBe(true);
		expect(restored.url).toBe("");
		expect(countOfflineAssets([restored])).toBe(1);
	});

	it("relinks by filename and keeps the project's id so clips stay attached", () => {
		const offline = [offlineAsset(toManifest(asset()))];
		const incoming = [asset({ id: "fresh", url: "blob:new" })];
		const { relinked } = relinkAssets(offline, incoming);
		expect(relinked[0].id).toBe("a1");
		expect(relinked[0].url).toBe("blob:new");
		expect(relinked[0].offline).toBe(false);
	});

	it("leaves an asset offline when nothing matches", () => {
		const offline = [offlineAsset(toManifest(asset()))];
		const { relinked, unmatched } = relinkAssets(offline, [
			asset({ id: "x", name: "Other.mp4" }),
		]);
		expect(relinked[0].offline).toBe(true);
		expect(unmatched).toHaveLength(1);
	});

	it("does not consume one file for two offline assets of the same name", () => {
		const offline = [
			offlineAsset(toManifest(asset({ id: "a1" }))),
			offlineAsset(toManifest(asset({ id: "a2" }))),
		];
		const { relinked } = relinkAssets(offline, [asset({ id: "fresh" })]);
		expect(relinked.filter((entry) => entry.offline).length).toBe(1);
	});
});

describe("recording settings", () => {
	it("carries the cursor, the camera and the captured pointer path", () => {
		const file = parseProject(
			JSON.stringify(
				serializeProject({
					projectName: "Cut",
					timelines: [timeline],
					activeTimelineId: "tl",
					assets: [asset()],
					savedAt: "",
					cursor: { ...DEFAULT_CURSOR, size: 4 },
					webcam: { ...DEFAULT_WEBCAM, show: true, position: "top-left" },
					cursorTelemetry: [{ timeMs: 0, cx: 0.5, cy: 0.5 }],
				}),
			),
		);
		expect(file.cursor?.size).toBe(4);
		expect(file.webcam?.position).toBe("top-left");
		// Without the path a reopened project has no pointer to draw and no
		// clicks for suggest_zooms to read.
		expect(file.cursorTelemetry).toHaveLength(1);
	});

	it("fills in a setting a project written before it existed never had", () => {
		const raw = JSON.parse(
			JSON.stringify(
				serializeProject({
					projectName: "Cut",
					timelines: [timeline],
					activeTimelineId: "tl",
					assets: [],
					savedAt: "",
					cursor: DEFAULT_CURSOR,
				}),
			),
		);
		raw.cursor = { show: true, style: "arrow", size: 2 };
		const file = parseProject(JSON.stringify(raw));
		expect(file.cursor?.size).toBe(2);
		expect(file.cursor?.bounceSpeed).toBe(DEFAULT_CURSOR.bounceSpeed);
	});
});

describe("autosaving a film", () => {
	// This suite runs without a DOM, so there is no localStorage and the write
	// would silently no-op — the catch inside writeAutosave exists precisely so
	// a missing or full store never breaks editing. A real one in memory is what
	// makes the round trip testable at all.
	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (key: string) => store.get(key) ?? null,
				setItem: (key: string, value: string) => void store.set(key, value),
				removeItem: (key: string) => void store.delete(key),
			},
		});
	});

	// Built through the real serializer so the test exercises the shape the app
	// writes, not a hand-made object that could drift from it.
	const filmProject = (): ProjectFile =>
		parseProject(
			JSON.stringify(
				serializeProject({
					projectName: "Film only",
					timelines: [timeline],
					activeTimelineId: "tl",
					assets: [],
					savedAt: "2026-01-01T00:00:00.000Z",
					cinemaGraphs: [
						{
							id: "g1",
							name: "The Missed Train",
							auto: false,
							nodes: [
								{
									id: "c1",
									kind: "character",
									label: "Lead",
									text: "a dock worker",
									x: 10,
									y: 20,
									params: {
										voice: "low",
										image: { base64: "AAAA", mimeType: "image/png" },
									},
									status: "ready",
									output: { sheet: [{ base64: "BBBB", mimeType: "image/png" }] },
								},
							],
							edges: [],
						},
					],
				}),
			),
		);

	it("keeps the decisions and drops the pictures", () => {
		// Base64 sheets are megabytes; written whole the quota throws, the write
		// is swallowed, and nothing at all gets autosaved — the timeline lost for
		// the sake of images that can be regenerated.
		writeAutosave(filmProject());
		const back = readAutosave();
		const node = back?.cinemaGraphs?.[0].nodes[0];
		expect(node?.text).toBe("a dock worker");
		expect(node?.params.voice).toBe("low");
		expect(node?.output).toBeUndefined();
		expect(node?.params.image).toBeUndefined();
		expect(JSON.stringify(back)).not.toContain("BBBB");
	});

	it("comes back ready to run rather than claiming output it lost", () => {
		writeAutosave(filmProject());
		expect(readAutosave()?.cinemaGraphs?.[0].nodes[0].status).toBe("idle");
	});

	it("keeps the wiring and the film's name", () => {
		writeAutosave(filmProject());
		const graph = readAutosave()?.cinemaGraphs?.[0];
		expect(graph?.name).toBe("The Missed Train");
		expect(graph?.nodes).toHaveLength(1);
	});
});
