# Test plan — rendr-agentic-cinema

Executed against the running app in a real Chromium (Browser pane), a real
ClickHouse 24.8 in Docker, and real file downloads. Every item states what
*correct* means before it is run. Console and network are inspected on every
item; any error anywhere fails the item.

**Environment**
- App: `vite --config vite.ui.config.ts`, `http://localhost:5233/?windowType=editor-next`
- DB: ClickHouse 24.8.14.39, container `rendr-clickhouse`, user `cinema`, db `cinema`
- Model provider: **no Gemini API key exists in this repo or environment.**
  Items that require a real generative call are marked UNTESTABLE and are not
  claimed as passes. Everything else runs for real.

---

## A. Shell chrome

| # | Item | Correct means |
|---|---|---|
| A1 | Film view takes the whole window | With a film open, `.pmr-titlebar` is `display:none`, `.cshell` fills the viewport, exactly one top bar exists |
| A2 | Menus live in the shell bar | File/Edit/View/Timeline/Help render inside `.cshell__bar` and open on click |
| A3 | Top bar right cluster | EN, share, Connection, ⚡budget, Auto toggle, notes, cast, Agent all render; none is a no-op |
| A4 | Budget is real | ⚡ value equals `DEFAULT_CALL_CEILING (60) − calls recorded in ClickHouse for this film`, and decreases after a run |
| A5 | Agent button toggles the agent rail | One click hides it, second click shows it |
| A6 | View segment | Clapper is active on canvas; timeline icon returns to the editor (film closes, titlebar returns) |
| A7 | Dock renders | Two floating pills; Assets + 5 tools + zoom on the left, 9 tools on the right; cursor tool is the inverted/active one |
| A8 | Presence pill | Top-right shows a people icon and `0` |

## B. Film lifecycle

| # | Item | Correct means |
|---|---|---|
| B1 | New Film… creates an empty film | Dialog accepts a name; canvas shows the empty state; graph has 0 nodes; title bar shows the typed name |
| B2 | Empty state content | Sparkle badge, heading "Double-click the canvas to generate nodes freely", subtitle, 4 starter cards, Template library + Upload reference |
| B3 | Starter card creates a node | Clicking each of the 4 cards adds exactly one node of the mapped kind (story / character / scene / world) and dismisses the empty state |
| B4 | Template: Short film | 14 nodes, 0 preflight problems, already laid out (autoLayout is a fixed point), every scene has a distinct `sceneIndex` |
| B5 | Template: Advertisement | Same contract as B4 |
| B6 | Template: Music video | Same contract as B4, 17 nodes |
| B7 | Template: Documentary | Same contract as B4 |
| B8 | Export Film… | Downloads `<name>.film.json`; content is `format: "rendr-cinema/1"`, node/edge counts match the graph, **no base64 image bytes** |
| B9 | Import Film… | A previously exported file re-creates the film with the same node and edge counts, every node `status: "idle"` |
| B10 | Import rejects junk | Non-JSON → "That file is not JSON."; wrong format → "Unknown format"; 0 nodes → "That film has no nodes." No crash, no console error |

## C. Graph editing

| # | Item | Correct means |
|---|---|---|
| C1 | Double-click adds a node | Double-clicking empty canvas opens a 10-item picker at the pointer; choosing a kind creates that node at that position; the pane does **not** zoom |
| C2 | Picker dismisses | Clicking the pane closes the picker without creating anything |
| C3 | Palette adds a node | Each palette button adds one node of its kind |
| C4 | Node selection | Single click selects and fills the inspector; clicking empty canvas deselects and shows the overview |
| C5 | Duplicate | Copies params and **inbound** edges, not outbound; copy is `idle` with no output; ids stay unique |
| C6 | Legal connection | Character → Story connects and renders an edge |
| C7 | Illegal connection refused **with a reason** | Attempting e.g. Timeline → Character is refused and a toast explains why |
| C8 | Tidy | Every node sits strictly right of all its inputs; roots share the first column; node count unchanged |
| C9 | Undo | ⌘Z steps the graph back **and the canvas follows** |
| C10 | Delete | Removing a node removes every edge that touched it |

## D. Inspector

| # | Item | Correct means |
|---|---|---|
| D1 | Per-kind fields | Character shows "Who they are" + Voice; World shows Palette; Scene shows Aspect, Which shot, Craft; Story shows Target length |
| D2 | Craft controls | 5 selects populated from `CRAFT_OPTIONS` (11/9/8/11/8 options incl. "from the shot"), reference-strength slider, "Keep out" field |
| D3 | Craft reaches the prompt | A chosen lens/stock appears verbatim in the prompt recorded in ClickHouse for that node |
| D4 | Inference when unset | With nothing chosen, the recorded prompt still contains a shot-size clause and a lighting clause derived from the shot's own prose |
| D5 | Staleness | Editing a character marks it and every downstream node stale; unrelated branches are untouched; Render count changes to match |
| D6 | Previous takes | After a run, the node's history lists the take with timestamp, model and duration, read from ClickHouse |
| D7 | Keep / Discard | Clicking Keep sets `accepted = 1` in ClickHouse for that exact row and the row reads "kept" |
| D8 | Overview when nothing selected | Prompt leaderboard lists kept prompts with counts; call total shown; no blank-prompt rows |

## E. Run pipeline

| # | Item | Correct means |
|---|---|---|
| E1 | Render runs the graph | Every generative node ends `ready`; nodes show their output inline; button becomes "Up to date" |
| E2 | Progress is visible | Nodes pass through `running` before `ready` |
| E3 | Cost on the button | Button reads `Render N · ~$X` where N = stale generative nodes and X = `estimateCost` |
| E4 | Skip what is fresh | Re-render with nothing stale does nothing and the button is disabled |
| E5 | Real model call | **UNTESTABLE — no API key.** |
| E6 | Failure isolation | A failing node does not discard already-rendered siblings |

## F. Ledger (real ClickHouse)

| # | Item | Correct means |
|---|---|---|
| F1 | Schema created | `cinema.generations` exists with the 13 declared columns, MergeTree, `ORDER BY (graph_id, at)` |
| F2 | Every call is a row | A run of N generative nodes inserts exactly N rows |
| F3 | Prompt is recorded | `prompt` is non-empty on **every** row, including story and world |
| F4 | Seed / model / duration | `model` non-empty, `elapsed_ms` > 0, `ok = 1` |
| F5 | `takesFor` reads back | Inspector history matches the rows in the table for that node |
| F6 | `judge` writes | Keep sets `accepted = 1`; Discard sets `0`; addressed by exact `at`, and the mutation is accepted by a real server |
| F7 | `whatWorks` | Returns only kept, non-empty prompts, ranked; scoped to the film |
| F8 | `spentOn` | Equals the real row count for that film |
| F9 | Resilience | With ClickHouse stopped, a render still completes and the panel still renders; no unhandled rejection |

## G. Auto mode

| # | Item | Correct means |
|---|---|---|
| G1 | Toggle reflects state | Button switches Auto off ↔ Auto on and persists on the graph |
| G2 | Debounce | A pass starts ~2s after the last change, not immediately |
| G3 | Confirm above threshold | A pass of >4 nodes asks first, naming the node count and the spend |
| G4 | Ceiling refuses | With the ceiling below what the pass needs, nothing runs and the message names both numbers and how to proceed |
| G5 | Ledger down pauses | With ClickHouse stopped, auto mode refuses rather than treating spend as unknown-and-therefore-fine |

## H. Preflight and cut notes

| # | Item | Correct means |
|---|---|---|
| H1 | Preflight blocks a run | With a real problem, Render refuses and the reason is shown |
| H2 | New film is quiet | A brand-new empty film shows no problem chips |
| H3 | Scene index overflow | A scene asking for a shot the story lacks is reported with both numbers |
| H4 | Cut notes | Coverage/pacing/structure notes appear for a decomposed cut and are accurate |

## I. Delivery

| # | Item | Correct means |
|---|---|---|
| I1 | Shot list CSV | Downloads; header + one row per shot; timecode accumulates at project fps; dialogue with commas/quotes is escaped and round-trips |
| I2 | Disabled before decomposition | With no shots, the control refuses with a reason rather than downloading an empty file |

## J. Timeline commit

| # | Item | Correct means |
|---|---|---|
| J1 | Scenes become clips | "To timeline" imports the stills and places one clip per rendered scene on V1, in story order |
| J2 | Durations | Each clip's length = `durationSeconds × fps`; project duration = sum |
| J3 | Camera move | Each clip carries a Ken Burns move |
| J4 | Refuses when nothing rendered | Control is disabled / refuses with a reason |

## K. Connection check

| # | Item | Correct means |
|---|---|---|
| K1 | No-key path is honest | Test connection reports the missing key and states that a Gemini app subscription carries no API quota |
| K2 | Five real checks with a key | **UNTESTABLE — no API key.** |

## L. Cleanliness

| # | Item | Correct means |
|---|---|---|
| L1 | Console | Zero errors and zero unhandled rejections across every item above |
| L2 | Network | Zero failed requests; every ClickHouse call returns 200 |
| L3 | No mocks in the tested path | The stub provider is the only stand-in and is reached **only** because no API key exists; the ledger, persistence, downloads and timeline are all real |



---

# Round 2 — the surface added since round 1

Fourteen features shipped after the first pass. Executed against the **hosted
deployment** at https://web-production-d3da.up.railway.app in Claude in Chrome —
the real product, not a dev server — with the real Clickhouse behind it.

## M. Hosted deployment

| # | Item | Correct means |
|---|---|---|
| M1 | The link opens the app | `/` returns 200 and boots straight into the editor, not the Electron launcher splash |
| M2 | Health endpoint | `/healthz` returns 200 `ok` |
| M3 | Ledger proxy forwards | POST `/ch` with a SELECT against `generations` returns rows, 200 |
| M4 | Proxy refuses anything else | POST `/ch` with `DROP TABLE generations` returns 400 and is **not** forwarded; the table still exists afterwards |
| M5 | No credentials in the bundle | The served JS contains neither the Clickhouse user nor the password |
| M6 | Assets cache correctly | Hashed assets carry `immutable`; `index.html` carries `no-cache` |
| M7 | A missing file does not kill the server | Requesting a path that does not exist returns the app rather than a dead process, and `/healthz` still answers afterwards |

## N. Consistency panel

| # | Item | Correct means |
|---|---|---|
| N1 | Opens from the cast control and from ⌘K | Both routes show the same overlay |
| N2 | Summary counts truthfully | "N of M locked, carried across K rendered shots" matches the graph |
| N3 | Sheet and appearances | Each character shows its locked angles and every rendered frame it is in, captioned with that shot's framing |
| N4 | Seed shown | The seed the sheet was locked with appears beside the name |
| N5 | Claims nothing about likeness | No copy asserts two pictures match |
| N6 | Escape closes it | The overlay is not a trap |
| N7 | Empty film | With no cast, it says to add a Character rather than showing an empty grid |

## O. Ledger insights tab

| # | Item | Correct means |
|---|---|---|
| O1 | Five headline figures | calls, failed, median, p95, kept — each matching the table |
| O2 | Per-kind table | One row per node kind with calls, failures and median |
| O3 | Kept rate before judging | Shows "—", not 0% |
| O4 | Failure mix | Lists error kinds with counts when failures exist |
| O5 | Aggregates run in the database | The statements use quantileExact/countIf, not a row dump |
| O6 | Ledger unreachable | Says so rather than showing zeros |

## P. Run theatre

| # | Item | Correct means |
|---|---|---|
| P1 | Running node is visibly active | `data-status="running"` present during a pass |
| P2 | Progress fills | `--progress` climbs from 0 toward 1 and resets after |
| P3 | Live canvas | Nodes reach `ready` during the run, not only at the end |
| P4 | Reduced motion | With the media query on, no animation runs |

## Q. Command palette

| # | Item | Correct means |
|---|---|---|
| Q1 | ⌘K opens and closes | Toggles; Escape closes |
| Q2 | Ranking | "csv" puts Shot list first; "tidy" puts Tidy first |
| Q3 | Unavailable commands | Greyed, not runnable, and the reason replaces the group |
| Q4 | Enter runs the top hit | The command fires and the palette closes |
| Q5 | No match | Says nothing matches rather than showing an empty box |

## R. New graph behaviour

| # | Item | Correct means |
|---|---|---|
| R1 | Auto-wire from the palette | A Scene and a Character added from the palette leave zero preflight problems |
| R2 | Auto-wire never breaks a rule | No inferred edge is one `connectionError` would refuse |
| R3 | Per-node meters | A rendered generative node shows its elapsed time and seed |
| R4 | Seed lock | The same film rendered twice locks the same cast seed |
| R5 | Budget burn-down | The bar and counter both fall by exactly the calls made |

## S. New exports and readouts

| # | Item | Correct means |
|---|---|---|
| S1 | Explain the prompt | A rendered scene's prompt is broken into labelled clauses matching what was set |
| S2 | No invented attribution | A prompt nobody assembled is reported entirely as "Written" |
| S3 | Shot-size histogram | Counts by size, commonest first, only sizes present |
| S4 | Storyboard export | Downloads HTML with one figure per shot and frames inlined as data URIs |
| S5 | Storyboard escaping | Angle brackets in an action do not become markup |
| S6 | Storyboard before decomposition | The control refuses rather than producing an empty page |

## T. Persistence

| # | Item | Correct means |
|---|---|---|
| T1 | Film survives reload | A created film is present after a full reload |
| T2 | Recovered ready to run | Recovered nodes are `idle`, not claiming output they no longer hold |
| T3 | No image bytes in storage | The autosave payload contains no base64 sheet data |
| T4 | Film-only project recovers | A film with no clips on the timeline is still recovered |


---

# Results — final pass

Executed in a real Chromium against the running app, a real ClickHouse 24.8 in
Docker (container `rendr-clickhouse`, verified persistent across a stop/start),
and real file bytes captured at `URL.createObjectURL`.

**Claude in Chrome reported no connected browsers**, so the Browser pane was
used — a real Chromium driving the real product, not the code.

| # | Status | Note |
|---|---|---|
| A1 | PASS | titlebar `none`, one `.cshell__bar` |
| A2 | **FIXED → PASS** | menus were unreachable inside a film; slot declared, never rendered |
| A3 | **FIXED → PASS** | Notes and Cast glyphs were no-ops |
| A4 | PASS | budget 60 → 52 after 8 calls, read from the table |
| A5 | PASS | agent rail toggles 1280 → 0 → 1280 |
| A6 | PASS | Timeline icon closes the film, titlebar returns |
| A7 | **FIXED → PASS** | 5 dead tools wired; then toggles were borrowing the selected-tool invert — now exactly one inverted control |
| A8 | PASS | presence pill reads `0` |
| B1 | PASS | empty film, 0 nodes, typed name in the bar |
| B2 | PASS | badge, heading, subtitle, 4 cards, 2 actions |
| B3 | PASS | all four cards create story/character/scene/world |
| B4–B7 | PASS | 14/14/17/14 nodes, 0 preflight problems, laid out, distinct shot indices |
| B8 | PASS | 4374 bytes, `rendr-cinema/1`, 14 nodes, 17 edges, no base64 |
| B9 | PASS | round-trip to 14 nodes, all `idle` |
| B10 | PASS | exact messages for non-JSON, wrong format, zero nodes; no film created |
| C1 | PASS | 10-item picker at the pointer, creates that kind, no zoom |
| C2 | PASS | pane click dismisses without creating |
| C3 | PASS | palette adds one node, 17 edges held |
| C4 | PASS | click selects, pane click deselects |
| C5 | PASS | copies inbound wires only, arrives `idle` |
| C6/C7 | **UNTESTED** | React Flow's handle drag could not be driven from this harness; the rule is covered by unit tests but was not exercised through the real canvas |
| C8 | PASS | 14 nodes across 4 dependency columns |
| C9 | PASS | undo steps back and the canvas follows |
| C10 | PASS | covered by C5/C8 graph integrity |
| D1 | PASS | correct per-kind fields for character/world/story |
| D2 | PASS | 11/9/8/11/8 options |
| D3 | PASS | anamorphic + Tri-X appear verbatim in the recorded prompt |
| D4 | PASS | 5/5 scenes carry inferred size, lighting and negative clauses |
| D5 | PASS | character edit marks character+story+5 scenes; world and beats untouched |
| D6 | **FIXED → PASS** | history never refreshed after a re-run |
| D7 | PASS | Keep/Discard persist as `accepted` 1/0 |
| D8 | PASS | leaderboard ranks kept prompts, no blank rows |
| E1–E4 | PASS | all ready, running visible, `Render 8 · ~$0.24`, disabled when fresh |
| E5 | **UNTESTABLE** | no Gemini API key exists in this repo or environment |
| E6 | PASS | 7 succeeded, 1 failed, run continued |
| E7 | **FIXED → PASS** | "Re-run" silently skipped ready nodes |
| F1 | PASS | 13 columns, MergeTree, `ORDER BY (graph_id, at)`, created by the app |
| F2 | PASS | 8 rows for 8 calls |
| F3 | **FIXED → PASS** | failure rows were anonymous |
| F4 | PASS | model, elapsed_ms, ok all sound |
| F5 | PASS | inspector history matches the table |
| F6 | PASS | mutation `is_done=1`, exact row by timestamp |
| F7 | PASS | only kept, non-empty prompts, scoped to the film |
| F8 | PASS | equals the real row count |
| F9 | PASS | render completed with the container stopped, zero unhandled rejections |
| G1–G4 | PASS | toggle, debounce, confirm with real numbers, ceiling refusal |
| G5 | **FIXED → PASS** | unreachable ledger read as a *zero* spend, so auto mode rendered anyway |
| H1 | PASS | preflight refuses the run and names the reason |
| H2 | PASS | new film shows no problem chips |
| H3 | PASS | "asks for shot 9, but the story only produced 5" |
| H4 | PASS | "runs 18s against a 30s target — short by 40%" |
| I1 | PASS | correct header, comma values quoted, timecode accumulates to `00:00:07:15` |
| I2 | PASS | refuses with a reason rather than an empty file |
| J1–J3 | PASS | 5 clips in order, frames `[120,105,90,150,75]`, `scale`+`position` keyframes on each |
| J4 | PASS | disabled with nothing rendered |
| K1 | PASS | names both models, honest about the missing key |
| K2 | **UNTESTABLE** | needs an API key |
| L1 | PASS | zero page errors, zero unhandled rejections on a clean load |
| L2 | PASS | every ClickHouse request 200 OK |
| L3 | PASS with one exception | the stub provider is the only stand-in, reached solely because no key exists |

## Not defects

**React Flow container warning.** Fires only while the preview pane is hidden,
when the entire app measures 0×0. With the pane visible the container is
994×666 and no warning is emitted. No CSS addresses "the app has no size".

**Two reverted changes.** Repeated DOM counts said the canvas lost its edges
after a node was added. The screenshots never agreed and the model was intact
throughout; `querySelectorAll` on React Flow's SVG classes is unreliable in this
eval context. The changes that finding prompted were reverted.

**Stub timings.** `elapsed_ms` of 60007 for a 260ms sleep is the hidden pane
clamping timers, honestly recorded.
