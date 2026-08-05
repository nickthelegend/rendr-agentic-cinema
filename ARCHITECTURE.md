# Architecture

## The shape of the thing

A node graph where you assemble a cast, a world and a story, and the graph
compiles into scenes that land on a real editable timeline.

```
 ┌───────────┐   ┌───────────┐   ┌───────────┐
 │ Reference │   │  Trait    │   │  Look     │      ingredients
 └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
       └───────────────┼───────────────┘
                 ┌─────▼─────┐
                 │ CHARACTER │  ← identity: a locked face + a sheet of angles
                 └─────┬─────┘
                       │
 ┌───────────┐   ┌─────▼─────┐   ┌───────────┐
 │  World    ├──►│   STORY   │◄──┤  Beat     │      the middle
 └───────────┘   └─────┬─────┘   └───────────┘
                       │  decomposes into
      ┌────────────────┼────────────────┐
 ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
 │ SCENE 1 │      │ SCENE 2 │      │ SCENE 3 │      output
 └────┬────┘      └────┬────┘      └────┬────┘
      └────────────────┼────────────────┘
                 ┌─────▼─────┐
                 │ TIMELINE  │  ← the existing editor, unchanged
                 └───────────┘
```

## Why the timeline tab stays

This is the difference between a demo and a product, and it is the strongest
thing this codebase has.

Every other AI video tool hands you a clip. When the third scene is wrong, you
regenerate and hope. Here, scenes land as clips on a timeline that already has
101 MCP tools over it — trim, reorder, grade, caption, narrate, export. The
graph produces a *project*, not a file.

It also means the generative half never has to be perfect. A scene that came
out nearly right is a clip you fix in four seconds, not a prompt you rewrite
for ten minutes.

## What I would change about the plan

### 1. The hard problem is consistency, not generation

Generating one shot of a character is a single API call. Generating *eleven
shots of the same character* is the problem nobody has solved well, and it is
what separates a hackathon toy from something people would use.

So the CHARACTER node is not "a prompt that makes a picture". It is an identity
that gets locked once and then referenced:

- generate or upload a reference image
- derive a **character sheet** — the same face from several angles, in a few
  lightings, with a consistent wardrobe
- store the sheet, a seed, and a canonical description
- every scene that references this character passes the sheet as image context

That is the centrepiece. The graph exists to make that binding visible and
editable.

### 2. The partner integration is missing, and it is mandatory

The brief requires runtime use of Google Cloud **and** one partner from IBM,
Grafana, Parallel, Clickhouse or Replit. The plan as described has no partner
in it at all. This is not a nice-to-have; a submission without it does not
qualify.

The one that fits this design without being bolted on is **Clickhouse**, as
the generation ledger: every node run, prompt, seed, model, cost, latency and
accept/reject decision written as a row. That earns its place because it makes
two features possible that are otherwise hand-wavy —

- *what did we already try* — dedupe and recall across a long session, so
  regenerating a scene shows you the four takes you already rejected
- *which prompts actually work* — query across runs for the phrasing and seeds
  that produced accepted shots, and feed that back into prompt generation

**Grafana** is the alternative if the pitch leans on a render farm, and it
films better. Pick one and wire it properly; do not try to use both.

### 3. Auto mode needs a real decomposition step

"Story becomes scenes" is where this works or does not. It cannot be one
prompt that emits a JSON array, because a story has continuity constraints a
single call will drop — who is in frame, what time of day it is, what happened
in the previous shot.

Decomposition is its own agent pass with a structured contract: beat →
scene spec, where a scene spec carries characters present, location, time,
camera, action, and a link back to the beat it came from. Continuity is checked
across the set *after* generation, not hoped for during it.

### 4. Hosted URL

Still the open risk, inherited from the fork. The graph and the generative half
are pure web; recording and native cursor capture are not. The likely answer is
a hosted build with recording absent rather than broken.

## Recording: hidden, not deleted

Deleting it would be a week of untangling for no benefit, and it is genuinely
useful for reference footage.

Instead there is a single capability flag. Recording panels, the record button,
and the recording MCP tools are gated behind it; in the cinema build it is off,
and the code stays compiled and tested. This keeps `git diff` against upstream
Rendr small enough to keep pulling fixes.

```ts
// src/config/capabilities.ts
export const CAPABILITIES = {
  recording: false,   // cinema build: the camera is not the point
  generation: true,
  timeline: true,
};
```

## Is this the right architecture for this hackathon?

Yes, with the three changes above. It scores on all four criteria:

- **Technological implementation** — a real agent network, not one prompt in a
  loop. Gemini for story, prompts and continuity; Veo for shots; Clickhouse as
  the memory that makes iteration cheap.
- **Design** — a node graph is the most filmable interface there is, and the
  brief is literally about agent networks. It shows the architecture rather
  than describing it.
- **Potential impact** — character consistency plus an editable result is the
  gap between AI video demos and AI video work.
- **Quality of the idea** — "the graph is the film crew" is a clean pitch, and
  the timeline underneath it is the part nobody else has.

The risk is scope. The graph is seductive and easy to keep adding nodes to
while the thing that actually wins — consistent characters across scenes,
landing on a timeline — stays half done. Build the spine first: one character,
one story, three scenes, on the timeline. Everything else is decoration on top
of a thing that works.
