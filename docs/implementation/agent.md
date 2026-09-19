# Simple — the platform, and where everything is documented

**This file is the orientation doc.** It says what Simple is, how the repo is laid
out, and which document owns which subject — so someone (or something) opening this
repo cold can find the right file without reading all of them.

**What is deliberately NOT here:**

- **No to-dos, roadmaps or open items.** Every piece of unfinished work lives in
  [`BACKLOG.md`](BACKLOG.md), in priority order. If you are looking for what to work
  on, that is the file.
- **No design records.** What each feature does and why it was built that way lives
  in the feature doc listed below, next to the code it describes.
- **No test-running instructions.** Those are in
  [`../../.github/copilot-instructions.md`](../../.github/copilot-instructions.md)
  (scope a run to the change; never sweep) and
  [`../../.github/instructions/testing.instructions.md`](../../.github/instructions/testing.instructions.md).

**Status markers used across the docs:** ✅ implemented · 🟡 partially implemented
(the seam exists; integration/UI/guardrail still open) · ⬜ not started. A marker in
a feature doc describes what shipped; the work still owed on it is in
[`BACKLOG.md`](BACKLOG.md).

---

## The repo, in one screen

Three independent surfaces plus the workspace plumbing around them:

| Path | What it is | Runs as |
|---|---|---|
| `frontend/` | The website and every Simple surface (`/net`, `/simple`, `/plans`, `/market`, `/talk`, `/all`, admin console) — React + Vite + Redux | Netlify |
| `backend/` | The API those surfaces call: auth, workspace items, marketplace, messenger, Stripe, S3, Bedrock/DeepSeek proxying | Render |
| `simple-addon/` | The Electron desktop agent that actually touches the user's PC — tool registry, permission gate, recorder, agent loop | Installed app (NSIS) |
| `docs/` | Everything in this folder — see [`../README.md`](../README.md) for the full index | — |
| `scripts/`, `netlify/`, `.github/` | Asset pipelines, the keep-warm function, CI + instructions | — |

The dividing line worth knowing: **the cloud has no PC tools and the addon has no
repo tools.** A `/net` message is routed to one or the other (see
[`NET_CHAT.md`](NET_CHAT.md) → *How `/net` chat messages are routed*), and neither
side can do the other's job by accident.

---

## Where things live

| Looking for | Read |
|---|---|
| **What is left to do, in order** | [`BACKLOG.md`](BACKLOG.md) |
| **The loop as it actually runs** — real control flow, every exit, how to read a console log | [`Simple_Loop_Behaviour.md`](Simple_Loop_Behaviour.md) |
| The loop as it was *designed* (state machine, endpoints, knobs) | below, *The agent loop* |
| Threat model, trust boundaries, permissions, the safety surfaces the product exposes | [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) |
| Backend, data-layer and script audit passes (dated findings) | [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) → *Backend, data-layer and script audit passes* |
| Marketplace — publish, install, trust, `/market` | [`MARKETPLACE.md`](MARKETPLACE.md) |
| `/net` chat — routing, the repo agent, people in the rail | [`NET_CHAT.md`](NET_CHAT.md) |
| Which cloud model runs, and which one is the default | [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md) |
| Goals — dream board, map, horizon, review pass, live console, vision boards | [`GOALS.md`](GOALS.md) |
| Talk — the messenger, its storage, encryption and limits | [`TALK.md`](TALK.md) |
| Member pages — `/u/<username>`, visibility, blocking | [`PROFILES.md`](PROFILES.md) |
| The routing manifest, `/all`, the header dropper | [`PAGES.md`](PAGES.md) |
| Support tickets & bug reports | [`SUPPORT_TICKETS.md`](SUPPORT_TICKETS.md) |
| The admin "Special" tag and the views it grants | [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) |
| How every page should look — theming, sizing, the page template | [`../guides/FRONTEND_UI_STANDARD.md`](../guides/FRONTEND_UI_STANDARD.md) — with [`UI_LAYOUT.md`](../guides/UI_LAYOUT.md), [`UI_COMPONENTS.md`](../guides/UI_COMPONENTS.md), [`UI_DESIGN_RECORDS.md`](../guides/UI_DESIGN_RECORDS.md) |
| What we sell, to whom, the tiers, and the funnel | [`../guides/BUSINESS.md`](../guides/BUSINESS.md) |
| Uploads, S3/CloudFront, image generation | [`../guides/ASSETS.md`](../guides/ASSETS.md) |
| Deployment, secrets & config, traffic analytics | [`../guides/OPERATIONS.md`](../guides/OPERATIONS.md) |
| The colour scheme, the brand mark | [`../guides/FRONTEND_UI_STANDARD.md`](../guides/FRONTEND_UI_STANDARD.md) → *How theming works*, [`../guides/LOGO_SYSTEM.md`](../guides/LOGO_SYSTEM.md) |
| **Building or repairing a canvas game** — architecture, the two-layout system, testing, saved progress + leaderboards | [`../guides/GAME_GUIDE.md`](../guides/GAME_GUIDE.md) |

---

## What Simple is

A **consumer PC automation platform**: any user can show a task once (mouse,
keyboard, webcam, mic, screen) and the system generalizes it into a reusable, robust
"skill" they can then share through a public marketplace. The pitch is "recording a
Loom, except the result is a robot that can do the thing for you."

**Audience:** general consumers, but the first wedge is **enthusiast/tinkerers** —
the fastest path to the first paying users — growing into solo professionals as the
product gets more reliable. Don't market to "everyone".

**Platform:** Windows only for v1 (the addon depends on PowerShell/UIA/Win32).
Distribution is an NSIS installer plus the companion web surfaces.

### Three flows that feed each other

- **Demonstration → generalized skill.** The user performs the task; the recorder
  (`simple-addon/server/automation/recorder/`) captures it, and the compiler
  generalizes it. The design of the generalization work list (LLM re-derivation,
  then parameter inference) is recorded in
  [`../archive/SIMPLE_MARKETPLACE_PLAN.md`](../archive/SIMPLE_MARKETPLACE_PLAN.md) —
  it is the only write-up of that design.
- **Natural language / agent-driven.** The user describes a goal in text or voice,
  and the loop plus tool registry plan and execute it, optionally invoking a
  matching skill (`findRelevantSkills`).
- **Proactive observation → one-tap suggestion.** The agent notices a repeated
  pattern (`pattern-learner.js`, `predictor.js`) and offers to automate it. No
  recording, no scripting — this is the differentiator from macro recorders.

Agent runs are recordable, recorded skills are searchable, and noticed patterns
become skills the user can confirm, edit and share.

### The four modes (one agent, escalating trust)

| Mode | What it does | Guardrails | Trigger |
|---|---|---|---|
| **Watch** | Observes and reports — never acts. "Tell me when the printer dialog appears." | Read-only; notification only | User-set monitor |
| **Suggest** | Spots repeated patterns and proposes one-tap automations. | Nothing runs without a click | `pattern-learner.js` confidence |
| **Assist** | Runs a skill on demand (voice / NL / shortcut) with per-step permission, dry-run-first, and visual repair (`tools/skill.js` `repairStep`). | Per-category/tool approval | User command |
| **Autopilot** | Runs scheduled or trigger-driven automations unattended under the saved permission profile. | Explicit opt-in per skill + global kill switch | Schedule / event trigger |

**Design rule:** a skill can never silently jump up a mode. Suggest → Assist →
Autopilot is always an explicit user action.

**Status:** the ladder is surfaced on `/simple`
(`components/Simple/AgentModes/AgentModes.jsx`), and the current mode is *derived*
from the live permission state rather than stored — `continuousMode` +
`autoApproveAll` = Autopilot, `continuousMode` = Suggest, neither = Assist, and
`globalKillSwitch` overrides everything as **Paused** — so the ladder can never
disagree with what the addon actually permits. **Watch** is shown but not
selectable: read-only monitoring is a per-monitor posture, not a global permission,
and a toggle that enforces nothing would be dishonest.

### Why users choose it

- **No scripting** — describe it or demonstrate it; the agent works out the steps.
- **Watches and learns** — suggestions from observed behaviour, not just macros.
- **Acts, doesn't just explain** — the chat is wired to the same agent that can act.
- **Local-first, cloud-assisted** — automation runs on the user's machine; the cloud
  is for sync and AI metering, not a dependency for running skills.

---

## Architecture

**Keep the existing stack.** Electron + Node in `simple-addon/`, Python subprocesses
for ML (Whisper STT, MediaPipe eye tracking, webcam/vision), React + Vite on the web,
Express on the backend. Do not rewrite it.

**Cloud-first AI with a local option.** Cloud models are proxied through the
portfolio backend (AWS Bedrock, plus DeepSeek) behind one small provider interface,
so a local model can be swapped in. Which models exist, which one is the default, and
how a user's choice is remembered: [`LLM_PROVIDERS.md`](LLM_PROVIDERS.md).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INPUT (Perception): Webcam · Audio/Mic · Screen · Key/Mouse                │
│                          → PERCEPTION BUS (perception-bus.js)               │
├─────────────────────────────────────────────────────────────────────────────┤
│  INTERPRETATION: Vision (multimodal LLM) · Audio (Whisper) · Predictor      │
├─────────────────────────────────────────────────────────────────────────────┤
│  SYNTHESIS: AGENT LOOP (Observe → Orient → Goal → Plan → Action)            │
│             Voice · NL Macro Compiler · Vision-Action Predictor             │
├─────────────────────────────────────────────────────────────────────────────┤
│  OUTPUT: shell_run · fs_write · uia_invoke · input_tap · browser_* · skill_run│
└─────────────────────────────────────────────────────────────────────────────┘
```

### Current state (shipped)

The end-to-end loop **signed-in user → cloud memory → local PC actions** works.

| Area | Files |
|---|---|
| Per-user workspace memory (memory/project/agent/skill/goal/action/log/decision) | `backend/controllers/workspaceController.js`, `backend/services/workspaceContext.js` |
| Workspace REST API mount | `backend/routes/routeData.js` (`/api/data/csimple/workspace/*`) |
| Electron addon + tray / local server | `simple-addon/main.js`, `simple-addon/tray.js`, `simple-addon/server/index.js` |
| Tool registry + permission gate | `server/automation/tool-registry.js`, `server/automation/permissions.js` |
| Agent loop (Observe → Orient → Goal → Plan → Action) | `server/automation/agent-loop.js` — see *The agent loop* below and [`Simple_Loop_Behaviour.md`](Simple_Loop_Behaviour.md) |
| Recorder + skill compiler/runner | `server/automation/recorder/*`, `server/automation/tools/skill.js` |
| Perception / UIA / browser / OCR tools | `server/automation/tools/*`, `server/automation/perception*.js` |
| Cloud audit + workspace client | `server/automation/workspace-client.js` |
| Live web panel + chat `/run` `/agent` | `frontend/src/components/SimpleAddon/*`, `SimpleChat.jsx` |
| Eval harness | `server/automation/eval/` |

### Driving a website the user is signed into (2026-09-18)

The `browser_*` tools exist (`tools/browser.js`, `playwright-core`, Edge by
default), and for a task on a site with no login they work as they are. For a site
the user is **signed in to** — webmail, a chat app, a dashboard — three things had
to change, and a real request failed on all three at once:

> *"google message my girlfriend that I love her — I am already signed into google
> message on microsoft edge"* → `🤖 Agent stopped — stalled (stalled).`

| Problem | Why it stalled | Fix |
|---|---|---|
| The session was our OWN fresh profile | `launchPersistentContext(%APPDATA%\simple-addon\playwright-profiles\default)` starts empty, so their Google session was invisible and the page that loaded was a sign-in / device-pairing wall | `browser_open({ attach: true })` — `connectOverCDP` to the browser they are *already* signed into |
| It was headless | `headless: headless !== false` on every call, so nobody could have signed in either | the wall explanation names it and says to reopen with `headless:false` |
| Nothing DETECTED the wall | `browser_goto` returned `{status: 200, title}` — which reads as success — so the agent hunted for selectors that do not exist, each costing a 15 s timeout, scoring no progress until it stopped | `wall` + `wallExplanation` on `browser_goto`/`browser_status`, from `browser-session.classifyPageWall` |

And one capability was simply missing: **`browser_fill` does not submit.** A chat or
search box is committed with Enter, and there was no way to press a key — so "type a
message and send it" could not be expressed with the tools that existed, and no
amount of retrying would have closed that gap. `browser_press` is that primitive.

⚠️ **The attach route needs a specific launch**, because Chrome/Edge ≥136 ignore
`--remote-debugging-port` when the *default* profile directory is in use — so the
obvious command silently does nothing and looks like our bug:

```
msedge.exe --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\simple-addon\edge-automation"
```

That profile is also what makes it work: the user signs in **once** in the window it
opens, and every later run reuses it. `launchHint()` returns exactly this, including
the reason — a tool that says "could not attach" with no command is another stall.

⚠️ An attached session is **detached, never closed** (`browser_close`): calling
`close()` on a CDP connection shuts down the user's own browser, tabs and all. A
tool may not do that to a browser it did not start.

The agent's system prompt now carries rules 12–15 covering this: drive sites with
`browser_*` rather than guessing coordinates, use `attach` for signed-in sites, STOP
on a wall and relay what it says, and ask for a missing detail (a contact's real
name) early instead of clicking around the wrong page.

### Verifying before an irreversible action — `user_confirm` (2026-09-18)

The same request that exposed the browser gaps also asked for something no tool
could do: *"Dakota is my girlfriend … **please verify before sending the message**."*

- **`goal_ask_user` cannot gate anything.** It writes the question into the goal,
  marks it `blocked`, and RETURNS — the run carries on without an answer.
- **The permission gate asks about a TOOL, not the content.** "May I run
  `browser_press`?" cannot show *about to send “I love you” to Dakota*.
- And there is no undo. A sent message is sent.

So `user_confirm` (`tool/user-confirm.js`) blocks on the same approval prompt the user
already answers tool permissions in, and returns only when they have answered. It is
the one tool that trades a pause for certainty, on exactly the actions where being
wrong is not recoverable: sending a message or email, posting, submitting a form,
buying, deleting.

Three things about it are deliberate:

| Decision | Why |
|---|---|
| **`autoApproveAll` does NOT satisfy it** | A blanket "stop asking me about tool permissions" is a different promise from "I want to check this message before it is sent". Honouring the flag here would defeat the only thing the call is for. |
| **No prompt available ⇒ REFUSAL** (`unavailable: true`) | The caller is about to do something irreversible, and "nobody could be asked" is not a yes. It fails closed. |
| **Refusal is prefixed `Denied:`** | Every consumer decides "did this work?" from the prefix (`AUTOMATION_SECURITY.md`). A bare sentence would be counted as SUCCESS — and here that would read as *the user approved*, the worst possible way to be wrong. |

The relay path bounds it with the same deadline as any other prompt (110 s, under the
cloud's 120 s), so an unanswered confirmation becomes a definite refusal rather than
an unknown. The content being confirmed is human text the user has not sent yet, so
`user_confirm` is on the `PII_TOOLS` list — the prompt the user reads comes from the
approval QUEUE (raw, deliberately), while the event stream reports nothing, the same
split `text_type` already relies on.

The system prompt's rules 16–17 pair with it: confirm before anything irreversible
and never report something as sent unless it returned `approved:true`; and if a call
fails, the next attempt must be DIFFERENT — two identical failures mean the plan is
wrong, not that it needs a third try. That second rule was written from a real trace:
three identical `window_focus` calls, each `window not found`, until the stall
detector stopped the run.

---

## The agent loop (as designed)

The loop is an explicit **Observe → Orient → Goal → Plan → Action** cycle with a
critic and meta-learning. **This is the design; the code is the source of truth, and
in several places the code does not implement the design.**

> ⚠️ Read [`Simple_Loop_Behaviour.md`](Simple_Loop_Behaviour.md) before changing the
> loop or concluding anything from a driven run. It is read out of the code: the real
> control flow, every exit condition, how to decode a console log, and a table of the
> gaps. The three that surprise people most: `selectGoal()` never picks a goal (it
> re-reads the current one and resets a counter), `critic.score()` measures
> success/failure and *not* progress (so a useless-but-successful tool never trips the
> stall detector), and `start({dryRun})` is inert.

**Three nested loops**

| Loop | Cadence | Stages | Purpose |
|---|---|---|---|
| Inner | per action (~seconds) | Observe → Orient → Plan → Action | Fast progress; goal held fixed |
| Outer | per goal re-eval (every N steps / T minutes) | + Goal | Re-derive or abandon intent |
| Meta | per session/day | Critic over the action log | Learn skills, drop dead policies |

**State machine**

```text
IDLE → OBSERVING → ORIENTING → SELECTING_GOAL → PLANNING → ACTING → REFLECTING
                                              ↑_______________↓        (inner loop)
                          └─→ BLOCKED ─→ (wait / new goal) ─────────┘
IDLE ← DONE / FAILED / STOPPED (kill switch)
```

Every transition is observable in `GET /api/agent/status`. Stages:

- **Observe** — sensors (screen, UIA, audio, gaze, keyboard patterns) fuse into a
  `Frame`; the last action's outcome is part of the next frame.
- **Orient** — a bounded, priority-ordered situation block (perception → recent
  actions → goals → lessons → suggestions), capped at `ORIENT_CAP_BYTES`; drift
  detection (token-set Jaccard similarity over the *semantic* parts) sets `drifted`.
- **Goal** — cadence-gated re-eval: `refreshGoalStatus()` runs every tick
  (terminal-status + stall check, never cadence-gated); `selectGoal()` re-derives
  intent on cadence/drift and can emit `blocked`/`done`/`abandoned` (self-block gated
  by `autoAbandon`, default false).
- **Plan** — choose a concrete tool call or `idle`.
- **Act** — execute the tool; record the outcome.
- **Reflect / Critic** — `critic.js` scores the action (−1..1), writes an idempotent
  `lesson` workspace item on failure, and injects lessons into the next Orient block.

**Additive goal fields** (`workspaceController.js`): `nextReevaluateAt`, `stallCount`,
`lastOutcomeDelta` (−1..1), `autoAbandon` (bool), `maxSteps` (int).

**Workspace kind `lesson`** — written by the critic, read by Orient as semantic
memory: `{ kind:"lesson", slug:"lesson-<hash>", content:{ pattern, context, do, avoid, confidence, sourceGoal } }`.

**Endpoints**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agent/status` | `stage`, `loop` (inner/outer/meta), `stallCount`, `lastLesson` |
| `POST` | `/api/agent/start` | accept `goalSlug` + optional `{maxSteps, autoAbandon}` |
| `POST` | `/api/agent/block` | mark current goal `blocked` with a reason |
| `GET` | `/api/agent/lessons?goal=<slug>` | read critic lessons |
| `DELETE` | `/api/agent/worker/:goalSlug` | stop a worker |

**Configuration knobs** (in `agent-loop.js` defaults): `ORIENT_CAP_BYTES`,
`EPISODIC_WINDOW`, `LESSON_TOPK`, `REEVAL_STEPS`, `REEVAL_MS`, `DRIFT_THRESHOLD`,
`IDLE_SLEEP_MS`, `STALL_THRESHOLD`, `MAX_STEPS_DEFAULT`, `META_EVERY_ACTIONS`,
`SKILL_PROMOTE_MIN_REPEATS`.

---

## Safety & permissions

Do not weaken these to make onboarding smoother: category-based approval, the shell
allow/deny list, protected-path blocking, the `globalKillSwitch`, and dry-run-first
all stay. The permission model is the product's floor — every downloaded marketplace
skill runs through it regardless of what the skill claims.

What the product exposes to a user (what gets scrubbed before publishing, the pre-run
capability summary, cloud-vision consent) and the remaining gaps are in
[`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md).

---

## Dogfooding: sign in and click around

**Agents working in this repo are welcome to sign in to the shared demo account and
use the real UI + APIs.** Use **"Continue as Guest"** on `/login`, or the credentials
`guest@gmail.com` / `guest` (see `backend/constants/guestAccount.js`).

- Prefer it over inventing throwaway accounts — it already holds workspace items
  (goals, plans, actions, notes), so list / filter / sort / empty states get exercised
  for real instead of only in theory.
- It is a **shared, public** account: assume anything you write is visible to
  everyone. Treat test data as disposable, **delete what you create when you're
  done**, and never put real secrets, tokens, or personal data in it.
- It is deliberately **excluded from paid/powerful paths** — don't rely on it for
  credit-gated cloud LLM calls, and the `repo_*` tools need a real admin session.
- It's the account the read-only image-gen smoke test uses
  (`docs/guides/ASSETS.md`), so leaving junk behind
  degrades that test too.

---

## Non-goals for this phase

- No cross-platform (Mac/Linux) support yet.
- No manual marketplace moderation/review queue.
- No enterprise/B2B features (SSO, team management, audit export) — consumer product.
- No fixed deadline — ongoing, iterative build, structured as the prioritized
  [`BACKLOG.md`](BACKLOG.md).

---

**Companion docs:** [`BACKLOG.md`](BACKLOG.md) — everything still to do, in order.
[`Simple_Loop_Behaviour.md`](Simple_Loop_Behaviour.md) — what the loop actually does at
runtime. [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) — threat model, trust
boundaries, permissions, and the audit passes. [`../README.md`](../README.md) — the
full docs index.
