# 100 ideas, ranked

Scored impact × feasibility × fit. Fit matters most: this pitch is "the graph is
the film crew, and what comes out is a project rather than a file". Anything
that does not sharpen that is clutter, however clever.

Already built is excluded (shell, graph, runner, ledger, craft vocabulary,
structure notes, shot list, film import/export, auto mode + spend guard,
timeline commit, templates, take history, prompt leaderboard).

## Tier 1 — build first (high impact, real, on-pitch)

| # | Idea | Why it wins |
|---|---|---|
| 1 | **Hosted URL on Railway** | The last unmet submission requirement. Nothing else matters if judges cannot open it. |
| 2 | **Consistency proof panel** — one character's sheet across every scene, side by side | The entire technical thesis, made visible in one screen. |
| 3 | **Run theatre** — the graph animates as it runs: pulse on active node, edge flow, elapsed counter | The demo *is* watching agents work. Currently it just changes colour. |
| 4 | **ClickHouse insight panel** — spend over time, failure mix, model latency, kept-rate, all real SQL | Partner integration that is obviously past the minimum. |
| 5 | **Deterministic seed lock per film** | "Run it again, get the same film" is a sentence judges remember. |
| 6 | **Cost ceiling with a visible burn-down bar** | Makes the spend guard legible instead of invisible. |
| 7 | **Scene compare — two takes side by side, pick the keeper** | Turns the ledger's accept/reject into a real editorial act. |
| 8 | **Auto-wire on drop** — a node dropped near a compatible port connects itself | Removes the single most fiddly interaction in the app. |
| 9 | **Keyboard command palette (⌘K)** | Every judge tries ⌘K. Its absence reads as unfinished. |
| 10 | **Onboarding coach marks on first film** | Judges open it cold and have 30 seconds of patience. |

## Tier 2 — strong, buildable

| # | Idea |
|---|---|
| 11 | Continuity panel listing wardrobe/prop/time drift across shots |
| 12 | Storyboard export — contact sheet PNG of every shot with slugs |
| 13 | Animatic preview — play the cut in the canvas without the timeline |
| 14 | Per-node elapsed + cost badge on the card |
| 15 | Graph diff after an edit — what will re-render and what it costs |
| 16 | Character relationship edges (who appears with whom) |
| 17 | Shot-size histogram in the notes panel |
| 18 | "Explain this prompt" — breaks a scene prompt into its clauses |
| 19 | Retry with backoff on quota, surfaced in the UI |
| 20 | Partial re-render — pick which scenes to redo |
| 21 | Film runtime target slider with live shot-count feedback |
| 22 | Voice preview per character using the existing TTS |
| 23 | Narration track generated from the action lines |
| 24 | Ambience beds committed to the timeline as audio regions |
| 25 | Music mood tag written into the project notes |
| 26 | Aspect ratio switcher that re-crops the whole film |
| 27 | Look presets — one click applies a palette + stock + lighting |
| 28 | Reference image drag-and-drop straight onto a character |
| 29 | Cast sheet export (PDF-ish HTML) |
| 30 | Beat reordering by drag, re-decomposes downstream |

## Tier 3 — polish and motion

| # | Idea |
|---|---|
| 31 | Node cards animate in with a stagger on film open |
| 32 | Edge draw-on animation when a connection is made |
| 33 | Spring-based canvas pan/zoom |
| 34 | Status ring that sweeps as a node runs |
| 35 | Toast stack with motion and grouping |
| 36 | Skeleton shimmer on node thumbnails while rendering |
| 37 | Render button morphs into a progress bar |
| 38 | Empty state illustration that reacts to the pointer |
| 39 | Success chime + confetti-free "film complete" moment |
| 40 | Inspector fields animate on stale |
| 41 | Minimap with live node status colours |
| 42 | Focus mode — dim everything but the selected branch |
| 43 | Node hover lifts with shadow and shows a quick summary |
| 44 | Smooth number transitions on the budget counter |
| 45 | Dark/light theme for the shell |
| 46 | Reduced-motion support throughout |
| 47 | Canvas grid parallax on pan |
| 48 | Selection marquee styling |
| 49 | Drag ghost preview from the palette |
| 50 | Command palette with fuzzy match and recent actions |

## Tier 4 — production readiness

| # | Idea |
|---|---|
| 51 | Graph persistence across reload (currently in memory) |
| 52 | Autosave indicator with last-saved time |
| 53 | Crash-safe run recovery |
| 54 | Offline banner when the provider is unreachable |
| 55 | Rate-limit handling with a queue |
| 56 | Per-node error detail drawer |
| 57 | Ledger write retry surfaced as a badge |
| 58 | Schema migration guard for the ClickHouse table |
| 59 | Import validation with a per-node report |
| 60 | Duplicate-film guard on import |
| 61 | Undo history depth indicator |
| 62 | Keyboard shortcuts help sheet |
| 63 | Focus rings and full keyboard navigation |
| 64 | Screen-reader labels on every canvas node |
| 65 | Empty-library state in the media panel |
| 66 | Long-prompt truncation with expand |
| 67 | Node label collision handling |
| 68 | Very large graph performance (virtualisation) |
| 69 | Browser-unsupported notice |
| 70 | First-run environment check panel |

## Tier 5 — deeper track fit

| # | Idea |
|---|---|
| 71 | Multi-agent view: each node names the agent that ran it |
| 72 | Agent transcript per node (what was asked, what came back) |
| 73 | Continuity agent as a real graph node |
| 74 | Critic agent that scores a cut and suggests fixes |
| 75 | Prompt rewriter that learns from the leaderboard |
| 76 | Cross-film style memory in ClickHouse |
| 77 | A/B prompt experiment runner |
| 78 | Cost forecast for a whole film before starting |
| 79 | Model router — cheap model for text, better for hero shots |
| 80 | Veo swap-in behind the provider interface |
| 81 | Batch render queue with priorities |
| 82 | Shared film links (read-only) |
| 83 | Comment threads on scenes |
| 84 | Version history per film |
| 85 | Fork a film from any take |
| 86 | Export to EDL for a real NLE |
| 87 | Frame.io-style review mode |
| 88 | Render farm fan-out simulation |
| 89 | Live collaboration presence (the pill is already there) |
| 90 | Webhook on film complete |

## Tier 6 — long tail

| # | Idea |
|---|---|
| 91 | Localisation scaffolding |
| 92 | Telemetry opt-in |
| 93 | Sample films gallery |
| 94 | Guided tour replay |
| 95 | Print-friendly shot list |
| 96 | Character age/era consistency checks |
| 97 | Colour-blind safe status palette |
| 98 | Node search with highlight-in-place |
| 99 | Graph statistics panel |
| 100 | One-key demo reset for judging |

## Deliberately not built

**A blockchain feature.** This project has no on-chain surface and the track is
not a web3 track. Adding a contract, a wallet or a signed transaction here would
be visible padding that weakens the pitch rather than strengthening it. Skipped
on purpose, not for lack of time.
