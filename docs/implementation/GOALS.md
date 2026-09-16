# Goals on `/plans` — board, map, horizon, review, console, vision boards

Everything about the goal object and the views built on it: the Dream board, the Goal map,
the optional horizon and what it actually changes, the review pass and the live console, and
vision boards.

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

---

## Dream board — `/plans` 🌟

Status: ✅ shipped (2026-09-12). The `/plans` toolbar switches between three views
of **one** store: `🎯 Goals` (the list), `🌟 Board` (the same goals as a visual
board), and `📚 Library` (plans/actions/notes).


### What it is, and the one decision behind it

A dream board is a wall of aspirations you can look at. The reason it lives on
`/plans` rather than on its own page is that **a dream is a goal** — it rides the
canonical workspace goal store (`kind='goal'`) with three extra optional
attributes:

| Attribute | Purpose | Cap |
|---|---|---|
| `vision` | The user's own words, shown on the tile | 280 chars |
| `cover` | A preset key (`health`) **or** an image URL (uploaded / generated / pasted) | 600 chars |
| `targetDate` | A bare `YYYY-MM-DD`, read through the planner's local-day parser | 10 chars |

One string for both cover kinds is deliberate: the tile only ever needs *a*
picture, and two fields could disagree with no rule for which wins.
`workspaceController.resolveGoalField` makes these **explicitly clearable** (send
`''`) while still carrying them forward when a body doesn't mention them — the
write is a whole-item Put, so without that a status update from the addon would
silently wipe someone's cover.

That tie-in is the whole feature: every tile can say **🤖 Enlist agent**, and the
run's progress shows back up on the tile. A dream board you can't act on is a
poster; this one is a to-do list with pictures.


### Covers — four ways, in the order people use them

1. **Presets** (12: home, work, money, health, travel, learning, people, creative,
   play, calm, adventure, milestone). Real artwork, not icon tiles —
   `FRONTEND_UI_STANDARD.md` §5 is explicit about "imagery over emoji". Generated
   by `backend/scripts/generate-dream-art.js` (Bedrock, PNG → JPG via sharp) into
   `frontend/src/assets/art/dream-*.jpg`. **The script's `key` list and
   `frontend/src/pages/Simple/Plans/dreamCovers.js` are one list** — a key renamed
   in one and not the other leaves a goal pointing at art that isn't there.
2. **Upload** (`POST /api/data/upload-cover`) — see `STATIC_ASSETS_AND_IMAGE_GENERATION.md` → *the eleventh audit pass* for why this is *not*
   the presigned path. Resized client-side to a 1600px JPEG first.
3. **Paste a URL** — also how an image `/net` generated for you gets onto a board.
4. **✨ Make one from my words** — `dreamCoverPrompt()` wraps the goal's title +
   vision in the house art direction and calls the existing metered
   `/api/data/image/generate`, then uploads the result.

A goal that has never chosen a cover still gets a tile: `coverSource()` borrows one
**deterministically from the goal's slug**, so a board is never a wall of
placeholders and a goal keeps the same picture across reloads and devices.


### Still open

- ⬜ Replacing a cover, or deleting a goal, leaves the old S3 object behind — see `STATIC_ASSETS_AND_IMAGE_GENERATION.md` → *the eleventh audit pass*.
- ⬜ A bucket CORS rule, so the presigned path works in a browser again and larger
  uploads can skip the API.
- ⬜ `/plans` in the addon dashboard, and the surface switcher's board entry, if the
  board turns out to be where people actually live.

---


## Goal map — `/plans` 🗺️

The fourth tab on `/plans`: the same goals, drawn as a node graph. The AI groups
them into categories and sequences them by expected dependency. It is
**generated, stored, then re-generated on demand** — the view renders a saved
snapshot, and one button is the only thing that spends a credit.


### Two axes are the AI's; everything else is ours

| Axis | Comes from | Renders as |
| --- | --- | --- |
| Category | `categories[]` — capped at 8, `other` always last | a **lane**, left → right **in the AI's order**, with a hue, label and count |
| Sequence | `order` on each node | the node's position down its lane |
| Dependency | `dependsOn[]` — capped at 3 per node | an **arrow from the prerequisite to the dependent** |

No coordinates come back from the model, and the view is **not** force-directed: a
lane's horizontal position has to mean something, and "the model put this group
before that one" is something. Everything geometric — lane width, node size, wrap
threshold, edge anchors — is in `frontend/src/pages/Simple/Plans/goalMapUtils.js`,
a pure module with 18 unit tests, so a lane/edge regression is testable without
mounting an SVG.

Edges are easy to get backwards: `dependsOn` lists what comes first, so the arrow
is drawn **from** `dependsOn[i]` **to** the node that names it — the direction the
work flows — and it enters the dependent. Same-lane links leave the bottom of the
prerequisite and enter the top of the dependent; a link whose target lane sits to
the left is anchored on the facing edges.


### Backend contract

- `POST /api/data/csimple/goal-map` (`protect, llmLimiter, sanitizeInput`) →
  `generateGoalMap` in `workspaceController.js`. **The goals are read
  server-side** from the workspace store — the browser never posts its goal list,
  and it cannot ask for a map of somebody else's goals.
- `backend/services/goalMap.js` (new, pure) owns every rule that makes an LLM
  answer safe to render: `selectGoalsForMap` (rank active → blocked → paused →
  failed → done, then priority, then recency, capped at 120 so a 400-goal account
  still gets an answer), `buildGoalMapPrompt`, and `normalizeGoalMap` — which drops
  unknown slugs, first-placement-wins on duplicates, derives categories a node
  names but the model never declared, folds overflow and unmapped goals into
  `other` (added **on top of** the cap), filters self/duplicate/unknown
  `dependsOn`, and caps edges at 3. 15 unit tests.
- The result is **stored before it is returned**, as a workspace item of the new
  kind `map` (slug `goal-map`, one per user, 64KB cap) — so the view opens
  instantly next visit and `GET /csimple/workspace/map/goal-map` reads it back
  through the ordinary workspace route. The write is a server-side `Put`, not the
  generic `upsertWorkspaceItem`: there is no client body to validate, and a
  rejected map write must not be able to fail a request whose Bedrock call has
  already been paid for. A failed write still returns the map (with
  `meta.saved: false`).
- Credits: `_enforceLlmCreditGate` before the call (402 → `requiresUpgrade` +
  `upgradeUrl: '/pricing'`), `_trackAgentLlmUsage` after. No goals at all → 200
  with `map: null` and **nothing spent**.


### One button, and a snapshot that admits its age

`Generate map` becomes `Update map` once anything is stored. A map is a
photograph of the goal list at one moment, so the view **says when it is out of
date** rather than pretending: `goalMapDrift()` (unit-tested) compares the current
goals against the nodes and the line reads e.g. *"⚠️ 2 new goals since this map
was made · 1 goal in this map is gone — update to rebuild."* A node whose goal no
longer exists is drawn dimmed, dashed and **not** clickable (the grouping is still
information). With no goals left at all, the stored map is hidden entirely — it
would be every node "gone" sitting next to the empty state contradicting it — and
the button is disabled with `title="Add a goal first"`.


### Category hue vs status signal

A lane's hue is **category identity**; the page's pink/orange/red already mean
blocked/paused/failed (`Plans.css`). Two of the eight hues necessarily sit near
those signals, so the two never share a channel: a lane hue is only ever a 3px
rail, a 7% wash and a legend swatch, chroma is deliberately low (0.105 light /
0.09 dark, inside sRGB at that lightness so the greens don't clamp), and the
**loudest mark on a node is its status glyph** — inked from `--badge-tone` with
the same mapping the goal cards use (● active, ■ blocked, ‖ paused, ✓ done, ✕
failed). Consecutive lanes take hues from opposite sides of the wheel so
neighbours never look alike.

Other rendering rules worth keeping: lanes are clipped (`clipPath`, one per lane)
so an unusually wide title is cut at the lane's edge instead of crossing into the
next group; the canvas scrolls **inside** the panel (`max-height: 68vh`, themed
thin scrollbar) and is keyboard-focusable, because a scroll container with no
focusable content is a trap; nodes are `<g role="button" tabindex="0">` with
Enter/Space, a `title` tooltip carrying the untruncated title, and a focus ring;
a lane with no nodes draws no lane at all.


### Verified

- **The real path ran end to end on the guest account**: one press of *Generate
  map* returned `1 goal · 1 group · no links yet · generated Sep 15, 03:20 PM`,
  the stored item read back through `GET /workspace/map/goal-map`, and the graph
  rendered from that stored JSON. The row was then deleted (`?hard=1`), leaving
  the shared guest account as it was found.
- **The dense case was driven with mocked data**, not eyeballed: 15 goals / 5
  lanes / 11 links → `5` lanes, `15` nodes, `11` edges, `5` legend items, and the
  drift line reported both directions at once ("1 new goal … 1 goal … is gone").
- **No page overflow at 320 / 414 / 480 / 600 / 768 / 1024 / 1400 / 1920px**
  (`document.scrollingElement.scrollWidth - clientWidth === 0` at every width),
  the tab row never overflows at any of them (`plans-switch` breaks out of its
  stadium pill at 520px — four tabs need ~400px and the threshold moved up from
  400 when Map joined), and the canvas scrolls horizontally inside the panel at
  all of them.
- **Both themes measured, not assumed**: lane/node/glyph fills resolve to the
  intended oklch values in light and dark; the only unthemed thing found (a white
  scrollbar slab in dark mode) was fixed by theming the canvas scrollbar.
- **Interaction**: hover changes the node fill; keyboard `Tab` into the graph
  lands on a node with `:focus-visible` matching and a 2px accent ring; both Enter
  and click navigate to `/plans/goal/<slug>`; a 402 renders `role="alert"` with
  the server's message and a `/pricing` link **with the previous map still on
  screen**.
- Tests: `goalMapUtils.test.js` 18/18, `GoalMap.test.jsx` 8/8,
  `backend/__tests__/unit/goalMap.test.js` 15/15, and the whole `Plans` folder
  75/75. `vite build` clean (the chunk-size warning predates this change).
- The truncation cap was **measured**: a 26-character label ends ~32px short of
  the node's right edge at 12.5px semi-bold, and an all-`W` run still overflows —
  which is what the per-lane clip path is for, since measuring real glyph runs per
  node would mean a layout pass per render.

---


## Goal horizon — one field, four surfaces

A dream is not a kind of goal. It is a goal with a very long horizon, and the
horizon is optional on **every** goal. That single change is what lets the same
record be grouped sensibly ("retire at 60" does not belong next to "pick up
groceries"), be filtered in the marketplace, and be handed to an agent that knows
the difference between an aim and a chore.

`horizon` ∈ `week | quarter | year | life`, ordered short → long, and **unset is a
real state**: nothing behaves differently while it is absent, which is why every
goal written before this existed keeps working untouched.


### The rule that makes it more than a label

`year` and `life` are **containers**. A goal that far out cannot be finished by a
loop that runs for an afternoon, and it is usually gated on resources or events
(money, a date, another person) rather than on more effort. So:

| Where | Behaviour |
| --- | --- |
| `getNextGoal` (the addon's idle loop) | nearest horizon first, then priority. A container is only picked when nothing nearer is waiting; a goal with **no** horizon ranks as actionable, so nothing is demoted for predating the field. |
| `goalAgentService` (a run) | a container gets a planning prompt: call `propose_plan`, then `create_goal` for the nearest one or two steps (`horizon` `week`/`quarter`, parented to the container), then work the first step. Explicitly told **not** to try to finish the goal. |
| `simple-addon` `agent-loop` | the same instruction in the desktop agent's own prompt, plus `goal_create` accepts a horizon. |
| `workspaceContext` (`/net`) | ACTIVE GOALS are printed **grouped by horizon**, nearest first. Containers get one line each — context for what the user is aiming at, not a queue — and the model is told they are containers. |
| `/net` goal thread | `buildGoalKickoffMessage` adds a "plan it first" preamble for containers. |
| `/plans`, `GoalDetail` | a card shows the horizon as a tag; a container's detail page says what enlisting will actually do before the button is pressed. |
| `/market` | a published goal carries its horizon; the goals list can be filtered by it ("something I can finish this week"), and an install inherits it. |

`create_goal` is new: the backend run could not previously write a goal, so a
container run had nothing to split *into*. It is capped at 5 goals per run, always
parents to the goal being worked on, and marks `createdBy: 'agent'`.


### What the reframe retired

The Dream board is now the **Life-horizon view** of the same goals (`🌟 Dreams`,
counted like every other tab). Nothing about the record differs, so
`vision`/`cover`/`targetDate` — the fields the board is built around — are simply
available on any goal, and `GoalDetail` no longer drops them. The word "scope"
was freed up for the field it actually described: the run-instructions textarea
on `GoalDetail` is now "Instructions for this run", because it is passed to one
run and never stored.

Vocabulary lives in one place, `frontend/src/constants/goalHorizons.js`, mirrored
by the backend's `GOAL_HORIZONS` (`services/workspaceGoals.js`). The frontend copy
exists because two pages need it, and a second copy of a four-value vocabulary is
how the two drift apart.


### The trap this had to survive

Both goal writers `Put` the **whole** item with explicit carry-forward, so a field
not carried forward is *destroyed* by the next partial write — and there are
partial writers everywhere (`handleStatusChange`, the addon's `goal_update`,
`save_goal` from /net, marketplace install). `horizon` is carried in both
(`resolveGoalField` in the controller, the spread in `workspaceGoals.upsertGoal`),
and `workspaceGoalHorizon.test.js` covers persist → unrelated write → explicit
clear → and the unknown-value case, where an unrecognised horizon is **dropped**
rather than stored (a goal in a bucket no UI knows about is invisible).

Two pre-existing bugs on the same path were fixed while in there: `listWorkspace`
accepted a `status` filter and **silently ignored it** (so the addon's
`listGoals({ status: 'active' })` received every goal ever written, finished ones
included), and `upsertGoal` dropped `tags` whenever a caller omitted them.


### Verified

- **The grouping is the point, and it was driven**: nine goals across all five
  buckets render as This week → This quarter → No horizon → This year → Life, with
  the horizon tag beside priority on every card that claimed one and none on the
  card that didn't. Switching the axis to Status gives the old view back, and the
  choice survives a reload (`localStorage['plansGroupBy']`).
- **Folds are namespaced**: folding "Life" stores `h:life` next to the goals
  view's `active`, so the two axes can't share a fold.
- **The form writes what it says**: picking "This quarter" sends
  `horizon: 'quarter'`; picking "No horizon" sends `horizon: ''` — the explicit
  clear the backend treats as authoritative.
- **Search reaches the vision line**: "anyone else" matches a goal whose only
  mention of it is in `vision` (it never did before).
- **`GoalDetail`** now shows the horizon badge (with its hint as a tooltip), the
  vision as a quote, "📅 Aiming at …" from `targetDate`, and the container note —
  all four of which it previously dropped.
- **`/market`** offers the horizon filter on the Goals tab only, and the request
  was observed going out as `…&horizon=life`. ⚠️ The chip on a market **card** was
  not seen rendered against a live shared goal: the guest account has none
  published, and route-mocking the market list did not take in this session
  (the same-origin request was measurable, but not interceptable). It is the same
  four lines of markup and the same CSS vocabulary as the /plans tag, which was
  verified visually.
- Tests: `workspaceGoalHorizon.test.js` 18/18 (validation, carry-forward,
  next-goal ordering, the service's own writes), backend unit suite 722/722,
  Plans folder 155/155 including `plansUtils` horizon helpers and the grouping
  preference, `goalChat` 27/27, addon unit suite green, `vite build` clean.
- **Both themes measured, 320→1920px**: no page overflow at any width, the tab
  row never overflows with four tabs, and the long-horizon marker is a **fill**,
  not hue-shifted ink — the `neutral` scheme has zero chroma by design, so the
  `oklch(from …)` treatment the other tags use resolves to `--text-color` there
  and the chip would have been invisible.

---


## Working on goals — the review pass, and the live console

Two panels on `/simple`, both about *the loop's own work* rather than about
configuring it:

| Panel | Question it answers |
| --- | --- |
| **🧭 Work on my goals** | "My goal list is a mess — what should change about it?" |
| **Live** | "What is it doing *right now*?" |

Both sit directly under the loop panel, full width, in their own `.sd-grid` rows:
the console first (it is what the ▶ Start button above is for), the review second.


### The review pass

One pass over the goal list proposes **changes to the list** — not advice:

| Kind | What it proposes | Which write it becomes |
| --- | --- | --- |
| `horizon` | a goal aimed at the wrong horizon | `horizon` on that goal |
| `split` | a long aim with nothing under it → 1–4 children (`week`/`quarter`) | one goal per child, parented |
| `plan` | a goal with nothing to work from → up to 8 ordered steps | a `plan` memory item, linked to the goal |
| `new-goal` | a goal that follows from what already exists | a new goal (`createdBy: 'agent'`) |

Plus `lessons`: observations that are **not** changes. One *Keep* button writes a
real `kind='lesson'` workspace item — the same store the agent's own critic writes
to — so what the pass noticed outlives the panel instead of sitting in it.

The pass is the **backend's** (`services/goalReview.js` + `POST
/csimple/goal-review`): it needs the whole list and a model, not this PC. It is
**stored** (`review` / `goal-review`, 6h TTL) so the panel opens on the last
result and re-running is a deliberate act.

**Proposing and writing are separate, and that is what makes the rest safe.**
Staging is free; one button applies the batch in a single request
(`POST /csimple/goal-review/apply`), server-side, through
`planReviewApplication` → `upsertGoal` / `createMemoryItem`. A review the user
did not ask for therefore *cannot* change anything by itself.

Two rules the prompt states explicitly, because they are the ones a model gets
wrong: only propose a change the goal's *own words* support, and never split a
goal that already has children.

The prompt is also told to re-share only what it can defend: `why` is required on
every proposal, and the panel shows it above the patch, because "Set horizon to
quarter" without a reason is a diff with no argument.


### The loop runs it too

"Review first, then work":

- `POST /api/agent/start` fires `requestGoalReview(false)` (fire-and-forget)
  before the loop is built, so the pass the user did not press still happens — and
  is still only *proposed*.
- `_runMetaReflection()` fires the same call every `META_EVERY_ACTIONS` (50)
  steps; the 6h TTL is what stops a long run from spending a credit per cycle.

Both are best-effort: the addon carries the 402 (`requiresUpgrade`) instead of
throwing, so a credit-exhausted account loses the review, not the loop.


### The console

`AgentTerminal.jsx` streams the event vocabulary the addon already emits
(`tool.start/end`, `agent.stage/step/message/reply/meta/skill-draft/stopped`,
`goal.done/failed/blocked/stalled`, `approval.*`, `permissions.changed`,
`skill.run`) and renders it as an LLM-harness log: clock, glyph, text, detail,
with `running`/`ok`/`error`/`note` colour on the glyph column.

Named SSE events do **not** reach `onmessage`, so the type list is explicit and
must stay in step with the addon's `events.js`. An unknown type still renders
(the bare type) — a silent gap in the log is worse than an ugly line.

**Two sources, one on screen at a time.** The local stream is instant and has
tool-level detail; the cloud run (`goal-agent/status` → `agent.steps`, polled at
2s) is always available but is flushed **once per LLM round**, so it arrives in
jumps. They are deliberately *not* merged: the addon mirrors its steps to the
cloud when it has a goal to attach them to, so merging prints every tool twice in
two shapes. The header chip names the source (`Local agent` / `Cloud run` /
`Idle` / `No agent`), and the console prefers local only while local is live
(`addonConnected && running`).

Honest limitation, stated in a tooltip rather than hidden: the cloud view updates
in jumps. It is a slower, coarser view of the *same* run.

Reading behaviour: follows the newest line by default, re-engages following when
the user scrolls back to the bottom (a toggle you have to remember to turn off is
a toggle that stays wrong), caps at 400 lines, and never uses `aria-live="assertive"`
— `role="log"` with `polite` so a running loop does not fight a screen reader.


### Verified

- **The whole path ran end to end on the guest account**: one press returned
  `Reviewed just now · 1 goals · nothing changes until you apply it` with a
  re-scope (`No horizon → This quarter`, with the reason above it), a 5-step plan,
  and one observation; staging 2 of them produced
  `2 staged — 1 goal re-scoped, 1 goal created`; *Apply* returned
  `Applied — 1 plan created.`, the badge dropped 2 → 1 (applied proposals stop
  being offered), `onGoalsChanged` refreshed the goals panel, and the plan was
  found in the memory store linked to the goal. The created plan and the stored
  review were then deleted (`?hard=1`), leaving the shared guest account as it was
  found.
- **The console was driven with the real addon, not a fixture**: switching the
  mode to *Suggest* started the listener, and 38 lines landed live —
  `stage → picking a goal (outer loop)`, `stage → observing (inner loop)`,
  `step 1..4`, `▶ screen_capture`, `✓ screen_capture · 395ms`,
  `■ stopped — user requested stop` — with the chip reading `Local agent`, the
  footer `Streaming live from the desktop agent.`, and the view auto-scrolled to
  the newest line. The addon was then stopped and the mode returned to *Assist*.
- **A copy bug the live run found**: the batch footer said *"1 staged — creates 1
  goal"* for a **re-scope**, which creates nothing. `batchSummary` now counts
  re-scopes separately and `batchSummaryText` builds the sentence
  (`1 goal re-scoped, 1 goal created`); `batchSummary` also counts `split` as
  created goals, because a split does create its children.
- **No page overflow at 320 / 375 / 480 / 768 / 1024 / 1440 / 1920px**
  (`documentElement.scrollWidth - clientWidth === 0` at every width), and neither
  panel's subtree ever crosses the viewport edge.
- **Both themes measured**: the glyph palette stays legible on the light
  `glass-sunken-strong` background (the accent hues darken rather than wash out),
  and `prefers-reduced-motion: reduce` resolves the live-dot pulse to
  `animation-name: none` (1.6s `infinite` otherwise).
- Tests: `goalReview.test.js` (backend) 22/22, `agentTerminalUtils.test.js` +
  `goalReviewUtils.test.js` 27/27, `GoalReviewPanel.test.jsx` 10/10,
  `AgentTerminal.test.jsx` 7/7 — 45/45 in `frontend/src/pages/Simple/Simple`.
  `vite build` clean. Both routes reachable (401 without a token).


### The console says what it is doing (2026-09-15)

*The console* streamed the *shape* of a run — stages, step numbers, tool names,
durations. Driven against the real addon, that turned out to be a log nobody can
read: seventeen `▶ screen_capture` lines in a row, with nothing on screen saying
which goal was being pursued, what the agent thought it was looking at, or what
any call had returned. The loop knew all three and published none of them.

| Fact | Event | Cadence |
| --- | --- | --- |
| which goal the run is on | `agent.goal` | once per run (and again if the goal changes) |
| what it read before deciding | `agent.observe` | per step |
| the model's own words | `agent.thought` | per deciding step |

`agent.thought` is the line the console was actually missing — the model's text
alongside its tool call is its *reason*, and the loop already had it in hand
(`plan()` set it on the action and dropped it). The `<<GOAL_DONE>>` sentinel is
stripped before publishing (it is a protocol token, not reasoning) and `willCall`
names what is about to run, so a line reads
`✻ The dialog is open, so I will save. · → uia_invoke`. `tool.end` gained
`resultPreview`, and `agent.step` gained `maxSteps` so a step reads `step 7/60`.

The announcement is also kept **outside** the log: the goal line scrolls away
within a couple of dozen steps, so the panel's footer carries
`Working on Retire at 60` for as long as the run lasts. "What is it doing" must
not depend on a line still being in view.

**How to read a run** — every line above, the tick counter, the exit conditions
and the traps (`stage → picking a goal` is published on *every* tick and picks
nothing; a trailing `stage → idle` means the run has **ended**, not that it is
waiting) are decoded in [`Simple_Loop_Behaviour.md`](Simple_Loop_Behaviour.md) §5.
⚠️ Note §6.1 there: `agent.goal` / `agent.observe` / `agent.thought` landed in
`fc87533` (2026-09-15), which is in **no released build** — an addon older than
that emits only stage/step/tool lines, which is why a driven run can still look
unexplained even though the console can render the richer vocabulary.

#### The rule the events had to obey first

`tool-registry` published `safeArgs` **verbatim**, so a `text_type` step put
whatever the user typed onto every SSE subscriber — including the cloud relay —
while `previewArgs`'s own comment claimed the addon stripped exactly those
(`text_type`, `clipboard_write`, `audio_speak`). `approval.pending` did the same,
with a comment asserting the opposite. The claim was aspirational; nothing
implemented it.

`server/automation/event-detail.js` is now the single place that decides what an
event may say, and the distinction it encodes is the important part: **an event is
a report, the action log is the record.**

| Value | In an event |
| --- | --- |
| args/result of a PII tool | **absent**, not redacted — a redaction still tells you the length |
| image-shaped keys (`image`, `frame`, `screenshot`, `base64`, …) | dropped wherever they appear |
| any string over 2 kB | dropped, whatever key it hides under (a key list can't be complete; size can be) |
| everything else | clipped: 120 per leaf, 400 per arg set, 240 per result |

`ctx.addAction` still writes the arguments verbatim (that is what the workspace
action log is for), and the approval *queue* still holds them, because the
permission center's job is to show the user what they are being asked to approve
— only the event is redacted.

**Verified:** addon suite green (`agent-loop.test.js` 40/40 including two new
console cases, `agent-loop.baseline.test.js` 7/7, new `event-detail.test.js`
29/29, whole `test:unit` chain completes), frontend console suites 28/28 and the
`Simple/Simple` folder 51/51, `vite build` clean. ⚠️ Driven by tests and a build,
**not** yet against the live addon: the redaction is proven on the published
event, but nobody has watched a real run render the four new line types on
`/simple` yet. That live pass is the next step.


### The rail's loop panel — the same loop, compacted (2026-09-16)

The `/net` rail's section is now **⚡ Macros & Loop** (`Sidebar.jsx`), and
`AgentLivePanel.jsx` leads with the loop instead of an "Agent" block:

- **One row per section**: name · state badge · the one action. The button is
  **`▶ Start loop` / `■ Stop`** — `/simple`'s words, because it is `/simple`'s
  loop: it works the next active goal, so `▶ Start loop` says what it does and
  "Start Agent" said what it is.
- **The readout is `/simple`'s**, in the same order: `loop · stage · step/budget ·
  stalls`, with the last lesson appended. `Δ` (last outcome delta) is gone —
  `/simple` stopped showing it, so a stale number is not worth a line in a 255px
  column. When idle it says `Idle — Start works the next active goal.`
- **The raw permission switches are folded** into one `<details>` with eye
  tracking and a `Modes & kill switch — /simple →` link. This is exactly the split
  `/simple` makes: the mode ladder there IS auto-approve + listener, so those two
  checkboxes are the *plumbing* there too. Folded, the panel opens on the loop and
  the macros and nothing else. Nothing was deleted — both switches are one click
  away.
- **Macros**: the count and `Manage →` ride in the section head (a full-width
  button for a navigation link cost a whole row) and the list scrolls
  (`max-height: 172px`), because a rail panel that grows with your macro count
  pushes the conversation off the bottom of a fixed-height column.
- **Honest consequence:** eye tracking is now behind a click. It is in `/simple`'s
  Advanced fold for the same reason, and the summary line reports its state
  (`👁 Calibrated — ready`) without opening the fold.

Two sizing bugs and one theming bug, all found by driving the panel rather than
reading the file:

1. **`index.css` sets `min-height: 44px` on `button` and on `input`** — and this
   panel's every control was 44px because of it, including the checkbox itself:
   the two stacked switch rows alone measured **124px**. That is a touch-target
   default for a page, not for a rail; the compact controls now undo it (the
   loop's own Start/Stop keeps 32px, being the one control worth aiming at).
2. **`1rem` is 38.88px in this app** (not 16), so every rem in the base file
   rendered 2.4× its intent on a surface whose sibling stylesheets speak px. The
   Plans emoji was `1.15rem` → a 45px glyph in a 67px line box, which made a
   ONE-LINE row measure **81px**; the macro hotkey chip was `0.68rem` → 26px,
   making every macro row 52px. Measured after: 35px and 35px. The sidebar
   variant now overrides every rem it renders.

3. ⚠️ **It painted a navy slab inside a grey rail** — dark mode only, and a
   *specificity* bug rather than a colour choice. `.dark-theme .agent-live` is
   `(0,2,0)` and beat the sidebar variant's `background: transparent` /
   `color: var(--text-primary)` at `(0,1,0)`, so the standalone panel's dark skin
   (`rgba(17,24,39,.72)`, a blue-black) laid a film over the rail's grey: blue
   behind every line of text and grey around it, in a column whose whole point is
   being one flat surface. The rule is now
   `.dark-theme .agent-live:not(.agent-live--sidebar)`.
   **A variant class has to carry the theme prefix too, or the theme wins.** The
   panel's controls were already right (`--bg-primary`, the same surface the rail's
   own select and Advanced button use); what also leaked was the section separator,
   painting the base rule's `rgba(0,0,0,.08)` fallback — `--border-color` is defined
   nowhere in this app — so the sections were separated in light mode and not in
   dark. They now take the rail's `--border`.

**Verified live** (guest account, addon connected): panel **224px** with the fold
closed, 353px open, from ~500px before; toggle chips 30px on one line; `Manage →`
18px; the list caps at 172px and scrolls (a 12-row probe list: scrollHeight 664,
no row overflow); no horizontal spill at 390px (`scrollWidth === innerWidth`) and
`vite build` clean in both themes. The panel root measures `rgba(0, 0, 0, 0)` — the
rail's own surface — in **both** themes, with `--text-primary` ink and `--border`
separators. No jest suite covers this panel — none did before either.

---


## Vision boards — `/plans` 🌟

A vision board is **one generated picture of the life the user is aiming at**,
made from their goals, drawn on demand, saved to their account, and kept as a
history so the next one has something to be different from.

It belongs to the Dream board view because that is the only place in the product
where a user is already looking at their life at that altitude — and because it is
the same data. Nothing new is stored about a goal: the board is a *reading* of
goals that already exist, in the same spirit as the Map and the review pass.


### Two models, in this order, for a reason

| Step | Model | Why it is not optional |
| --- | --- | --- |
| goals → **image prompt** | the chat model (Haiku 4.5) | "Beach trip with my girlfriend and her child" is not an image prompt. Turning an aspiration into something picturable is a language job, and it is the whole reason the feature is not a text field. |
| prompt → **picture** | an image model (Stability SD3.5 Large) | 16:9, one image per scope. |

The prompt brief (`services/visionBoard.js` → `buildVisionBoardPrompt`) carries the
goals with their horizons and the user's own `vision` line, and pins every choice a
model gets wrong on its own: 45–90 words, one paragraph, and a picture that **is a
vision and dream board** — a collage of photographs of those goals — rather than a
scene or a still life.

#### What the first version got wrong

The brief used to offer the writer a choice — "a single photorealistic scene, or a
loose grid of editorial photographs, whichever carries more of the goals". The first
real board chose the scene and came back as a photorealistic stock photograph: a
family around a laptop on a wooden deck, an Apple logo legible on the lid, a
blueprint on the table. A perfectly good picture of somebody else's afternoon, and
not a vision board. The rules below were added, and all of them are mandatory:

| Rule | Why |
| --- | --- |
| **It is named.** Every prompt must call the picture a **"vision and dream board"**, and it is pinned into the opening sentence — see the image-model notes below, where the opening words are shown to decide the picture. | The product calls it that, so the image prompt does too, in the one position that carries the most weight. Naming it was originally **forbidden**, on the theory that "vision board" makes an image model reach for a cork board; drawing real boards showed that the props come from *describing* props, and naming the collage right before describing it costs nothing. |
| **The board rules** (`BOARD_RULES`). The picture is ONE photo collage of three to six LARGE photographs, different sizes, edges crossing, no two alike and never the same subject twice, every photograph a real and specific thing from the goals, all sharing one light and one colour grade, and colour as the point (“bright, alive and aspirational at a glance, never grey or dusty”). | That *is* what a vision board is: a collage of photographs of the life somebody wants. The rules are what keep it from collapsing into either of the two failures this feature has actually produced — one lone scene, or one subject rendered over and over. |
| **Nothing holding it up.** No visible surface or board, no pins, tape, paper, twine or frame: the photographs *are* the whole picture, and the writer is told the name describes the collage rather than something the photographs are fixed to. | This was the second complaint and the more damaging one. Once the brief described cork, pins and washi tape, the props became the subject: every board was a picture of stationery with a life somewhere behind it. The fix is not to *refuse* the props in the negative prompt — see the image-model notes below, where a long denial list destroyed the picture — but to never name them anywhere, and describe a collage that has no room for them. |
| **No faces, by default.** Any people are far away, from behind, in silhouette, in the background, or hands only — never a portrait, never looking at the camera. And **no subject that needs a face to make sense**: not “a family around a table”, but the table, the food, the hands, the doorway. | An image model asked for "a family" invents a specific, photorealistic family, and asked for a family at a table it draws faces whatever the rules say. A vision board is about the aims; an invented face reads as a stock photo of somebody else's life, and at worst as a likeness of a real person. |
| **A look, chosen per board.** Light, palette and mood come from `BOARD_STYLES` — see below. | The rules above are what every board *is*; the look is what makes the next one differ from the last. Pinning both into one fixed answer is what made every board the same picture. |

#### The two defaults, and the one thing that changes them

No identifiable faces, and no text (lettering renders as garbage, and a "vision
board" in a model's mind is full of captions). Both are **defaults, not bans**: the
free-text steer switches either on, and `resolveBoardRules` decides which before the
brief is written, so the brief never contradicts the user and the negative prompt
never fights them either:

| Steer | Result |
| --- | --- |
| *(empty)* | no faces, no text |
| `a family on the beach` | `allowPeople` — the face rules drop out of the brief *and* the negative prompt, while a likeness of a real person stays refused |
| `put the words "our beach house" on it` | `allowText` — one or two short handwritten-style phrases, nothing printed, nothing long |
| `no people`, `without faces`, `no persons`… | read as a *refusal*, so nothing changes. The refusal check has to run first and per subject: "no people" contains the word "people", and a hint like "warm film, no text, a family in the background" asks for one thing while refusing another — one global "was anything refused" flag would have cancelled the family. |

The dialog says both defaults out loud (`vb-defaults`), because an instruction the
user cannot discover is one they will report as a bug when the board comes back
without the people they wanted.

`normalizeBoardPrompt` then scrubs the answer (code fences, a `Prompt:` label,
wrapping quotes, markdown emphasis, a trailing "Let me know if you'd like
changes!" — all a *reply to the user*, not part of the picture), and an unusable
answer falls back to a deterministic prompt that asks for the same *kind* of
picture — with the same look, so a fallback board is not the one board in the
gallery that looks different. The record stores `promptSource`, `rules` and the
negative prompt that was actually sent, so a board with a face in it is explainable
rather than mysterious.

#### What the image model actually does

Everything here was learned by drawing real images and looking at them (21 of them,
2026-09-15 and 16), not by reasoning about the prompt. All of it is now encoded in
the brief, and three of the findings are the opposite of what the first version of
this feature did.

| Finding | Evidence, and what the code does about it |
| --- | --- |
| **The opening words decide the picture.** | A prompt that opened with its palette ("a vivid pop collage bathed in cobalt, scarlet and turquoise…") drew a graphic grid of one building's blue and yellow walls. The same subjects opened with the collage sentence below drew a board of four or five real photographs of a life. The brief now pins that opening **verbatim** and puts the light and palette at the end: *"A vision and dream board: a bold photo collage filling the frame — large glossy photographs of …, overlapping and layered at slight angles with their edges crossing, …, photographic."* |
| **Naming it does not cost anything.** | The name was originally banned from the prompt for fear of summoning a cork board. Two boards drawn with the name pinned in the opening came back as photo collages — a nursery, keys changing hands, a house at dusk, a laid table by the sea — with no cork, no pins, no lettering. The props came from *describing props*, not from using the product's name for the picture. |
| **A long negative list does not subtract — it takes over.** | The identical collage prompt with 15 denial terms came back as a rigid grid of one building; with 65 it drew a blue mountain. Cut to nine terms (lettering, watermarks, faces) it draws the board. `boardNegativePrompt` is short for that reason, a test caps its length, and props are kept out by never naming them anywhere. |
| **Fewer subjects, of different kinds.** | Twelve named subjects drew none of them. Five subjects of *different kinds* (a table, a house, a landscape, hands, a garden) drew four or five distinct photographs. When the writer listed five variations of one thing — a clifftop house, a beach, a workshop, a deck, a pool — the board came back as six panels of coastal timber buildings. The brief now asks for three to six and demands different kinds of thing. |
| **There is no better model available in this region.** | `gemini-2.5-flash-image` is in the catalog but answers "The provided model identifier is invalid" in us-west-2, so the Stability models are the only ones that actually work. |
| **The residual.** | About half the boards come back exactly right; the rest come back with a repeated subject or a two-panel split. That is the model's ceiling for a multi-image composition and no amount of brief writing has moved it further. If the boards must be more reliably varied, the next lever is not the prompt: it is drawing each photograph separately and compositing them server-side (three to six image credits per board, or the covers the goals already have). |

#### Every board gets its own look

A board's light and palette are chosen per board, so no two boards in a gallery are
the same picture. `BOARD_STYLES` holds ten complete **art directions** — golden
warmth, bright and airy, vivid pop, soft pastel, evening city, coastal light,
sun-drenched travel, warm interior, lush green, rich jewel. Each is two lines of
light, palette and mood, and each obeys the board rules, the no-faces rule and the
no-text rule.

Three versions of this catalog were needed to get here, and the difference between
them is the lesson. The first was one fixed answer *in the brief* ("cork / linen
pinboard / pale paper", "calm, soft and neutral"), so every board was the same dusty
noticeboard. The second varied the **craft** — cork, pegboard, riso prints,
watercolour washes, polaroid garlands, terrazzo, glitter — which produced eleven
different prop still lifes and no realer boards. What actually varies between the
vision boards people make and post is their **colour and their light**, so that is
what varies now, and the craft words are gone from the brief entirely: a test
asserts that no style, and no brief, contains a single prop word.

| Decision | How, and why that way |
| --- | --- |
| Which look | `pickBoardStyle({ hint, recent, rand })`, called in the controller **before** the brief is written, so the look is an instruction to the prompt writer rather than a hope. `rand` is injected: the picker stays pure and testable. |
| Never the same look twice | `recent` is the user's own history, newest first; while any look is still unused it is only picked from those, and past that only the previous board's look is ruled out. It is a genuine random pick inside that set, not a queue — repeating ten looks in the same order would be its own kind of boring. |
| The hint can name one | `"coastal"`, `"vivid colour"`, `"pastel please"`, `"make it feel like evening"`. A named look wins over the rotation, because a board you liked has to be gettable again. The matching vocabulary is each style's own `keywords`, so adding a style makes its name askable for free. |
| `"no pastel"` | Read as a refusal, checked first and per style — the same trap as `"no people"`, where the phrase contains the word. A refused look is also dropped from that board's pool. |
| Keywords stay words of mood | A *subject* word would force a look on any steer that mentions it (`"beach"` as a keyword would make every beach steer coastal), and two looks sharing a keyword would send every steer to whichever is listed first. A test asserts that ordinary mood words — "film photography", "warm light" — remain free picks. |
| Reading the history | `_recentBoardStyles` scans the user's `vision` items and reads **only** `slug, style, updatedAt`. The id is lifted onto the item by `_writeVisionBoard` for exactly this read — walking the boards themselves would pull up to 32KB of record JSON each. |
| Two scopes, one request | The look just picked is pushed onto the history immediately, so "Dreams + All goals" makes two boards that are actually two different boards. |
| The history read failing | Best-effort and bounded (5 pages), because it is an optimisation: a throttled scan loses the don't-repeat rule for one board and never the board itself. |

The record stores `style: { id, name }`. The id is what the next board refuses to
repeat; the name is what the gallery line shows — `Dreams · 6 goals · Coastal light ·
2m ago` — because *"which one was the coastal one"* is the second question a history
of boards has to answer. A board made before looks existed has no style and simply
renders without it.


### Which goals — "all goals and/or just dream goals"

The dialog asks before it spends, with the two sources the product already has
words for: **🌟 Dreams** (Life-horizon goals) and **🎯 All goals**. Both can be
picked, which makes two pictures and costs two credits — said out loud in the
dialog (`1 image · 1 credit`). A source with no goals behind it is listed with
"nothing here yet" and cannot be picked; if a scope comes back empty anyway (goals
changed between the dialog opening and the request) it is **skipped and reported**,
never failed — the other board is still made.

Goals are read **server-side** from the caller's own store. The browser never posts
its goal list, so a board cannot be made from someone else's goals or from a list
that changed under the dialog. A goal that `failed` is never a subject, and neither
is a goal with no title; the list is capped at 24 goals, longest horizon first, so
the picture leads with the life rather than with this week (`truncated` is stored
and shown as "N left out").


### One board per object

Unlike the map and the review — single snapshots that get overwritten — boards are
stored as **one `vision` item each** (slug `board-<stamp>-<scope>-<rand>`), because
"look back at your boards" is the feature. The history has to be real objects rather
than a rotating cache.

Each record keeps what it was made from, not just what it looks like: the goals
(slug, title, horizon), the prompt, the negative prompt, the model and seed, the
image URL, its byte size, the storage record id, and whether the prompt came from
the model or the fallback. The list entry carries the record (`toListEntry` includes
`content` for `kind='vision'`), so the gallery is **one read** rather than a request
per thumbnail.

The picture itself is stored in S3 through the same path the dream covers and /net's
`generate_image` use — and the bytes are recorded as a storage row, because without
it every board would be stored for free and the plan's storage cap would quietly
under-enforce.


### Spending, in order

`LLM credit gate → image credit check → storage check → generate → upload → record →
save`. A refusal writes the 402/413 the client already knows how to render (with
`upgradeUrl: '/pricing'`), and nothing is spent. Both limiters apply to the route
(`llmLimiter` + `imageGenLimiter`) since it spends both meters.

The board is saved **server-side, in the request that draws it** — so a board exists
even if the tab is closed mid-flight, and the browser never handles image bytes it
would have to upload back.


### A storage bug this had to fix

`DELETE /api/data/file/:s3Key` dropped a file from its storage row with
`files.filter(file => file.s3Key !== s3Key)` — but only the newest writer stored
`s3Key`. The cover upload and /net's image tool store `{ filename, contentType,
size }`, so the filter matched **nothing** for them: the object went to S3's bin and
its bytes stayed on the user's quota forever. Deleting a board would have hit the
same wall.

`utils/storageRecords.js` now owns the match — by `s3Key` when the entry has one, by
the key's basename otherwise — plus the creator check (an id is guessable in a way
an S3 key prefix is not). The file endpoint keeps its 401 for someone else's row;
the board endpoint ignores that case, since its record id comes from the user's own
board.

**Verified live, not inferred:** after deleting a board, the storage row still
exists with `files: []` (the bytes stopped counting), the CloudFront URL answers
**403**, the board is gone from the list, and the response says
`{"ok":true,"s3Deleted":true}`.


### Verified

- **The whole path ran end to end on the guest account** (`scripts/test-vision-board.js`,
  the diagnostic the feature ships with): `dream all` → **HTTP 200 in 13.9s**, one
  board saved (`board-20260916-014117-all-553167`), and the empty scope reported as
  `{scope:"dream", reason:"scope-empty"}` rather than thrown. The prompt the chat
  model wrote from a single goal — *"A warm golden-hour beach scene where a man and
  woman stand together in shallow turquoise water, her young child splashing nearby
  with genuine joy, soft sunlight casting long shadows across wet sand…"* — drew a
  1.9MB 16:9 photograph with no text in it, which is what the "no lettering" rule is
  for.
- **`--list` / `--delete` modes**: 1 board stored → deleted → 0 stored, `s3Deleted:
  true`, image gone from CloudFront, storage row's `files` emptied. The guest account
  was left as it was found (0 boards, one row with nothing in it — the same shape
  every user's deleted board leaves behind).
- Tests: `visionBoard.test.js` (backend, pure) 23/23 including the two rules that
  matter most (no-lettering said twice; a chat-style reply scrubbed to a prompt),
  `fileUploadStorageGate.test.js` 16/16 with a new case that fails without the
  `filename` match, `visionBoardUtils.test.js` 17/17, `VisionBoards.test.jsx` 12/12 —
  the Plans folder 115/115, backend unit suite **768/768** (53 suites). `vite build`
  clean (828 modules).
- **A bug only the live run could find**: `listGoals` was never imported in the
  handler, so every request died at the goal read with a 502 while every unit test
  passed — the pure service was fine and the endpoint had never been called. That is
  the argument for the script existing at all.
- Route reachable: `POST /api/data/csimple/vision-board` answers **401** without a
  token.
- **The prompt was then worked on against real boards, not against its own source.**
  `scripts/test-vision-board.js --prompt <scope> "<steer>"` is the cheap loop for this:
  it prints the brief, the resolved rules, the negative prompt and the image prompt
  the chat model produced, and stops before the image — an LLM call instead of an
  LLM call *plus* an image.
- **The look, added 2026-09-15, corrected the same day.** The first version of it
  varied the *craft* (`--prompt all "riso pop"` printed `THE LOOK — Riso pop
  (riso-pop, asked)` and drew a chartreuse sheet of risograph prints), which the user
  rightly called out as still lame: naming cork, pins and tape had turned the boards
  into pictures of stationery. The catalog is now ten art directions of light and
  palette. Verified by DRAWING boards, not by reading the prompt: the writer chose
  *Golden warmth*, then *Warm interior*, and both came back as collages of three to
  six real photographs of the goal-set — a laid table under warm light with two
  smaller photographs beside it, and a sunlit kitchen with a couple baking in an
  inset. Of the twenty-one boards drawn while this was worked on, the later ones —
  the two that named the board *Rich jewel* and *Coastal light* — are the picture the
  feature is for: a nursery, keys changing hands, a house at dusk and cash on a table
  for the first; a table set for many looking out to sea, with two smaller
  photographs beside it for the second. The earlier ones were the failures logged in
  the "what the image model actually does" table above, each of which changed the
  brief.
- The look has tests at both ends: `visionBoard.test.js` **45/45** (the rotation
  never repeats, an asked-for look wins, `"no pastel"` is refused not honoured, mood
  words do not hijack the steer, every style reaches the brief, the fallback and the
  record, **every prompt and the fallback names it a "vision and dream board"** —
  `vb-defaults` copy and the naming rule changed together — and **no style or brief
  contains a prop word**, the regression guard for the stationery) and
  `visionBoardEndpoint.test.js` **7/7** for the wiring a pure
  service cannot cover — two scopes make two different looks, the history read is a
  projection that never touches the record payload, the id is on the item, a failed
  scan still makes a board. Frontend: `visionBoardUtils.test.js` +
  `VisionBoards.test.jsx` **30/30** (the look is in the one-line summary, and an
  older board without one still renders).
- ⚠️ **A dev API started with `npm start` serves the module it loaded at boot.** The
  first live board after the look change came back as the old cork brief — correct
  code, stale process. Restart the backend before believing a live run of this
  feature.

---

