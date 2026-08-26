# 100 more ideas, ranked

Round two. Round one is in [IDEAS.md](IDEAS.md) and most of its top tier is
built — the shell, the graph, the runner, the Clickhouse ledger, the
consistency report, ⌘K, the run theatre, templates, the timeline commit, the
hosted URL, the trailer. Nothing already built appears below.

Scored **impact × feasibility × fit**. Fit is weighted hardest: the pitch is
*the graph is the film crew, and what comes out is a project rather than a
file*. A hundred disconnected features would blur that, so anything that does
not sharpen it is ranked down however clever it is.

Three assets shape the ranking, because they are things this repo can do for
real today with no credential at all:

- **Kokoro** is already a dependency and runs locally. The film can have a
  *voice* without an API key. It is currently used only by the trailer script.
- **Clickhouse** is live, persistent and reachable through a same-origin proxy.
- **Stellar testnet** funds accounts programmatically, so provenance can be
  notarised with a genuinely signed transaction and read back off-chain.

---

## Tier 1 — build first

| # | Idea | Why it wins |
|---|---|---|
| 1 | **The film speaks.** Kokoro renders the planned narration and dialogue in the browser; the audio lands on a real audio track under the shots it belongs to | `sound.ts` plans who says what and never says it. A silent film demo is half a demo, and this needs no API key — it works in front of a judge on a laptop with no network |
| 2 | **On-chain provenance.** Every render's manifest — prompts, seeds, model, frame digests — is hashed and notarised in a signed Stellar testnet transaction | The one honest answer to "how do I know what was machine-generated?" A real signed tx and a public explorer link beat any claim |
| 3 | **Verify tab** — re-reads the transaction *from chain*, recomputes the digest locally, and says match or mismatch | Proves the notarisation is a read, not a receipt we printed ourselves |
| 4 | **Likeness score.** Perceptual hash of every rendered shot against the character sheet, scored and charted | The consistency panel currently claims nothing about likeness. A real pHash gives the central thesis a number without needing a model |
| 5 | **Narration waveform on the timeline**, cut to shot boundaries | Makes the audio visible, and proves it is on a real track rather than played over the top |
| 6 | **Clause attribution in Clickhouse** — which prompt clauses correlate with kept takes vs rejected ones | Partner integration that is obviously past the minimum: real SQL answering an editorial question |
| 7 | **Shareable film link.** The whole graph compressed into the URL fragment | A judge opens *your* film, not a blank canvas. No backend, no account |
| 8 | **Live SQL console** in the ledger panel, against the same guarded proxy | Judges remember seeing the actual query run |
| 9 | **Assembly finale** — when the cut lands, the shots fly into a filmstrip and settle | The one motion moment worth remembering, at the moment the pitch lands |
| 10 | **Provenance badge on every clip** — notarised, pending, or unverifiable | Carries idea 2 into the surface people actually look at |

## Tier 2 — strong

| # | Idea |
|---|---|
| 11 | Ambient room tone per world, generated and laid under the whole cut |
| 12 | Per-shot audio ducking so narration sits over room tone |
| 13 | Character voice casting UI — audition each Kokoro voice against a real line |
| 14 | Prompt diff view between two takes of the same shot |
| 15 | Clickhouse-backed "films like this one" — nearest neighbour on shot-size histogram |
| 16 | Render queue with pause, resume and reorder |
| 17 | Retry-with-variation on a single failed shot |
| 18 | Contact sheet export — every shot as one printable PNG |
| 19 | EDL / CMX3600 export alongside the existing FCPXML |
| 20 | Shot-size balance meter that warns when a cut is 80% mediums |
| 21 | Colour-script strip — dominant colour per shot as a ribbon under the timeline |
| 22 | Beat-to-shot coverage map, showing which beats no shot covers |
| 23 | Character screen-time bar chart from the scene specs |
| 24 | Dialogue-to-silence ratio per shot with a pacing warning |
| 25 | Storyboard print stylesheet with real page breaks |
| 26 | Graph minimap that shows run state, not just position |
| 27 | Node search with highlight-in-place and zoom-to |
| 28 | Multi-select drag with a marquee and group move |
| 29 | Copy/paste a subgraph, including its outputs |
| 30 | Undo history panel with named steps you can jump to |
| 31 | Autosave indicator that says what was saved and when |
| 32 | Conflict-safe autosave — refuse to clobber a newer save |
| 33 | Offline banner with a real navigator.onLine listener and a retry |
| 34 | Clickhouse health indicator with latency, not just up/down |
| 35 | Per-node error surface showing the model's actual refusal text |
| 36 | Rate-limit backoff with a visible countdown |
| 37 | Budget forecast — "this graph will cost about X" before you press run |
| 38 | Spend history sparkline in the dock |
| 39 | Cost per kept shot, which is the number that actually matters |
| 40 | Session summary card at the end of a run |

## Tier 3 — good, smaller

| # | Idea |
|---|---|
| 41 | Reduced-motion honoured in the assembly finale too |
| 42 | Focus rings that match the dark theme rather than the browser default |
| 43 | Full keyboard traversal of the graph with arrow keys |
| 44 | Screen-reader announcements for run start, progress and finish |
| 45 | High-contrast mode toggle |
| 46 | Colour-blind-safe status palette |
| 47 | Node tooltips that explain the *why*, not the *what* |
| 48 | First-run coach marks that dismiss permanently |
| 49 | Empty state per node kind, not one generic message |
| 50 | Drag-and-drop an image straight onto the canvas to make a Reference |
| 51 | Paste an image from the clipboard as a Reference |
| 52 | Duplicate a character with one changed trait |
| 53 | Lock a node so a run skips it |
| 54 | Pin a take as the keeper and mark the rest as alternates |
| 55 | Side-by-side take compare with a wipe slider |
| 56 | Zoom-to-fit on a keypress |
| 57 | Snap-to-grid toggle with a visible grid change |
| 58 | Edge labels naming what flows down them |
| 59 | Port highlighting for compatible targets while dragging |
| 60 | Node collapse for a dense graph |
| 61 | Group nodes into a named cluster |
| 62 | Graph statistics — node count, depth, fan-out |
| 63 | Cycle detection with the offending edge named |
| 64 | Orphan detection — nodes nothing consumes |
| 65 | A "why is this node not ready" explainer |
| 66 | Warm-start: reuse an identical previous render instead of paying twice |
| 67 | Content-addressed take cache keyed on the exact prompt |
| 68 | Export the ledger as CSV from the panel, not just the API |
| 69 | Import a ledger CSV to compare two sessions |
| 70 | Time-travel: view the graph as it was at a chosen ledger row |

## Tier 4 — real but lower priority

| # | Idea |
|---|---|
| 71 | Multi-language narration using Kokoro's other voices |
| 72 | Subtitle burn-in as a timeline text track |
| 73 | SRT export cut to shot boundaries |
| 74 | Aspect-ratio presets that re-frame the whole film |
| 75 | Safe-area overlay for titles |
| 76 | Letterbox preview toggle |
| 77 | LUT preview strip over the contact sheet |
| 78 | Look node applied as a real colour transform, not a prompt clause |
| 79 | Film-grain overlay as an editor effect |
| 80 | Shot duration nudge with a live runtime readout |
| 81 | Auto-trim to a target runtime |
| 82 | Music bed slot with beat-aligned cuts |
| 83 | Title card generator using the film name and world |
| 84 | End credits built from the cast and voice nodes |
| 85 | Watermark toggle for the hosted build |
| 86 | Per-film theme colour derived from the world's palette |
| 87 | Node kind icons that differ by more than colour |
| 88 | Dock overflow menu when the window is narrow |
| 89 | Responsive canvas layout below 900px |
| 90 | Touch support for pan and pinch |
| 91 | Print-friendly report stylesheet |
| 92 | Deep link straight to the consistency tab |
| 93 | Copy a shot's full prompt to the clipboard |
| 94 | Regenerate one shot without re-running the graph |
| 95 | Diff two films by shot list |
| 96 | Template from the current graph |
| 97 | Named presets for camera language |
| 98 | Per-project default seed |
| 99 | A demo-reset command that returns the app to a known clean film |
| 100 | Crash boundary that keeps the graph and offers to reload just the canvas |

---

## Not built, and why

Kept honest rather than quietly dropped — see the final section of the report
for what actually shipped.
