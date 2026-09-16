# Simple's loop — what it actually does

Read out of the code on **2026-09-16** (`HEAD fc87533`), not out of the plan.
[`agent.md`](agent.md) → *The agent loop* describes the loop as it was *designed*; this file
describes the loop that **runs**. Where the two disagree, the disagreement is
written down (§7) instead of smoothed over — the whole point of this file is that
a driven run should be predictable from reading it.

Everything below is traceable to
`simple-addon/server/automation/agent-loop.js` unless another file is named.
Functions are named rather than line-numbered because the file moves.

---

## 1. What starts a run

Three ways in, all of which end at `AgentLoop.start()`:

| Trigger | Path | Goal chosen by |
| --- | --- | --- |
| Tray **Start**, dashboard **Run**, chat *enlist* | `POST /api/agent/start` (`automation/index.js`) | `{goalSlug}` if given, else `wsClient.getNextGoal()` |
| **Suggest** mode on `/simple` | mode ladder → `continuousMode: true` → `ContinuousListener` → `_maybeStartIdleLoop()` → `startLoop(null)` | `wsClient.getNextGoal()` |
| A cron / file / hotkey trigger targeting a goal | `triggers.js` → `_getOrCreateLoop(slug).start({goalSlug})` (pool, max 3 concurrent) | the trigger's slug |

Two consequences that are easy to miss:

- **Suggest mode is a "go" button for the whole queue.** `SimpleDashboard.applyMode`
  → `setAgentListener(true)` → `POST /api/agent/listener` →
  `ContinuousListener.setEnabled(true)`, whose `_startTimer()` runs **one tick
  immediately**. That tick's `_maybeStartIdleLoop()` starts `getNextGoal()` —
  whatever the highest-priority active goal happens to be — *without naming it*.
  Nothing on `/simple` asks "start working on *this*?"; the mode switch is the run.
- **`getNextGoal()` is the only place a goal is chosen.** Once a run has a goal,
  nothing in the loop ever compares it against another goal, re-ranks, splits, or
  swaps it.

Before the loop body, `start()` runs an optional planner pass
(`planner.js` → `shouldPlan(goal)` → `planGoal()`); if it created children, the
loop re-fetches `getNextGoal()` and works the highest-priority child instead.
Planner failure is logged and ignored.

---

## 2. The loop body

`_runLoop()` is a `while` over two conditions: `state.running` and
`state.step < state.maxSteps`.

Per iteration, in this order:

1. **`_publishGoal()`** — emits `agent.goal` once per goal slug (not per step).
2. **`_setStage('SELECTING_GOAL')`** — *every* iteration. This is the console's
   `stage → picking a goal (outer loop)`.
3. **Goal check** — `_shouldReevaluate() ? selectGoal() : refreshGoalStatus()`.
   Both branches are described in §3.2; the short version is that they do the same
   work, and the cadence-gated branch additionally resets the cadence counter.
4. **`tick()`** — `observe → orient → plan → act → reflect` (§3.3).
5. **Sleep** — `STEP_DELAY_MS` (400 ms) after an acting tick, `IDLE_SLEEP_MS`
   (2500 ms) after an idle tick.
6. **Meta loop** — every `META_EVERY_ACTIONS` (50) steps,
   `_runMetaReflection()` (§3.4).

`observe()` performs a workspace-context fetch, a skill list, and a perception read
**on every tick**, on top of the planning LLM call — so the real cadence is one LLM
round-trip plus ~400 ms plus the tool's own duration (the driven run averaged
~2.5 s/step, most of it the LLM).

**`step` counts ticks, not actions and not model turns.** It is incremented at the
top of `observe()` (`this.state.step++`), so `agent.step` and `step 7/60` mean "the
seventh pass through the stages".

---

## 3. What each stage does

### 3.1 `observe()` — OBSERVING

- `step++`, `stepsSinceReeval++`, `lastTick = now`.
- Publishes `agent.step` (with `maxSteps`) and, at the end, `agent.observe`
  (`contextBytes`, matching `skills`, `hasPerception`).
- Collects the tool schemas offered to the model, the workspace context string
  (network, every tick), skill hints (local cache + workspace listing, scored by
  token overlap with the goal), and the latest perception frame.
- Returns a `Frame`. **No LLM call.**

### 3.2 `refreshGoalStatus()` / `selectGoal()` — SELECTING_GOAL

`refreshGoalStatus()` runs **every tick**:

1. `GET` the goal. Terminal if it is missing or its status is
   `done | failed | paused | blocked`.
2. Otherwise replace the in-memory goal with the fresh copy.
3. **Stall check:** if `stallCount >= STALL_THRESHOLD` (3) → terminal `stalled`.
   If the goal has `autoAbandon === true`, it also PATCHes the goal to `blocked`
   and emits `goal.blocked`; otherwise it only emits `goal.stalled` and the goal
   stays `active`. Either way **the run ends**.

`selectGoal()` calls that same function, then resets `stepsSinceReeval = 0` and
`nextReevaluateAt = now + REEVAL_MS` (5 min). It does nothing else: **it does not
pick, rank, split, swap, or abandon a goal.** `_shouldReevaluate()` decides only
*which of the two* runs (cadence: 8 steps, or 5 minutes, or orient drift).

Because `start()` seeds `stepsSinceReeval = REEVAL_STEPS`, the **first** iteration
always takes the `selectGoal()` branch — which is why every run's first console
line is `stage → picking a goal`.

### 3.3 `tick()` — ORIENTING → PLANNING → ACTING → REFLECTING

**`orient()`** — recalls episodic actions (last `EPISODIC_WINDOW` = 20),
lessons (a pool of `max(LESSON_TOPK * 4, 12)` ranked by token overlap via
`critic.recall`), and pattern-learner suggestions. Assembles a situation block of
five labelled parts, in priority order:

| Priority | Part | Source |
| --- | --- | --- |
| 1 | `CURRENT PERCEPTION` | latest perception frame |
| 2 | `RECENT ACTIONS` | workspace action log |
| 3 | `GOALS & CONTEXT` | workspace context (includes the goal list) |
| 4 | `LESSONS` | critic lessons |
| 5 | `SUGGESTIONS` | pattern learner |

Under `ORIENT_CAP_BYTES` (12288) the **lowest** priority part is dropped first, so
the order of loss is suggestions → lessons → goals & context → recent actions; the
perception part is only ever truncated when it alone exceeds the cap. Note that the
perception string is then passed into the prompt **twice** — once inside the
bounded block and again as `buildSystemPrompt`'s own `CURRENT PERCEPTION` section.

Drift is computed over the priority ≥ 2 parts only (Jaccard similarity of the
token sets; similarity below `1 - DRIFT_THRESHOLD` = drifted), so a changing screen
does not register as goal drift.

Then `plan()`'s prompt is built: `buildSystemPrompt()` — goal title, horizon,
success criteria, constraints, content, a 11-point `RULES` list, the tool names,
skill hints, perception, and the situation block — plus a one-line tick prompt
(`Begin. What is your first action?`, then `Continue… Use a tool, or finalize with
goal_update + "<<GOAL_DONE>>"`).

**`plan()`** — one `llm.chat()` call:

- `temperature 0.2`, `maxLength 800`, `tool_choice: 'auto'`,
  `tools: <all registry schemas>`;
- `conversationHistory: history.slice(-12)` — **the last 12 messages only**,
  i.e. roughly the last 6 ticks, since every acting tick pushes an assistant turn
  *and* a tool turn;
- publishes `agent.thought` (the model's own text, sentinel stripped, clipped to
  500 chars) with `willCall: [tool names]`;
- pushes the assistant turn into history;
- returns `{type:'llm-error'}` on a thrown LLM call — see §4.

No tool calls **and** no `<<GOAL_DONE>>` → `{type:'idle'}`, which skips ACTING and
takes the long sleep.

**`act()`** — for each tool call: parse `arguments` (a JSON parse failure silently
becomes `{}`), `registry.executeTool(name, args, ctx)` (the permission gate lives
in there), then push a compact tool turn into history:

```js
JSON.stringify({ ok, result|error, mode, durationMs }).slice(0, 1200)
```

`stepLog` keeps a 300-char result per tool, `runSteps` keeps `{tool, args}` for the
skill draft, and `ctx.addAction` records the full record to the workspace action
log. Only one loop's worth of context exists per run (`this._toolCtx`), so
everything in a run shares one `goalSlug`.

**`reflect()`** —

- `<<GOAL_DONE>>` in the reply → stores the text before the sentinel as
  `finalAnswer` and stops the run.
- Otherwise `critic.score({predicted, actual})` → `delta`, then
  `delta <= 0 → stallCount++` else `stallCount = 0`.
- `delta < 0` → `critic.writeLesson()` writes one idempotent lesson (slug hashed
  from the failure pattern).
- Every `REFLECT_EVERY` (5) steps → a **second LLM call** asking for a six-line JSON
  reflection, which is **appended to the goal's own `content`** and persisted:

  ```text
  [reflection 2026-09-16T09:48:34.000Z] {"title":…,"progress":…,"blockers":…,"next":…}
  ```

  A long run therefore grows the text of the goal it is working on, which is part
  of the context it re-reads every tick.

### 3.4 `_runMetaReflection()` — every 50 steps

Fetches the recent action log, asks the LLM for one paragraph ("what it did, what
is working, what it should stop doing"), appends it to the daily workspace log as
`[agent meta] …`, publishes `agent.meta`, and fires `requestGoalReview(false)`
fire-and-forget (the `/simple` review panel's data, TTL'd server-side).

---

## 4. Every way a run ends

| Exit | Reached by | Side effects |
| --- | --- | --- |
| **Stopped** | `stop()` — `/api/agent/stop`, tray, `/simple` Stop | `stopReason 'manual'`; nothing else is written |
| **Goal no longer workable** | `refreshGoalStatus()` sees `done`/`failed`/`paused`/`blocked`, or the goal is gone | none |
| **Stalled** | `stallCount >= 3` | `goal.stalled`; plus `status: blocked` on the goal **only if** `autoAbandon === true` |
| **Done** | `<<GOAL_DONE>>` in the model's reply | goal set to `done`; `agent.reply` + `goal.done`; a skill draft is built from `runSteps` (needs ≥ 2 successful steps) and **surfaced, never saved** — saving is a separate consented call |
| **Budget exhausted** | `step >= maxSteps` (`min(100, max(1, opts.maxSteps \|\| goal.maxSteps \|\| 60))`) | **the goal is marked `failed`** and `goal.failed` is emitted |
| **LLM unreachable** | `plan()` throws | **not an exit.** The tick returns and the loop retries next tick, burning a step each time — a sustained outage therefore consumes the whole budget and ends in "budget exhausted", i.e. the goal is marked `failed` |
| **Crash** | anything thrown inside `_runLoop` | caught at the `start()` call site and logged as `[agent] loop crashed:`; the run is not resumable |

At the end of every run `_setStage('IDLE')` emits `agent.stage {stage:'IDLE'}`
followed by `agent.stopped`. **The trailing `stage → idle` line means the run has
finished, not that it is waiting** — the loop never idles at the end of its life.

The kill switch is enforced per tool call (inside `permissions.effectiveMode`), not
by the loop: a run with the kill switch on keeps stepping and every tool call comes
back denied.

---

## 5. Reading the console

The `/simple` console (`AgentTerminal.jsx`) reads the addon's SSE stream. One tick
publishes, in order:

```text
agent.stage   SELECTING_GOAL  (outer)   ← every tick
agent.stage   OBSERVING       (inner)
agent.step    step N/maxSteps           ← the tick counter
agent.observe contextBytes, skills, hasPerception
agent.stage   ORIENTING       (inner)
agent.stage   PLANNING        (inner)
agent.thought <model's own words>  → willCall: [...]
agent.stage   ACTING          (inner)
tool.start / tool.end  per call         ← ▶ / ✓ with duration
agent.stage   REFLECTING      (inner)
```

`_setStage()` publishes only on a *change* of stage, and stage labels come from
`STAGE_LABELS` in `agentTerminalUtils.js` (`SELECTING_GOAL → picking a goal`,
`IDLE → idle`, …).

Decoding the run that prompted this file — 10 ticks, one tool each, ended by hand:

| Seen | Means |
| --- | --- |
| `stage → picking a goal (outer loop)` at 09:48:22, 25, 27, 29 … | one per tick. On tick 1 it took the `selectGoal()` branch (cadence); the rest took `refreshGoalStatus()`. Nothing was picked, in either case. |
| `· step 1 … step 10` | ticks, not tools. `observe()` counted them. |
| `▶ screen_capture` / `✓ screen_capture 387ms` | `tool.start` / `tool.end` from the registry. `safe-read` defaults to `allow` (`permissions.js` `DEFAULTS.categories`), which is why no approval line appears. |
| no `agent.goal`, no `agent.observe`, no `agent.thought` | **the running addon predates them — see §6.1** |
| `stage → idle` then `■ stopped — user requested stop` | the loop exited because the user pressed Stop. Nothing in the loop had decided the run was pointless. |

---

## 6. Why a run can spend its whole budget on `screen_capture`

This is the question the log asks, and the code answers it in six parts. They are
independent; any one of them alone would not produce this behaviour.

1. **The stall detector is a *failure* detector, not a *progress* detector.**
   `critic.score()` looks only at `ok`/`error`: all tools ok → **+0.5**, partial →
   −0.5, all failed → −1, no calls → 0. `reflect()` then does
   `delta <= 0 → stallCount++`, `else stallCount = 0`. `screen_capture` succeeds
   every time, so `stallCount` is **reset to zero on every tick** and can never
   reach `STALL_THRESHOLD`. The "stalled after N consecutive no-progress ticks"
   message actually means "N consecutive **failed** ticks". Ten successful
   screenshots are ten ticks of measured "+0.5 progress".
2. **The agent cannot see the screenshot.** `plan()` calls `llm.chat()` — text
   only; nothing in the loop is multimodal (`chatMultimodal` exists on the provider
   seam and is never called by the loop). `act()` then hands the model
   `JSON.stringify({ok:true, result:{mime,bytes,base64}}).slice(0,1200)` — i.e.
   ~1200 characters of truncated base64. The observation channel is
   `ok:true, 387ms`; the picture never reaches the model, so capturing one teaches
   it nothing and repeating the capture is not obviously irrational from inside the
   loop.
3. **`screen_capture` is free and always allowed.** Category `safe-read`,
   default mode `allow`, no approval, no cost, and `RULES` in
   `buildSystemPrompt` only *asks* it not to spam captures ("use sparingly" is in
   the tool description too). No code scores, throttles, or dedupes repeated
   identical calls.
4. **Nothing checks whether a tool can advance the goal.** The tick prompt
   requires either a tool call or the done sentinel; there is no score for
   "plausibly-progress-making", and no branch that concludes "this goal has no
   actionable next step — stop and ask the user". A model with nothing useful to do
   still has to pick something legal.
5. **The model's own repetition is invisible to it.** History is sliced to the last
   12 messages in `plan()` — about the last 6 ticks — so by tick 7 the earlier
   screenshots have fallen out of the conversation.
6. **The situation block loses the goal before it loses the perception.** Under
   `ORIENT_CAP_BYTES`, `GOALS & CONTEXT` is priority 3 and `CURRENT PERCEPTION` is
   priority 1, so an oversized situation pushes the goal text out first.

### 6.1 Why the console showed less than §5 describes

`agent.goal`, `agent.observe` and `agent.thought` were added in **`fc87533`
(2026-09-15)**, which is in **no released addon build**: `git tag --contains
fc87533` is empty, the newest tag is `addon-v1.0.54`, and that tag does not contain
it. The addon that produced the log reports:

```json
{ "currentVersion": "1.0.53", "latestVersion": "1.0.54", "updateDownloaded": true }
```

So on that machine only `agent.stage`, `agent.step`, `tool.*` and `agent.stopped`
exist — which is exactly the log that was pasted. **Install the newer build (or run
the addon from this repo) before judging the console**: the three lines that were
added specifically to explain "what is it doing" have never been emitted on that
machine, and a `1.0.54` update is already downloaded and waiting.

---

## 7. Design vs code

`agent.md` → *The agent loop* is the design. These are the places the code does not implement it,
kept here so the next person does not read the design as a description of runtime.

| The design says | Code today |
| --- | --- |
| The outer loop "re-derives or abandons intent" and can emit `blocked`/`done`/`abandoned` | `selectGoal()` = `refreshGoalStatus()` + a cadence reset. Intent is derived once, in `start()`. Terminal outcomes come only from the backend's stored status, or the stall counter. |
| A goal re-eval happens on cadence | It *checks* on cadence, but the same check also runs on every other tick, so the cadence changes nothing except which of two identical calls is used. |
| Orient's drift "forces a re-eval" | Drift only routes into the same `selectGoal()`. |
| The critic scores the action and injects lessons into the next plan | The critic scores `ok`/`error` only, so a useless-but-successful run writes no lesson at all — and `stallCount` never moves (§6, item 1). Lessons are injected when their tokens overlap the situation. |
| "the last action's outcome is part of the next frame" | The last action's outcome is a 1200-char JSON slice in history. There is no image channel. |
| `start({dryRun: true})` | `state.dryRun` is set, logged, and reported by `status()` — and never forwarded into the tool context, so it has no effect. Real dry-run comes from the permission gate's `dryRunMode` or `ctx.forceDryRun`. |
| `SKILL_PROMOTE_MIN_REPEATS` is a configuration knob | Declared in `DEFAULT_CONFIG` and read nowhere. The n-gram → skill promotion it describes does not exist; `_buildSkillDraft()` is unconditional on repeat count (≥ 2 successful steps). |

---

## 8. What the loop cannot currently do

Ordered roughly by how much of the observed behaviour each one explains. This is
the upgrade list, not a backlog of opinions — each item names the missing
mechanism.

1. **See.** No multimodal call in the loop; `act()` truncates image results to
   garbage. Until this exists, `screen_capture` is a step that cannot inform the
   next one.
2. **Recognise no-progress.** `critic.score()` has no notion of novelty,
   usefulness, or repetition. A cheap first version: a delta of 0 (or negative) for
   a tool whose `(name, args)` is byte-identical to the previous tick's, and for a
   run whose situation block is unchanged.
3. **Refuse.** Nothing can conclude "this goal has no actionable next step".
   `goal_ask_user` exists as a tool the model *may* call; there is no loop-level
   rule that forces it after N identical ticks.
4. **Re-decide the goal.** `selectGoal()` cannot compare goals, split a container
   goal mid-run, or hand back a goal it cannot make progress on.
5. **Remember a run.** History is capped at 12 messages with no summarisation, so
   the loop's own transcript is not a durable artefact. (`stepLog` and the
   workspace action log are durable, but neither is fed back as history.)
6. **Stop cleanly on infrastructure failure.** An LLM outage burns the budget and
   ends with the goal marked `failed` — a data-quality bug, not just a cost one.
7. **Bound its own side effects.** The every-5-ticks reflection appends to the
   goal's `content` forever; nothing trims or versions it.

---

## 9. Driving and inspecting a run

| What | Where |
| --- | --- |
| Start (`{}` = next goal, `{goalSlug}` = that goal) | `POST /api/agent/start` |
| Stop | `POST /api/agent/stop` |
| Live state (`stage`, `loop`, `step`, `stallCount`, `lastOutcomeDelta`, `stepLog`) | `GET /api/agent/status` |
| Per-goal workers, stop one | `GET /api/agent/status` → `workers[]`, `DELETE /api/agent/worker/:goalSlug` |
| Mark the current goal blocked by hand | `POST /api/agent/block` |
| Critic lessons written by a run | `GET /api/agent/lessons?goal=<slug>` |
| Turn `autoAbandon` on for a goal (lets a stall write `blocked`) | `POST /api/agent/goal/:slug/auto-abandon` |
| The event stream the console reads | `GET /api/agent/events` (SSE; named types, ring of 500 in `events.js`) |
| The always-on listener | `GET`/`POST /api/agent/listener` |
| The mode ladder that enables it | `/simple` → `AgentModes` → `applyMode()` → `continuousMode` |

The loop lives in the addon's process, one instance per goal in a pool capped at
three, and it calls the LLM through the provider seam ([`LLM_PROVIDERS.md`](LLM_PROVIDERS.md)) (always proxied through
the portfolio backend with the user's JWT).

**Constants, as of this reading:** `DEFAULT_MAX_STEPS` 60 (`maxSteps` clamped
1–100), `REFLECT_EVERY` 5, `STEP_DELAY_MS` 400, `IDLE_SLEEP_MS` 2500,
`ORIENT_CAP_BYTES` 12288, `EPISODIC_WINDOW` 20, `LESSON_TOPK` 3, `REEVAL_STEPS` 8,
`REEVAL_MS` 300000, `DRIFT_THRESHOLD` 0.35, `STALL_THRESHOLD` 3,
`META_EVERY_ACTIONS` 50, `THOUGHT_MAX` 500, history window 12 (reflection 8),
`maxLength` 800.
