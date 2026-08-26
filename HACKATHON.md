# Agentic Cinema — submission plan

<https://agentic-cinema.devpost.com/> · deadline **7 September 2026, 2pm PDT**

## What the brief actually requires

> A functional agent powered by Gemini and Google Cloud Agent Builder that
> integrates one partner's product or MCP to power a real media & entertainment
> workflow.

Non-negotiables, from the rules:

- **Google Cloud + Gemini Enterprise Agent Platform.** The code has to show
  "actual runtime use", not a dependency in a manifest.
- **One partner track**, chosen from IBM, Grafana, Parallel, Clickhouse or
  Replit — and the same "actual runtime use" bar applies to it.
- **A public repo under an open-source licence.** Already satisfied: this is
  AGPL-3.0, inherited from Recordly, with GPL-3.0 material from Palmier Pro.
  See NOTICE.md — that attribution has to survive whatever this becomes.
- **A hosted project URL.** Met: <https://web-production-d3da.up.railway.app>,
  two Railway services — the site, and a Clickhouse it reaches over the private
  network through a proxy that holds the credential.
- **A three-minute trailer on YouTube or Vimeo**, public, English or subtitled.
  The film is made — `node scripts/record-trailer.mjs` records the deployed app
  in a real browser, narrates it with speech generated locally, and burns the
  subtitles in. **Uploading it needs an account only you can sign into**, so
  that last step is yours.

Judged on technological implementation, design, potential impact, and quality
of the idea.

## Why this codebase is a head start

The brief is a media and entertainment workflow driven by an agent. That is
already what this is: 102 MCP tools over a real recorder and editor, with
narration, captions, zoom and export all driven by tool calls rather than by
hand. The agent surface exists; what changes is which model sits behind it and
what the workflow is for.

## The two open questions

**Hosted URL vs Electron.** The renderer is a web app already, and the parts
that need a desktop are recording, native cursor capture and the WebCodecs
export. A hosted build that accepts uploaded footage and does everything else
in the browser is plausible, but it is real work and it is the biggest risk in
the plan. Decide this before building anything else.

**Which partner track.** They are not equivalent for this codebase:

- *Clickhouse* — fits if the pitch is analytics over a media library: shot
  logs, render telemetry, what got cut and why, queried at scale.
- *Grafana* — fits a render farm or pipeline-health story, and is the easiest
  to demo live because dashboards film well.
- *Parallel* — fits research-driven edits, where an agent gathers source
  material before assembling anything.
- *Replit* — fits if the hosted requirement is solved by building there.
- *IBM* — widest surface, least obvious hook.

## What is deliberately not decided yet

The niche. This repo is a clone of the recorder so the work can start from
something that already runs end to end, not a commitment to keep every part of
it. Recording may well not be the product here — generating cinema is.

## Before trusting anything generative

```bash
GEMINI_API_KEY=... npm run preflight
```

Four checks against the real API, because every test in this repo runs against
a fake provider — which proves the sequencing and the parsing and proves
nothing about the request shape. The shape is exactly where this kind of
project breaks: the fields are guessable, and a wrong guess is *ignored* rather
than rejected, so a shot comes back the wrong size and nothing says why.

It checks that the text model answers, that structured output is honoured (the
story decomposition is unusable without it), that an image comes back, that
`aspect_ratio` actually changed the dimensions — measured off the PNG header,
not assumed — and that attaching an image as context is accepted, which is the
mechanism the entire character-consistency argument rests on.

It writes the images to `preflight-out/`. Look at them. A tick means the API
returned bytes, not that the bytes are any good.
