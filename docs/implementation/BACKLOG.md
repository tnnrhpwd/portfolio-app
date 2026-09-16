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
- ⬜ **Existing Pro subscribers** — tell them plainly what works and what doesn't.
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

Three pieces of work specified alongside the console pass and deliberately **not**
built in it. The decisions are recorded here because they were made once, in
conversation, and are expensive to re-derive.

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

### E3 — The cloud run with local hands

Decision: **the cloud run dispatches individual tool calls to the connected addon**
and feeds the results back to the model — not "cloud enqueues the goal and the addon
runs the whole loop".

- The transport already exists: `addonRelayController.js` (`POST /addon/command`,
  `GET /addon/pending`, `POST /addon/result/:id`, heartbeat + device registry,
  5-minute command TTL) and `simple-addon/server/cloud-relay.js` (polls, executes,
  posts back). Today it carries whole commands (`chat`, `confirm`, `agent`).
- New: a `tool` command kind carrying `{tool, args}`; `cloud-relay` executes it
  through the tool registry — so the permission gate, kill switch, dry-run and
  approval queue all still apply — and posts `{ok, result, error}` back. The cloud's
  `goalAgentService` gains the addon's tool schemas plus a `call_local_tool` path
  that enqueues and polls.
- **Non-negotiables:** a cloud-originated call is gated exactly like a local one and
  must never bypass `permissions.requestApproval`; a kill-switch or `deny` result
  comes back as an ordinary failed call; an approval raised while the cloud waits
  surfaces on `/simple` and in the tray.
- Files: `backend/controllers/addonRelayController.js`,
  `backend/services/goalAgentService.js`, `simple-addon/server/cloud-relay.js`.

---

## Loop follow-ups

- **Offline runner coverage** — goal-block-on-stall and orient-bound-cap are
  unit-tested only; the offline eval runner can't drive the LLM loop
  deterministically.
- **Server-side `goalAgentService`** — kept as the offline fallback for `/plans`; the
  addon's own loop is now the primary path.
