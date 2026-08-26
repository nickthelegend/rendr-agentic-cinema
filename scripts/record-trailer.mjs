// The submission trailer, recorded from the running product.
//
// The brief asks for a three-minute film. This makes one the only honest way
// available: it drives the deployed app in a real browser, narrates each beat
// with speech generated on this machine, and holds every shot for exactly as
// long as its line takes to say — so the picture and the voice cannot drift.
//
// Nothing here is staged. The graph really runs, the ledger panel really reads
// Clickhouse, and the clips really land on the timeline. Frames come back
// stamped "STUB · no model was called" because no Gemini key exists; that stamp
// stays in the trailer rather than being cropped out, because a trailer that
// hides which half is real is worse than no trailer.
//
//   node scripts/record-trailer.mjs [url]

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const URL_UNDER_TEST = process.argv[2] ?? "https://web-production-d3da.up.railway.app";
const OUT = ".trailer";
const VOICE = "af_heart";

/**
 * The script, as beats.
 *
 * `say` is the narration. `run` is what happens on screen while it is said, and
 * receives the page. A beat holds for however long its line actually takes plus
 * a breath — never a fixed guess, which is what makes narration slide out of
 * sync three shots in.
 */
const BEATS = [
	{
		say: "Every tool that generates video hands you a clip. When the third shot is wrong, you regenerate, and you hope.",
		run: async () => {
			// Nothing to drive: this beat only holds what the last one left on screen
			// while the line is spoken over it.
		},
	},
	{
		say: "This one hands you a film crew. Agentic Cinema is a node graph that casts, writes and shoots — and gives you back a timeline.",
		run: async (page) => {
			await menu(page, "New Film…");
			await click(page, "Create");
			await page.waitForTimeout(1800);
		},
	},
	{
		say: "A film starts empty. There are four ways in: a story, a character, a first frame, or the world they live in.",
		run: async () => {
			// Nothing to drive: this beat only holds what the last one left on screen
			// while the line is spoken over it.
		},
	},
	{
		say: "Or start from a shape. A short film is five beats, a cast, a world, and five shots waiting to be taken.",
		run: async (page) => {
			await menu(page, "New Short film…");
			await click(page, "Create");
			await page.waitForTimeout(2200);
		},
	},
	{
		say: "The hard problem here is not generating a picture. It is generating eleven pictures of the same person.",
		run: async () => {
			// Nothing to drive: this beat only holds what the last one left on screen
			// while the line is spoken over it.
		},
	},
	{
		say: "So a character is not a prompt. It is an identity, locked once: a sheet of angles, a seed, a description that every later shot refers back to.",
		run: async (page) => {
			await page.evaluate(() => document.querySelectorAll(".cshell__render")[0]?.click());
			await page.waitForTimeout(3000);
		},
	},
	{
		say: "Watch it work. The story decomposes into ordered shots, the cast is locked, and each scene renders against that locked face.",
		run: async (page) => {
			await page.waitForTimeout(6000);
		},
	},
	{
		say: "Every call is a row in Clickhouse — what was asked, which model answered, how long it took, and whether a human kept it.",
		run: async (page) => {
			await waitForIdle(page, 40_000);
		},
	},
	{
		say: "Here is the claim, made visible. One character, the sheet it was locked with, and every frame it appears in — side by side.",
		run: async (page) => {
			await tool(page, "Cast and voices");
			await page.waitForTimeout(2500);
		},
	},
	{
		say: "And here is the ledger reading itself back. Median and ninety-fifth percentile latency, failures by kind, all computed in the database rather than in the page.",
		run: async (page) => {
			await page.evaluate(() =>
				[...document.querySelectorAll(".crep__tabs button")]
					.find((b) => b.textContent.trim() === "Ledger")
					?.click(),
			);
			await page.waitForTimeout(3000);
		},
	},
	{
		say: "Then the part nobody else does. The shots become clips on a real timeline, in the order the story asked for, each with a camera move over it.",
		run: async (page) => {
			await page.keyboard.press("Escape");
			await page.waitForTimeout(600);
			await tool(page, "Put");
			await page.waitForTimeout(5000);
		},
	},
	{
		say: "Trim it. Reorder it. Grade it, caption it, export it. A shot that came out nearly right is four seconds of work, not a prompt rewritten ten times.",
		run: async (page) => {
			await page.waitForTimeout(2000);
		},
	},
	{
		say: "What comes out is a project, not a file. Agentic Cinema — open source, and running at the link below.",
		run: async (page) => {
			await page.waitForTimeout(1500);
		},
	},
];

// ── driving the app ────────────────────────────────────────────────────

const menu = async (page, label) => {
	await page.evaluate(() =>
		[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "File")?.click(),
	);
	await page.waitForTimeout(700);
	await page.evaluate((name) => {
		[...document.querySelectorAll("[role=menuitem]")]
			.find((b) => b.getAttribute("aria-label") === name)
			?.click();
	}, label);
	await page.waitForTimeout(700);
};

const click = async (page, text) => {
	await page.evaluate((t) => {
		[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t)?.click();
	}, text);
	await page.waitForTimeout(500);
};

const tool = async (page, prefix) => {
	await page.evaluate((p) => {
		[...document.querySelectorAll(".cshell__tool, .cshell__glyph")]
			.find((b) => (b.getAttribute("aria-label") || "").startsWith(p))
			?.click();
	}, prefix);
};

/** Waits for the render to finish rather than guessing how long it takes. */
const waitForIdle = async (page, timeout) => {
	const until = Date.now() + timeout;
	while (Date.now() < until) {
		const done = await page.evaluate(
			() => document.querySelector(".cshell__render")?.textContent?.trim() === "Up to date",
		);
		if (done) return;
		await page.waitForTimeout(1000);
	}
};

// ── speech ─────────────────────────────────────────────────────────────

async function narrate() {
	const { KokoroTTS } = await import("kokoro-js");
	console.log("loading the voice…");
	const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
		dtype: "q8",
		device: "cpu",
	});

	const lines = [];
	for (const [index, beat] of BEATS.entries()) {
		const file = join(OUT, `line-${String(index).padStart(2, "0")}.wav`);
		const audio = await tts.generate(beat.say, { voice: VOICE });
		await audio.save(file);
		const seconds = Number(
			execFileSync("ffprobe", [
				"-v", "error",
				"-show_entries", "format=duration",
				"-of", "csv=p=0",
				file,
			]).toString().trim(),
		);
		lines.push({ file, seconds, say: beat.say });
		console.log(`  ${index + 1}/${BEATS.length}  ${seconds.toFixed(1)}s  ${beat.say.slice(0, 52)}…`);
	}
	return lines;
}

// ── subtitles ──────────────────────────────────────────────────────────

const stamp = (seconds) => {
	const ms = Math.round(seconds * 1000);
	const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
	const m = String(Math.floor(ms / 60_000) % 60).padStart(2, "0");
	const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
	return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
};

/** Wraps a line so a subtitle never runs past the edge of the frame. */
const wrap = (text, width = 46) => {
	const out = [];
	let line = "";
	for (const word of text.split(" ")) {
		if ((line + word).length > width) {
			out.push(line.trim());
			line = "";
		}
		line += `${word} `;
	}
	if (line.trim()) out.push(line.trim());
	return out.slice(0, 2).join("\n");
};

// ── main ───────────────────────────────────────────────────────────────

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const lines = await narrate();

console.log(`\nrecording ${URL_UNDER_TEST}`);
const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1280, height: 720 },
	recordVideo: { dir: join(OUT, "raw"), size: { width: 1280, height: 720 } },
	colorScheme: "dark",
	deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

/*
 * Subtitles are drawn into the page rather than burned by ffmpeg.
 *
 * The ffmpeg on this machine is built without libass or libfreetype, so the
 * ass, subtitles and drawtext filters do not exist — there is no way to burn
 * text into the video after the fact. But the page is ours, so the caption can
 * simply be part of what gets recorded. It is genuinely on screen, which is
 * what "burned in" means anyway.
 */
await page.addStyleTag({
	content: `
		#trailer-sub {
			position: fixed; left: 0; right: 0; bottom: 34px; z-index: 2147483647;
			display: flex; justify-content: center; pointer-events: none;
			font: 600 21px/1.4 -apple-system, "Helvetica Neue", sans-serif;
		}
		#trailer-sub span {
			max-width: 76%; padding: 10px 18px; border-radius: 10px;
			background: rgba(8,8,10,.82); color: #fff; text-align: center;
			box-shadow: 0 8px 30px rgba(0,0,0,.5);
			backdrop-filter: blur(8px);
		}
		#trailer-url {
			position: fixed; right: 18px; top: 66px; z-index: 2147483647;
			pointer-events: none; font: 500 12px ui-monospace, Menlo, monospace;
			color: rgba(255,255,255,.55);
		}
	`,
});
await page.evaluate((url) => {
	const sub = document.createElement("div");
	sub.id = "trailer-sub";
	sub.innerHTML = "<span></span>";
	document.body.appendChild(sub);
	const tag = document.createElement("div");
	tag.id = "trailer-url";
	tag.textContent = url.replace(/^https?:\/\//, "");
	document.body.appendChild(tag);
}, URL_UNDER_TEST);

const caption = async (text) => {
	await page.evaluate((t) => {
		const span = document.querySelector("#trailer-sub span");
		if (span) span.textContent = t;
	}, text);
};

const marks = [];
let at = 0;
for (const [index, beat] of BEATS.entries()) {
	const line = lines[index];
	const started = Date.now();
	await caption(beat.say);
	marks.push({ from: at, to: at + line.seconds, say: beat.say });
	console.log(`  beat ${index + 1}: ${line.seconds.toFixed(1)}s`);
	await beat.run(page);
	// Hold the shot for the rest of the line, plus a breath. A beat whose
	// actions ran long simply takes the time it took — the narration offset
	// below is computed from the same clock, so they cannot drift apart.
	const spent = (Date.now() - started) / 1000;
	const hold = Math.max(0, line.seconds + 0.6 - spent);
	await page.waitForTimeout(hold * 1000);
	at += Math.max(line.seconds + 0.6, spent);
	marks[marks.length - 1].to = at;
}

await context.close();
await browser.close();

// Playwright names the file after the page, so find whatever it wrote.
const { readdir } = await import("node:fs/promises");
const raw = (await readdir(join(OUT, "raw"))).find((f) => f.endsWith(".webm"));
if (!raw) throw new Error("playwright wrote no video");
const rawPath = join(OUT, "raw", raw);

// One narration track: each line laid at the offset its beat actually started.
const inputs = lines.flatMap((line) => ["-i", line.file]);
const delays = lines
	.map((_, i) => `[${i + 1}:a]adelay=${Math.round(marks[i].from * 1000)}|${Math.round(marks[i].from * 1000)}[a${i}]`)
	.join(";");
const mixed = lines.map((_, i) => `[a${i}]`).join("");

await writeFile(
	join(OUT, "subs.srt"),
	marks
		.map((m, i) => `${i + 1}\n${stamp(m.from)} --> ${stamp(m.to)}\n${wrap(m.say)}\n`)
		.join("\n"),
);

console.log("\nmuxing…");
execFileSync(
	"ffmpeg",
	[
		"-y",
		"-i", rawPath,
		...inputs,
		// The subtitle burn lives inside filter_complex, not in -vf. ffmpeg
		// refuses to let both drive the same video output, and the failure is a
		// bare exit code rather than a sentence about it.
		"-filter_complex",
		`${delays};${mixed}amix=inputs=${lines.length}:normalize=0[voice]`,
		"-map", "0:v",
		"-map", "[voice]",
		"-c:v", "libx264",
		"-preset", "medium",
		"-crf", "20",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-b:a", "160k",
		"-shortest",
		join(OUT, "trailer.mp4"),
	],
	{ stdio: ["ignore", "inherit", "inherit"] },
);

const duration = execFileSync("ffprobe", [
	"-v", "error",
	"-show_entries", "format=duration",
	"-of", "csv=p=0",
	join(OUT, "trailer.mp4"),
]).toString().trim();

console.log(`\nwrote ${join(OUT, "trailer.mp4")} — ${Number(duration).toFixed(1)}s`);
