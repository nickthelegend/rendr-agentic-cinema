<div align="center">

<img src="public/branding/rendr-logo.svg" alt="Rendr Agentic Cinema" width="360" />

**A node graph that casts, writes and shoots a film — and hands you a timeline, not a file.**

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-2563eb?style=for-the-badge)](LICENSE.md)
[![MCP](https://img.shields.io/badge/MCP-102%20tools-7c3aed?style=for-the-badge)](#the-mcp-server)
[![Live](https://img.shields.io/badge/demo-hosted-3fc79a?style=for-the-badge)](https://web-production-d3da.up.railway.app)

**[Open the live demo →](https://web-production-d3da.up.railway.app)**

</div>

Rendr Agentic Cinema is a submission for [Agentic Cinema](https://agentic-cinema.devpost.com/).
You assemble a cast, a world and a story as a graph of nodes; a network of agents
turns that into ordered shots and renders them; and the result lands on a real
editable timeline rather than arriving as a video file you either accept or
regenerate.

## The argument

**The hard problem is consistency, not generation.** Making one picture of a
character is a single API call. Making *eleven pictures of the same character* is
the thing nobody has solved well, and it is what separates a demo from a tool. So
a Character node is not a prompt — it is an identity that gets locked once: a
reference, a sheet of angles, a seed, a canonical description. Every scene that
names that character passes the sheet as image context, and the app can show you
the same face across every shot it appears in.

**What comes out is a project, not a file.** Every other tool in this space hands
you a clip; when the third shot is wrong you regenerate and hope. Here the shots
land as clips on a timeline that already has 102 MCP tools over it — trim,
reorder, grade, caption, narrate, export. A shot that came out nearly right is
four seconds of trimming rather than a prompt rewritten ten times. It also means
the generative half never has to be perfect.

## What it does

| | |
|---|---|
| **Cast** | Lock a character from a description or a reference photo. The sheet — front, three-quarter, profile, back — is what every later shot refers back to. |
| **Write** | A story decomposes into ordered scene specs with a structured contract: who is in frame, where, what time, what camera, what happens. Continuity is checked across the set afterwards, not hoped for during. |
| **Shoot** | Each scene renders with a shot vocabulary — ten framings, seven lenses, ten lighting setups, seven stocks, a film-wide palette — inferred from the shot's own prose and overridable per node. |
| **Cut** | Scenes become clips on the timeline with a camera move over each, in the order the story asked for. |
| **Account** | Every model call becomes a row in Clickhouse: what was asked, which model, how long, whether a human kept it. |

## Clickhouse, and what it is actually for

The brief requires a partner integration with real runtime use. Clickhouse here is
the generation ledger, and it earns its place by making two things possible that
are otherwise hand-waving:

- **What did we already try.** Re-rendering a shot shows the takes you rejected,
  so nobody pays twice for the same mistake.
- **Which prompts actually work.** Kept takes are ranked by phrasing, so the
  leaderboard is a query rather than a feeling.

The insight panel asks the database to do the work — `quantileExact` for median
and p95 latency, `countIf` for failures and kept-rate, grouped by node kind and by
error kind. That is the difference between using a column store and using it as a
bucket.

In the hosted build the browser never talks to Clickhouse directly. It posts to a
same-origin path and a small server forwards an allow-list of statement shapes,
because pointing a page straight at a database means shipping the password in the
JavaScript bundle.

## Running it

```bash
npm install
npm run dev:ui          # the editor in a browser, no Electron
npm test                # 2072 tests
npm run build:web       # the hosted payload
```

The graph runs against a local stub when no model key is present. **The stub paints
"STUB · no model was called" into every frame it produces**, so a placeholder can
never be mistaken for a render in a screenshot or a demo. To use the real model,
put a key from [aistudio.google.com](https://aistudio.google.com) in `.env.local`:

```
VITE_GEMINI_API_KEY=...
```

That is a different product from a Gemini app subscription, which carries no API
quota. `Test connection` in the app runs five real checks against the API,
including measuring the returned PNG's dimensions rather than trusting the
requested aspect ratio.

To keep a ledger, point it at a Clickhouse:

```
VITE_CLICKHOUSE_URL=http://127.0.0.1:8123
VITE_CLICKHOUSE_USER=cinema
VITE_CLICKHOUSE_PASSWORD=...
```

Without one the app runs identically, minus the history — bookkeeping never blocks
a render.

## Where the desktop app fits

This began as [Rendr](#where-it-comes-from), a screen recorder and editor, and most
of that is still here. Recording is **gated rather than deleted**: one capability
flag turns off the capture panels, the record button and the recording MCP tools,
so the cinema build has no camera in it while the code stays compiled, tested and
able to take upstream fixes. The timeline, the export pipeline and the MCP surface
underneath are the recorder's, which is why a generated film arrives somewhere you
can actually work.

The MCP server is a desktop bridge and is not reachable from a browser tab; the
hosted build says so plainly rather than pretending otherwise.

---

## Where it comes from

Rendr is assembled from two existing open-source projects rather than written from
scratch. **Both are copyleft, and Rendr is licensed accordingly.**

| Project | License | What Rendr takes |
|---|---|---|
| [Recordly](https://github.com/webadderallorg/Recordly) | **AGPL-3.0** | Capture pipeline, cursor telemetry, the zoom camera, and the follow-camera model |
| [Palmier Pro](https://palmier.io) | **GPL-3.0** | The agent editing surface — the MCP tool contract |

> **A note on licensing.** Recordly is **AGPL-3.0**, not MIT. Rendr is therefore
> AGPL-3.0 too, and cannot be relicensed under a permissive license or offered as a
> closed hosted service without releasing the source. If you fork this, the same
> applies to you. Palmier Pro is GPL-3.0; its contribution here is the tool
> *contract* (names, schemas, descriptions), which is transcribed rather than
> compiled, since Palmier Pro is Swift/AppKit/Metal and Rendr is
> Electron/TypeScript.

Recordly's zoom machinery is used directly rather than reimplemented — Rendr
imports `computeZoomTransform`, `findDominantRegion` and `computeCursorFollowFocus`
from the upstream tree. That is deliberate: a reimplementation would drift, and the
feel of the zoom is the reason to start from Recordly at all.

---

## The zoom camera

This is the part worth understanding, because it is what makes a screen recording
watchable and it is not obvious.

**A zoom is a region, not a keyframe.** Each region carries a start and end in
*source* milliseconds, a depth (which maps to a scale), a focus point, and a mode.
Regions live on the clip, so trimming or sliding the clip carries its zooms with it.

**The camera holds still.** A naive follow points the camera at the cursor, which
makes the picture swim under a still hand and lurch on every small movement.
Recordly's camera instead keeps a persistent centre and only recenters when the
cursor leaves an inner **safe zone** — 25% inset from the edges of the zoomed
view — and then moves just far enough to bring it back inside. While a zoom is
releasing, the camera **freezes** where it was rather than drifting home.

That behaviour is stateful, so the state is carried across frames: the preview
holds one in a ref, an export holds one for the run. Both call the same function,
so what you scrub is what gets encoded.

**Zooms are cut automatically**, from **dwells as well as clicks**. A dwell is
the pointer resting somewhere for 450–2600 ms, and it is most of what is worth
punching in on — reading a diff, watching a log, hovering a menu, none of which
involve a click. Recordly exports `buildInteractionZoomSuggestions`, but that
function filters to explicit clicks and discards every dwell, so Rendr calls
`detectInteractionCandidates` directly and keeps both.

This depends on the capture recording a *stationary* pointer. Pointer events only
fire on movement, so a resting cursor writes no samples and a dwell degrades into
a single time gap between two distant points — invisible to the detector. The
capture emits a heartbeat sample at the same interval it thins moves to, which is
what makes "somebody stopped and read something" a zoomable moment at all.

**The camera is spring-driven.** The zoom curve gives a target; the camera does
not jump to it. Scale, x and y are each eased toward that target by a damped
harmonic oscillator (Hooke's law, solved analytically for all three damping
regimes) stepped once per frame. This is what gives a punch-in weight, and what
stops each recentre being a hard cut — on realistic cursor telemetry it reduces
peak frame-to-frame jerk from **525 px to 9.6 px**.

The spring is stepped in the animation frame, never during React render: a
render can happen for reasons unrelated to time passing, and under StrictMode it
happens twice, which would advance the spring twice per frame. While paused or
scrubbing the camera snaps instead, so the frame on screen is the frame you
asked for.

**Motion is tunable**, and matches Recordly's defaults to the millisecond:

| Setting | Default | What it does |
|---|---|---|
| Smoothness | 0.5 | How much the spring eases toward the curve. 0 cuts straight to it |
| Punch in | 1522.6 ms | Time to reach full strength |
| Release | 1015.1 ms | Time to let go |
| Connect zooms | on | Two nearby zooms pan between each other instead of releasing and punching in again |

The drawn cursor uses the same solver, springing toward the raw sample rather
than lagging behind it — a fixed lag reproduces every jitter faithfully, just
late.

---

## Panels

The take-wide settings live in the media rail and in the inspector when nothing is
selected — one implementation, two places, so they cannot drift.

### Background

A raw capture fills the frame edge to edge and reads as a document. Insetting it,
rounding its corners, dropping a shadow under it and putting something behind is
most of what makes it read as a shot.

- **Backdrop** — none, colour, gradient, or a custom image
- **10 gradient presets**, chosen dark enough that white UI stays readable
- **Padding** measured off the frame's *short* edge, so a 9:16 project gets the
  same visual margin as 16:9
- **Radius** and **shadow**, the shadow scaled to canvas height so 720p and 4K match

A custom backdrop is embedded in the project file as a data URI (capped at 8 MB),
so it survives a save rather than dying with the session.

### Cursor

A capture records the pointer as a few hard pixels that vanish at any zoom. Rendr
captures its position separately and draws its own, which is what makes it
scalable, smoothable and clickable-looking.

The capture is opened with `cursor: "never"` (and Chromium's `googCaptureCursor`,
which is the one the desktop pipeline actually reads) whenever telemetry is being
recorded — otherwise the take contains *two* pointers, the small real one the OS
drew and the big one Rendr draws over it. With telemetry off the hardware pointer
is kept, because then it is the only pointer there will ever be.

- **Style** — arrow, arrow with shadow, solid arrow, dot, pointer
- **Size, smoothing, sway** — smoothing springs the drawn pointer toward the raw
  sample, which is what turns jittery hardware sampling into a glide
- **Motion blur**, default **0** — and *directional* when turned up: the smear runs
  along the direction of travel and the perpendicular edges stay sharp. A symmetric
  `blur()` reads as the pointer being out of focus rather than moving
- **Click bounce** and its speed
- **Spotlight** — dims everything outside a soft radial falloff around the pointer
- **Click ring** — expands and fades over 520 ms, deliberately outliving the bounce,
  because on a fast click the pop is over before your eye lands on it

### Webcam

The camera is recorded to its **own file** alongside the screen, not burnt into the
capture — so its size, corner and shape stay editable afterwards. The two share a
clock, so the encoder lines them up without drift correction.

- Position (9-cell grid), shape (rounded/circle/square), size, margin, mirror
- **Reacts to zoom** — the bubble grows a little while the camera is punched in, so
  the presenter doesn't shrink away against the magnified detail
- Per-side crop, applied before the bubble's own centre-crop-to-fill

---

## The MCP server

Rendr runs an MCP server on `127.0.0.1:19790` so **Claude Code, or any agent-driven
IDE**, can drive the editor. It speaks streamable HTTP JSON-RPC.

### Connecting from Claude Code

```bash
claude mcp add --transport http rendr http://127.0.0.1:19790/mcp
```

Any other MCP-capable client works the same way — point it at that URL while Rendr
is running.

### What the agent can do — 101 tools

Every one has a handler, is advertised over MCP, and has been run against the
running app. None is a stub.

**Read** · `get_timeline` `inspect_timeline` `get_media` `inspect_media`
`search_media` `capture_frame` `inspect_color` `get_transcript`
`get_recording_status` `manage_exports` `project_stats` `find_text`
`find_gaps` `check_timeline`

**Look at it** · `view_frame` `compare_frames` `export_still_sequence`

**Timeline** · `add_clips` `insert_clips` `move_clips` `remove_clips` `split_clips`
`ripple_delete_ranges` `set_clip_properties` `set_keyframes` `apply_layout`
`sync_clips` `manage_tracks` `duplicate_clips` `nudge_clips` `trim_clips`
`add_transition` `fit_to_duration` `trim_dead_air` `undo`

**Arrange** · `align_clips` `distribute_clips` `stagger_clips` `close_gaps`
`copy_clip_style` `add_freeze_frame` `replace_media`

**Project** · `create_timeline` `set_active_timeline` `set_project_settings`
`manage_project` `organize_media` `import_media` `export_project`
`batch_export` `remove_unused_media`

**Colour** · `apply_color` `auto_color` `match_color` `apply_lut` `reset_grade`
`save_look` `apply_look` `manage_looks` `check_color_consistency`
`find_scene_changes`

**Motion and framing** · `add_ken_burns` `add_motion_preset` `crop_clips`
`reframe_timeline` `apply_effect`

**Sound** · `denoise_audio` `normalize_audio` `duck_audio` `remove_silence`
`find_silence` `fade_audio` `set_track_volume` `measure_audio`
`check_audio_sync` `align_to_beats` `detect_beats` `mix_to_asset`

**Text and captions** · `add_texts` `add_title` `add_countdown` `update_text`
`add_captions` `style_captions` `export_subtitles` `remove_words`

**Recording** · `list_capture_sources` `start_recording` `stop_recording`
`set_cursor` `set_webcam` `set_background`

**Zoom** · `suggest_zooms` `add_zoom_regions` `update_zoom_regions`

**Notes and narration** · `manage_comments` `setup_voice` `narrate_timeline`

**Workflows** · `manage_workflows` `edit_workflow` `run_workflow`

### The contract

Tools **refuse rather than pretend**. A capability this build genuinely can't do
returns a structured refusal naming what to use instead — never a success-shaped
response for work that didn't happen. Three examples:

- `apply_color` accepts hue targets and 3D LUTs because both now render identically
  in the preview and the file. Anything that would only appear on export is refused,
  because a grade you can't see while editing is worse than none.
- `set_webcam` reports that opening a camera is asynchronous and tells you to read
  the state back before recording, rather than claiming the camera is on.
- `export_project` reports which encoder took the job — `webcodecs-offline` or
  `mediarecorder-realtime` — because they write different containers.

---

## Notes and narration

**Notes** are pinned to timeline frames, on their own lane above the media.
Double-click the Notes track to write one. A note is not a clip — no picture, no
trimming, and it never affects what renders — so it lives beside the timelines
rather than inside them.

They are also the **narration script**. Write one note per beat of the demo, then
`narrate_timeline` speaks them in order and lays each line on a Narration track
starting at its note's frame.

**Speech is local.** Kokoro-82M runs on this machine through onnxruntime — no API
key, no account, and nothing about the project is uploaded, which matters because
narration is usually written against something unreleased. The model is ~90 MB
quantised and is not shipped with the app; `setup_voice` (or **Install voices** in
the inspector) downloads it once into the app's data directory. 28 voices.

A note remembers the words it was spoken from. Edit the wording and the line is
marked **stale** — dashed on the timeline, flagged in `manage_comments` — because
audio that silently disagrees with the script is the kind of mismatch nobody
catches until export. Re-running narration skips notes whose audio is already
current, so it is cheap to run repeatedly.

Lines that would run into the note after them are **reported, not fixed**:
shortening the wording is a writing decision and moving the note is an editing
one, and guessing which was wanted is how narration ends up out of step.

---

## Recording a demo of another project

The thing this exists for: you built something at a hackathon, it is 2am, and
you do not want to record and edit a walkthrough by hand.

Install the skill into the repo you want filmed:

```bash
npx degit nickthelegend/rendr-desktop/.claude/skills/rendr-demo .claude/skills/rendr-demo
npm i -D playwright && npx playwright install chromium
cp .claude/skills/rendr-demo/HACKATHON_DEMO.template.md HACKATHON_DEMO.md
```

Describe the video in `HACKATHON_DEMO.md` — plain English, no config:

```markdown
**App:** http://localhost:3000
**Length:** about 75 seconds

## Flow
1. Land on the dashboard. Say this tracks carbon spend across a supply chain.
2. Click into "Suppliers" and hover the worst row. Say scoring runs on ingest,
   so it is current rather than nightly.
3. Open a supplier, scroll to the emissions chart. Say this is the per-shipment
   breakdown nobody else exposes.
4. Click "Generate report". Say it produces an auditor-ready PDF in one step.
```

Start your app, have Rendr running, and ask:

> Record my demo from HACKATHON_DEMO.md

You get an MP4 with punch-in zooms that follow the cursor, a drawn pointer,
spoken narration, and karaoke subtitles on a readable plate.

**Nothing touches your mouse or records your screen.** Playwright drives a
headless browser, and the pointer path is *authored* rather than captured — a
script knows where it is about to click before it clicks, so the path is
generated, eased, and handed to Rendr through `import_telemetry`. Rendr draws
its own cursor and cuts zooms from that path exactly as it would from a native
capture, because nothing downstream cares where the points came from.

That makes it better than a real recording, not a compromise: the motion is
smooth by construction, nothing shakes, and none of your desktop is in frame.

Under the hood it is two commands, and you can run them yourself:

```bash
node .claude/skills/rendr-demo/scripts/record-demo.mjs demos/my-app.json demo-out
node .claude/skills/rendr-demo/scripts/build-demo.mjs demo-out --export
```

`RENDR_CAPTIONS` picks the subtitle look — `plate` (default), `karaoke`,
`shorts`, `pop`, `typewriter`, `clean`, `emphasis`. `RENDR_VOICE` picks the
Kokoro voice.

Two things decide whether the result is watchable, and both are handled for
you: a beat is held for at least as long as its narration takes to speak, or
the caption and narration tracks stack and the lower clip of each pair never
renders; and the pointer is kept moving toward whatever is on screen, or every
zoom shares one focus point and the whole video punches into the same spot.

## Review speed

A continuous bar in the transport, 0.25×–4×, rather than 1×/2× presets — the rate
that keeps a passage readable is one you find by dragging. Click the number to
snap back to 1×. It multiplies onto each clip's own speed for playback only, so
nothing it does can reach the export.

---

## Export

Two paths, chosen automatically:

**Offline (default)** — WebCodecs `VideoEncoder` into an MP4 (H.264 + AAC).
Frame timestamps come from the timeline, so the file's duration is exact. Source
frames are decoded through a WebCodecs cursor rather than by seeking a `<video>`.

Measured on a 1080p screen take:

| approach | ms/frame |
|---|---|
| decode cursor | **5.5** |
| `<video>` seek | 11.2 |
| `getCanvas(t)` per frame | 104.9 |

A 12-second 1080p export takes about **2 seconds**.

**Real-time (fallback)** — MediaRecorder into WebM (VP9), used when no WebCodecs
encoder accepts the frame size. Takes about as long as the video runs.

---

## Development

```bash
npm install
npm run dev
```

```bash
npm test
```

**1165 tests across 109 files**, including an end-to-end suite that drives the real
editor state through a whole session — import, place, split, undo, grade, save,
reopen — and a pointer-geometry suite that drives real drag gestures.

---

## License

**AGPL-3.0.** See [LICENSE.md](LICENSE.md).

This is inherited, not chosen: Recordly is AGPL-3.0 and Palmier Pro is GPL-3.0.
Network use counts as distribution under the AGPL — if you host Rendr as a service,
you must offer its source to your users.
