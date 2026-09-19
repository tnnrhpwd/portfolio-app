# The backlog — what is left, and in what order

Everything still to do on Simple, in one place, so [`agent.md`](agent.md) can stay
what it is: an orientation doc for someone opening this repo cold.

**This file is the only place work items live.** If you finish something, delete it
from here rather than marking it done — a backlog that keeps its history is a
backlog nobody reads. Design records for what *did* ship are in the feature docs
listed in [`agent.md`](agent.md); the one exception is a dated audit pass, which
keeps its ✅/🟡/⬜ marks in place because the pass itself is the record.

**Status markers:** ✅ implemented · 🟡 partially implemented (a seam exists; the
integration, UI or guardrail is still open) · ⬜ not started.

---

## Readiness gates — the bar before selling again

The reliability bar that must be met before the purchase gate is turned back on.
Re-run the whole thing after any significant change to the perception/action
pipeline.

1. **Hard gate** — key simulation, perception, and auto-execution each work in ≥2
   common apps.
2. **Reliability gate** — each of the 11 validation scenarios passes 9/10 across
   sessions/days; fix and restart on any consistent failure.
3. **Account plumbing gate** — purchase confirmation and password reset confirmed
   end-to-end with a real account.

**Validation scenarios** — executable in
`simple-addon/server/automation/eval/validate-core-functionality.js`, driven from
`simple-addon/` via `npm run validate:core`:

| # | Scenario | Passes when… |
|---|---|---|
| 1 | Type + save a note in Notepad | saved file matches the typed string byte-for-byte |
| 2 | Calculator arithmetic by clicking | displayed result is `19` |
| 3 | Rename a file in File Explorer | old name gone, new name exists, content intact |
| 4 | Alt-Tab between two windows | foreground window is expected (both directions) |
| 5 | Detect human-typed input (interactive) | logged events reconstruct the sentence |
| 6 | Read UI state via perception | reported toggle states match ground truth |
| 7 | Record → compile → auto-replay | replay reproduces the same end state, no manual input |
| 8 | Planner-driven NL execution | final state matches the instruction's intent |
| 9 | Drag-and-drop with a moving path | the file/slider actually moved |
| 10 | Held input releases on focus loss | the key released after the focus switch |
| 11 | Workspace profile save → move → restore | window returns to its saved position/size |

**Outstanding before the bar is met**

- ⬜ **Reliability tally** — run each validation scenario ≥10 times and require 90%+
  per scenario.
- ⬜ **Perception loop** — scenario 5 needs one real `--interactive` run with a human.
- ⬜ **Auto action execution** — scenario 8 needs one real signed-in run (all LLM
  calls proxy through the backend).
- ⬜ **Scenario 11** — needs a live desktop run before it counts toward the tally.
- ⬜ **`input_hold`** — held keys/buttons lack a real-desktop regression test; add one.
- ⬜ **Existing Pro subscribers** — tell them plainly what works and what doesn't,
  including that phone viewing was never built (roadmap 10).
- ⬜ **Account/transactional email plumbing** — verify purchase confirmation +
  forgot/reset-password loop with a real account.
- ⬜ **Single installer** — consolidate "download, trust cert, configure" into one
  flow if feasible.

---

## Roadmap

Ordered by value-per-risk. Ship the core "show don't tell" loop before the
marketplace, and ship privacy scrubbing before *any* publish path.

1. ✅ **Generalization MVP** — LLM re-derivation + multi-demo parameter inference.
   The design is recorded in
   [`archive/SIMPLE_MARKETPLACE_PLAN.md`](../archive/SIMPLE_MARKETPLACE_PLAN.md)
   (the skill-generalization work list, A1/A2) — that file is its only write-up.
2. 🟡 **Privacy scrub pass** — scrub engine + preview endpoint + consent gate
   shipped. ⬜ Remaining: scrub-report confirmation in pre-publish UI.
3. 🟡 **Pre-run capability summary** — summarizer + preview endpoint shipped.
   ⬜ Remaining: mandatory pre-run confirmation UX.
4. ✅ **Marketplace backend** — public namespace, versioning, install-gated ratings,
   atomic counters.
5. ✅ **Marketplace web frontend** + trust ranking + dry-run-first — `/market` page,
   ranking + `lowTrust`, and dry-run-first enforcement all shipped.
6. ✅ **Vision re-targeting on replay** — recovery path + UI messaging + broadened
   coverage (uia_invoke / click_at / browser_click) all shipped.
7. 🟡 **Monetization seam** — provider-boundary credit gate + blocked-call UX copy +
   state-machine unit tests shipped; a full route-layer DynamoDB/Stripe fixture pass
   remains.
8. 🟡 **Onboarding/UX polish** for non-technical users — the three Simple surfaces
   are bound by one switcher inside the site header (no extra row), `/simple` leads
   with the four-mode trust ladder, and `/net` opens as just the chat with the
   conversation rail a collapsed drawer. ⬜ Starter templates, a first-run guided
   demo, and the funnel gaps listed in
   [`BUSINESS.md`](../guides/BUSINESS.md) → *Funnel gaps* remain.
9. ✅ **Goal ↔ chat link** — a goal has its own `/net` conversation (id derived from
   the slug), enlisting from `/plans` runs the goal *in* that thread, the card flips
   to **View agent** once a run exists, and runs started from either surface are
   mirrored onto the goal. ⬜ Seeding a legacy goal's recorded run into a still-empty
   thread.
10. 🟡 **Phone viewing — "live screen viewing from your phone"** — ⬜ not built; the
    promise was withdrawn from every surface on 2026-09-18. It was sold as a Pro
    benefit on `/pricing` (plan card, comparison row, FAQ), on `/profile` (both
    upgrade prompts), in `/terms` §3.2 and in the plan emails, and none of it was
    true: there is no way to see a PC's screen from a phone. Those strings are now
    commented out at source — `frontend/src/constants/pricing.js` **and**
    `backend/constants/pricing.js` (the checkout plan cards read the backend copy,
    and `pricingSync.test.js` pins the two together, so they must move as one) plus
    the three pages that hard-coded the phrase.
    **What already exists:** `simple-addon/server/automation/tools/screen-relay.js`
    (`screen_relay`) captures, downscales to ≤640px JPEG, uploads through the
    backend's presigned `/upload-url` to CloudFront/S3, and publishes a local
    `screen.frame` SSE event; `frontend/src/services/simpleAddonApi.js` →
    `relayScreenFrame()` can trigger it. **What is missing:** nothing renders
    `screen.frame` (there is no frontend consumer at all), the event bus is the
    addon's own loopback stream so a phone has nothing to subscribe to, there is no
    cloud-side fan-out of frames, no per-viewer auth or scoping on the frame URL,
    and no relay timer — the tool only fires when the agent or a caller invokes it.
    **Before restoring any copy:** pick the transport (SSE relay vs. signed frame
    URL), build the viewer UI, settle the consent story on top of the existing
    `sandboxed-write` approval, and make sure a frame URL cannot outlive the
    session. **Meanwhile:** existing Pro subscribers were sold a benefit they
    cannot use — that is the readiness-gate bullet *Existing Pro subscribers* above
    — and Pro's listed value is now credits + storage + support only, so
    [`BUSINESS.md`](../guides/BUSINESS.md) → *What each tier buys* is worth
    re-checking.

Each milestone ships with Jest unit tests and, where it touches the loop, an
`automation/eval/scenarios/` scenario.

### Next implementation slices (file-targeted)

- **Capability/scrub UI confirmations** — frontend route(s) following the `/net`
  integration pattern.
- **Recorder consent gate** — `server/automation/permissions.js` + recorder capture
  pipeline.
- **Recorder sensitive-capture consent** — frontend consent UX polish.
- **Vision replay repair fallback** — `server/automation/tools/skill.js`
  (`repairStep`) + `server/automation/vision-fusion.js`.

---

## P0 — do now

- 🟡 Recorder sensitive-capture consent: frontend consent UX polish.

## P1 — observed while driving the loop (2026-09-15)

- 🟡 **The loop burns its whole budget on a tool that cannot inform it and never
  self-stops.** DIAGNOSED 2026-09-16 — the write-up is in
  [`Simple_Loop_Behaviour.md`](Simple_Loop_Behaviour.md) → *Why a run can spend its
  whole budget on `screen_capture`*. A second driven run (10 ticks, `screen_capture`
  every time, ended by hand) confirmed the third candidate and turned up the one
  below it: `critic.score()` returns **+0.5 for every tick whose tools all
  succeeded**, and `reflect()` resets `stallCount` to 0 on any positive delta — so
  the stall detector is a *failure* detector and cannot fire on a
  useless-but-successful loop. And the screenshot never reaches the model: `plan()`
  is a text-only `chat()` call, and `act()` hands the model
  `JSON.stringify({result}).slice(0, 1200)` — for `screen_capture` that is
  truncated base64. The agent is capturing images it cannot see, so repetition is
  not irrational from inside the loop. The crowding-out candidate is real but not
  what happened here (`CURRENT PERCEPTION` is priority 1, `GOALS & CONTEXT` is 3,
  so an oversized block drops the goal text first). Fix order: score repetition as
  zero progress → force `goal_ask_user` after N identical ticks → give the loop a
  way to see (or drop the capture tools from a goal it cannot visually serve).

## P2 — after the core loop is stable

- 🟡 Trust-ranking tuning + low-trust dry-run-first hardening (formula + classifier
  shipped; tune against real usage).
- 🟡 LLM provider local adapter quality pass (deterministic stub shipped; a real
  local model backend remains).
- ⬜ Consumer onboarding polish and starter templates.

---

## Production readiness — the /net harness as an operable tool (2026-09-18)

[`NET_HARNESS_PLAN.md`](NET_HARNESS_PLAN.md) says the interactive harness is
feature-complete, and it is: one loop, three tool planes, a step journal, cancel +
approve, a plan surface, a failure taxonomy and evals. That is the *behaviour* of a
programming harness — a turn that can answer, act on the site, change this
repository, and drive the addon's hands, with every step visible and stoppable.

What is left is the difference between a tool that works for its author and one
that can be **operated**: state that survives a restart or a second instance,
records that survive a deploy, and tests over the paths a user actually drives.
Each item below names its evidence, so it can be checked rather than believed.

**Scope note, so nobody widens it:** this stays a **private, single-operator**
harness. Multi-tenant parity is a non-goal in
[`NET_HARNESS_PLAN.md`](NET_HARNESS_PLAN.md) §6 and the admin gate is load-bearing
— nothing here asks for multi-tenancy.

### R1 — Turn state must survive a second instance, or a turn must be pinned to one

`harness/turnControl.js` keeps live turns and pending approvals in two module-level
`Map`s (`const turns`, `const approvals`), with the caveat written at the top of the
file: *"If this is ever scaled out, these two maps move to DynamoDB."*

This is the biggest blocker, because the **SSE connection *is* the turn**. A cancel
or an approval answered on instance B cannot see a turn parked on instance A: the
request 200s on the "that turn already finished" race while the run keeps spending
model calls and writing files. Two acceptable answers, in order of effort — make the
service explicitly single-instance and fail loudly if it is not, or move
turns/approvals to DynamoDB with a short TTL.

### R2 — The run record is one item, and its failure mode is silence

`harness/stepJournal.js` keeps a per-user ring in a **single** DynamoDB item
(`csimple_runs_<userId>`, `MAX_RUNS = 10`) written as a whole-array
read-modify-write: `text: JSON.stringify(runs)`. Two consequences that only show up
in production:

- **Size.** Ten runs of full step records share one item, against DynamoDB's 400 KB
  item limit — and since P0's trace landed, a turn's steps are a real payload
  (~300–500 bytes each, up to 16 per turn, plus the plan). Nothing in the module
  bounds the item's total size, and `finishRun` is deliberately best-effort
  (`catch` → a `logger.warn` → `{saved:false}`), so crossing the limit means the
  journal **quietly stops recording** rather than telling anyone.
- **Lost updates.** Two overlapping turns for one user is a read-modify-write race;
  the later write wins and the other run vanishes from the ring.

Either is survivable if it is *known*. Both are better fixed: one item per run plus a
query, or a size guard that drops the oldest runs until the item fits — and says so
when it does.

### R3 — Test the client wiring the user actually touches

`SimpleChat` has no test, and it is the component that owns the harness's controls:
the approval-routing branch and the Stop → cancel call are covered only by the
backend's end-to-end cases (recorded as owed in [`NET_CHAT.md`](NET_CHAT.md) →
*Layer 3e*). For an interactive harness that is the worst place to have a blind spot,
and one of the cheapest to close — the surface is a single component and the cases
are already named by the backend suite. `StepList`, `PlanChecklist` and
`MessageBubble` are tested individually, so the gap is the plumbing *between* them.

### R4 — Verify the two behaviours that shipped without a live model

[`NET_HARNESS_PLAN.md`](NET_HARNESS_PLAN.md) carries this as a standing risk; it
belongs here as work, not as a caveat:

- **Prompt caching (P4)** — four guards and a latch, never seen by a real model. The
  first live tool turn either reports non-zero `cached_tokens` from round 2 onward,
  or the log says which guard declined / that the latch fired.
- **The relay-only routing split (Layer 3h)** — unit-tested, never field-tested (no
  addon was present). The check is a real remote session confirming a `pc_do` hop
  lands inside the turn budget.

### R5 — Make the numbers survive a deploy

`harnessStats.js` joins the durable run ring with `routingTelemetry`'s in-process
counters, and its own `notes` say so: the counters reset on deploy and `since` marks
when they started. `toolsPerTurn`, `deniedToolCalls` and the intent mix are exactly
the numbers worth watching *over time*, so either export them or persist a periodic
snapshot — the run ring already proves the persistence pattern.

### R6 — A refusal needs a way to be allowed

The taxonomy tells the model not to retry a refused step and not to rephrase it —
correct — and then leaves the user with no way to change their mind, so the same
request has to be re-typed from scratch. `TOOL_POLICY` in `toolScopes.js` is the
seam, and the conversation is where the decision should be handed back: *"you
refused this earlier — allow it?"*. Distinct from R1, which is about the approval
reaching the right process at all.

### R7 — The prefix diet

The one item P4 left open: audit the ~4.2K tokens of tool schemas for descriptions
that can be shortened without losing the rule they encode. Less urgent since caching
landed — the prefix is now billed once per turn instead of once per round — but a
cache *write* costs 125%, so every turn still pays it in full.

---

## Addon loop — perception and action hardening (2026-09-18)

Mechanisms worth taking from Anthropic's **computer-use reference
implementations** —
[`computer-use-demo`](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo)
(containerized) and
[`computer-use-best-practices`](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-best-practices)
(native macOS, and the one worth reading for the patterns). They are the closest
published analogue to this addon's loop on a different substrate — a screenshot /
mouse / keyboard tool surface with an agent loop over it — and they solved several
problems this loop still has. Also documented there, and NOT for us: a virtual X11
desktop, and a hosted tool declaration we have no equivalent of.

Ordered by value-per-risk, and by **what unblocks what**: H2–H5 all lean on H1,
because a tool result the model cannot read is not an observation. The
mechanism-level statement of the same gaps is in
[`Simple_Loop_Behaviour.md`](Simple_Loop_Behaviour.md) → *What the loop cannot
currently do*, which is where the blindness is diagnosed from the code.

### H1 — Shape tool results structurally, never by a byte slice

`act()` pushes `JSON.stringify({ok, result|error, mode, durationMs}).slice(0, 1200)`
into history. For an image tool that is 1200 characters of truncated base64: not a
weakened observation, a *misleading* one, because it looks like data. The
reference shapes by **structure** — name a data URL rather than embedding it, count
an array, drop an image-shaped key, clip a leaf, and bound by *field* instead of
cutting a JSON document mid-string.

`event-detail.js` already encodes exactly this rule for the SSE stream ("an event
is a report, the action log is the record"). The loop's history is the one place
that ignores it — so this is mostly a matter of applying the existing rule one
layer over, not of designing anything.

- Files: `server/automation/agent-loop.js` (`act()`), `server/automation/event-detail.js`.

### H2 — Capture at a bounded size, and scale coordinates back

The reference captures at XGA/720p class, resizes *before* the image reaches the
model, keeps the scale factor, and maps every returned coordinate back to the real
display. Its guidance is blunt: relying on the API's own downscaling costs accuracy
*and* latency, and a mouse action given in screenshot pixels that is applied to an
differently-sized screen is the #1 cause of clicks that "miss".

Windows' DPI scaling is the same trap as its Retina note, and this repo has already
been bitten by it once — `eye-tracking-manager.js` needed `_getScreenScaleFactor()`
because `SetCursorPos` is physical-pixel while the whole tracking pipeline is in
DIPs. Whatever owns capture next needs the same discipline in one place.

- Files: `server/automation/tools/screen.js`, `server/automation/vision-fusion.js`;
  precedent in `server/eye-tracking-manager.js`.

### H3 — A region read (`zoom`)

`screen_capture` is whole-screen and downscaled, so small text — a dialog button, a
status bar, a spreadsheet cell — is exactly what the model cannot resolve. The
reference's `zoom` takes a region and returns it at full resolution, and it is the
single feature their docs point at when click accuracy is poor.

We have `screen_ocr` and `screen_set_of_marks`, which read text *for* the loop but
do not give it a picture of the region. A region capture is the missing verb, and it
is cheap: the capture path already exists, it just takes a rectangle.

- Files: `server/automation/tools/screen.js` + the registry, `screenshot_check` in
  `server/automation/tools/skill.js`.

### H4 — Give the loop eyes (P1's first fix, with the mechanisms it needs)

⚠️ **P1 above already names this first** — restated here only because that entry
says *what* is missing and not *how* it breaks. Three things have to be true at
once, and getting two of three is why "just send the screenshot" does not work:

1. **The call must be multimodal.** `plan()` is `llm.chat()`; `chatMultimodal`
   exists on the provider seam and the loop never calls it.
2. **Exactly one sized image per tick**, H2's size, not a growing pile — the
   reference prices a screenshot at ~1,000–1,800 input tokens and re-sends it on
   every later call of the turn.
3. **The instruction text goes BEFORE the image** in the turn's content. Their docs
   are specific that describing the target first measurably improves click accuracy.

Two prompts come with it, both free: ask the model to state that it evaluated the
result of each step before moving on, and tell it that screen text is **data, not
instruction** (see [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) → *Known gaps
/ hardening backlog*, which now carries that as a gap).

- Files: `server/automation/agent-loop.js` (`plan()`, `buildSystemPrompt`), the
  provider seam in [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md).

### H5 — A batch-action contract

Their loop lets the model plan several actions in one turn (click, type,
screenshot) and defines the contract precisely: run the blocks **in order**, **stop
at the first failure**, and answer every later block with the exact text
`Not executed: an earlier computer action in this turn failed.` Every call must get
a result or the next request is rejected outright — so "read only the first block"
is not a shortcut, it is a broken history.

`act()` iterates tool calls and does push a result per call, but there is no
stop-at-first-failure rule, no halt text, and nothing asserting the history stays
legal. Cheap to add, and it is what makes a multi-step tick safe rather than
merely possible.

- Files: `server/automation/agent-loop.js` (`act()`).

### H6 — Bound the run's own side effects

Two unbounded writers, both cheap to cap:

- **Observation history.** `plan()` sends `history.slice(-12)`, a window that
  *shifts every tick*, so the prompt prefix is never stable and nothing about the
  turn can be cached. The reference prunes in **intervals** for exactly this
  reason — a window that mutates every turn invalidates a cache every turn — and
  keeps the prefix byte-identical between prune events.
- **The goal's own text.** The every-5-ticks reflection appends a `[reflection …]`
  line to the goal's `content` forever, and that content is re-read every tick.
  Nothing trims or versions it.

- Files: `server/automation/agent-loop.js` (`plan()`, `reflect()`),
  `server/automation/workspace-client.js`.

### Taken, but not now

Kept here so the reasoning is not re-derived; none of these is worth starting
before H1–H4.

- **An advisor with hard caps.** Their advisor is a *separate, stronger* model
  consulted mid-generation, with a per-request cap, a per-conversation cap, a
  reminder interval, and result blocks stripped once the advisor is dropped (the
  API rejects orphaned results). Our `_runMetaReflection` is the same idea with the
  cost controls missing: it runs every 50 steps, forever, and nobody bounds it.
- **A per-run scratch dir for `fs_*` / shell.** `permissions.js` has a shell
  allow/deny list and fs roots; what it does not have is a writable area created
  and destroyed *per run*, which is what their editor/bash tools are confined to.
- **A click-coordinate sanity panel.** Their tool panel auto-generates a form per
  tool and, on a screenshot click, shows the image-pixel position *and* the
  screen-pixel position it maps to. That is the fastest possible check for the H2
  scaling bug, and `vision-fusion.js` is the tool it would be checking.
- **Trajectory replay with the images.** `run-history.js` records runs and
  `AgentTerminal.jsx` streams live; neither replays what the model actually saw.
  Lower value for us than for them, because our runs are short and the cloud
  harness already journals steps (see [`NET_HARNESS_PLAN.md`](NET_HARNESS_PLAN.md)).

---

## Future capability plans

Longer-horizon capabilities, from the roadmap.

- **Audio / voice pipeline** — mic → Whisper STT → intent → goal → TTS.
  (`scripts/voice_pipeline.py`, `server/audio-stream-manager.js`, `tools/audio.js`;
  endpoints `/api/voice/*`.)
- **Natural Language Macro Compiler** — English → structured skill steps
  (`nl-compiler.js`; `POST /api/skill/compile-natural`).
- **Continuous perception bus** — unified event stream (`perception-bus.js`) fed
  into the agent context.
- **Behavioral predictor** — n-gram model over action log; safe-read actions can
  execute speculatively (`predictor.js`).
- **Frontend integration** — NL macro textarea, perception status, voice input,
  predictions panel across `SimpleAddon/*`.
- **Proactive pattern detection** — surface repeated action patterns as one-tap
  "automate this?" suggestions (the watch-and-learn path); built on
  `pattern-learner.js` + `predictor.js`.
- **Watch-and-alert** — user sets a monitor ("tell me when X appears/changes"); the
  agent polls perception and notifies, acting only on confirmation.
- **Scheduled & unattended automation** — run a skill on a schedule or trigger;
  start with local reminders, graduate to background/remote execution only if paid
  demand validates the infra cost (see *Growth and conversion levers* in
  [`BUSINESS.md`](../guides/BUSINESS.md)).
- **Remember-and-repeat** — recall how a task was done before and offer to repeat it
  (memory over the action log → reusable skills).
- **Routines (skill composition)** — compose multiple skills into a sequence with
  minimal control flow (if/then, repeat N×, wait-for X, on-error) so users build
  multi-app workflows ("open spreadsheet → copy → paste into email") without
  scripting; reuses `skill_run` + per-step `successCriteria`.
- **Event-driven triggers (when → then)** — run a skill or routine automatically
  when something happens (a window opens, a file lands in a folder, an app
  launches, a time passes); built on the perception bus + predictor, every trigger
  opt-in and permission-gated.
- **Cloud continuity** — skills, settings, history, and consents sync across a
  user's machines (the same workspace items already do this), so a reinstall or new
  PC restores the agent in minutes.

---

## Agreed epics (2026-09-15)

Two pieces of work specified alongside the console pass and deliberately **not**
built in it. The decisions are recorded here because they were made once, in
conversation, and are expensive to re-derive.

> **E3 ("the cloud run with local hands") is shipped, and was narrowed.** Verified
> against the code 2026-09-18: `addonRelayController.js` `VALID_TYPES` includes
> `'tool'`, `dispatchToolToAddon()` exists, `services/pcTools.js` exists, and
> `cloud-relay.setToolHandler()` is wired. The other thing the epic specified —
> the cloud **goal** agent gaining the addon's schemas and a `call_local_tool`
> path — was never built, and is now deliberately rejected rather than owed: the
> loop that dispatches PC steps is the **chat harness** (where the user is present
> to approve), while the addon keeps its own O-O-G-P-A loop for goal-driven runs.
> See [`NET_HARNESS_PLAN.md`](NET_HARNESS_PLAN.md) ADR-1 / ADR-2 / ADR-4 and §6,
> and the shipped half's records in [`NET_CHAT.md`](NET_CHAT.md) → *Layer 3g* and
> [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) §7.1.1–§7.1.2.

### E1 — Goal scope: timeline and dependencies

Every goal carries an optional timeline **and** optional dependencies. Horizon
(`week|quarter|year|life`) already ships the timeline half and is already optional
on every goal, which is what answers "a retirement aim must not sit next to picking
up groceries". What is missing is the *reason* a long goal is not moving. See
[`GOALS.md`](GOALS.md) → *Goal horizon — one field, four surfaces*.

- `targetDate` exists on the backend but only the Dream board's form writes it and
  only `GoalDetail` reads it. It needs to be proposed and shown like the horizon tag
  is, on the list card as well as the detail page.
- `dependsOn` is new, and the decision was **one field with discriminated entries**,
  not two fields: a goal may wait on another goal
  (`{kind:'goal', goalSlug, note}`) *and* on a condition
  (`{kind:'resource'|'event', label, dueAt}`). "Waiting on the deposit AND on the
  house sale" is one list, and a goal whose list is not satisfied is not actionable.
- **Non-negotiable:** an unmet dependency must change behaviour, or the field is a
  label. `getNextGoal` must not hand a blocked-on-dependency goal to the loop, and
  the container prompt must not try to work it.
- Files: `backend/services/workspaceGoals.js` (validation + carry-forward, next to
  `GOAL_HORIZONS`), `workspaceController.resolveGoalField`, `services/goalReview.js`
  (a `dependency` proposal kind), `plansUtils.js`, `Plans.jsx`, `GoalDetail.jsx`.
- ⚠️ Design against the whole-item `Put` trap described in
  [`GOALS.md`](GOALS.md) → *The trap this had to survive*: both goal writers write
  the whole item, so a field a writer forgets to carry forward is destroyed by the
  next partial write. `workspaceGoalHorizon.test.js` is the test pattern to copy.

### E2 — Batch approval is mode-aware

Staging plus a single-`POST` apply already ships (see [`GOALS.md`](GOALS.md) →
*The review pass*) and is what makes a loop-initiated review safe. What it does not
know is the mode.

- Decision: in **Assist**, the review proposes and the user approves the batch once.
  Risky **tool** approvals keep their own per-call prompts — they are not folded into
  the batch (the batch is *goal-list* changes only).
- Autopilot does **not** gain an auto-apply path. A review nobody read must never
  write on its own, which is the property the review pass exists to protect.
- Missing: the mode read into the panel (it already derives from `currentMode(perms)`,
  so the primary action can read "Approve these N changes"), copy that distinguishes
  a batch the loop proposed while the user was away from one they just asked for,
  and a count badge on the loop panel when one is waiting.
- Files: `GoalReviewPanel.jsx`, `goalReviewUtils.js`, `SimpleDashboard.jsx`.

---

## Loop follow-ups

- **Offline runner coverage** — goal-block-on-stall and orient-bound-cap are
  unit-tested only; the offline eval runner can't drive the LLM loop
  deterministically.
- **Server-side `goalAgentService`** — kept as the offline fallback for `/plans`; the
  addon's own loop is now the primary path.
