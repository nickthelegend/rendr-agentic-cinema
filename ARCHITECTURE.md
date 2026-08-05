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

---

## Decisions, locked

**Partner: Clickhouse.** Every node run is a row — prompt, seed, model, cost,
latency, accepted or rejected. Chosen over Parallel because it is the only
track where the integration is a feature the user sees rather than plumbing:
the rejected-takes gallery and the prompt leaderboard both fall straight out of
the ledger, and both are queries, not decoration. The rules require the partner
"imported and called in code, not just named in the README", and a ledger is
called on every single run.

**Character sheet: four angles** — front, three-quarter, profile, back. Enough
for the model to hold identity across most shot types, cheap enough to
regenerate freely while a cast is still being iterated on.

**Auto mode: fully automatic.** A story edit re-derives and re-renders
downstream without asking. `descendants()` already computes exactly that set.

> **Guard this one.** Fully automatic plus a paid video model means every
> keystroke in a story node can trigger paid renders. Before auto mode touches
> anything that costs money it needs, at minimum: a debounce on text edits so a
> half-typed sentence never triggers a pass, a per-session spend ceiling read
> from the ledger, and a confirm above a threshold. Text re-derivation is cheap
> and can be truly instant; picture generation is where the money is. Build the
> guard with the feature, not after the first surprising bill.

**Models.** Gemini for story, prompts and continuity; Gemini image
(Nano Banana) for sheets and shots, chosen for holding a subject across
generations.

### On Veo, precisely

A Google AI Pro plan — bought directly or bundled through Jio — *does* include
Veo. In the Gemini app and in Flow. That is genuine access and it is not
nothing: hero shots can be made there by hand and imported as reference.

What a consumer plan does not include is **API quota**. The subscription and
the API are separately billed products, and no code here can call the former.
For the graph to render a shot in code it needs either the free Gemini API tier
(text and image, no Veo) or pay-as-you-go billing (Veo, charged per second).

So scenes render as generated stills with a camera move on the timeline, behind
an interface that takes a video provider. The consistency thesis — the same
face across eleven shots — is provable entirely in stills, and the timeline
already animates them. Veo swaps in without the graph changing when billing
exists.

This also keeps the submission demo off a quota that could run out an hour
before the deadline.

---

## Known, found by driving the app

Kept here rather than in a commit message, because these are open.

**The palette still does not fit.** Two columns took it from three visible
node kinds to four, and there are eleven. Character, Story and Scene — the
three a film cannot exist without — are below the fold in a short editor pane
and reachable only by a scroll nobody would think to try. Denser type will not
close a gap this size; the palette probably wants to be a wrapping strip along
the top of the canvas rather than a left column, or the groups want collapsing.

**Node cards left the accessibility tree.** They appeared as anonymous `group`
entries before the aria-label was added and do not appear at all after it,
which suggests the label went somewhere the tree does not read. A canvas whose
nodes cannot be found by name is a canvas that cannot be tested without pixel
coordinates.

**Reloading loses the graph.** Cinema graphs live in memory until the project
is saved, so a refresh during development starts over. Fine for a save-backed
app, surprising while iterating.

**Nothing has called the real API.** Every generative path is exercised against
the stub. `npm run preflight` is the check that closes this, and it needs a key.
