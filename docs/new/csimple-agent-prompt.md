# Project Brief: CSimple — Consumer PC Automation Platform

Give this document to your coding agent (Claude Code, etc.) as the starting spec. It expands on an existing codebase (`csimple-addon/`) rather than starting from scratch — read the existing code first before proposing changes.

### Table of contents

1. [Vision](#1-vision)
2. [Target user & platform](#2-target-user--platform)
3. [Core interaction model](#3-core-interaction-model)
4. [Marketplace](#4-marketplace--planned-no-backend-surface-built-yet) — ⬜ planned
5. [Skill generalization](#5-skill-generalization-priority-ordered-technical-roadmap) — 🟡 partial (5.1/5.2 shipped)
6. [Safety & permissions](#6-safety--permissions) — 🟡 partial (backend seams shipped, UI open)
7. [Architecture constraints](#7-architecture-constraints--stack-constraints-already-honored-llm-provider-seam-71-still--planned) — 🟡 partial (seam ⬜ planned)
8. [Monetization](#8-monetization--planned-no-requiresplanstripe-wiring-in-csimple-addon-yet) — ⬜ planned
9. [Non-goals for this phase](#9-non-goals-for-this-phase)
10. [Suggested first milestones](#10-suggested-first-milestones-prioritized-backlog-for-the-agent-to-refine)

---

## Status legend

- ✅ **Implemented** — landed in code with tests.
- 🟡 **Partially implemented** — backend seam exists, integration/UI/guardrails still open.
- ⬜ **Planned** — not yet implemented.

### Implementation snapshot (2026-07-16)

- ✅ Section 5.1 (LLM re-derivation) shipped.
- ✅ Section 5.2 (parameter inference) shipped.
- 🟡 Section 5.3 (vision re-targeting) shipped for key recovery paths; broader coverage/UI surfacing remain.
- ✅ Section 5.5 (eval harness) now supports HTTP scenarios (`eval/http-app.js` + `runner.js` HTTP mode), activating four previously-inert scenarios; perturbed-UI regression scenarios still open.
- 🟡 Section 6.1/6.2/6.3 backend seams shipped (scrub, capability summary, consent APIs); frontend confirmation UX remains.
- 🟡 Marketplace-adjacent telemetry seam exists (`/telemetry/summary` + `getTelemetrySummary`, ✅ shipped and aggregates real action-log data), but marketplace-specific counters (`downloads`/`installs`/`creations`) are still blocked on Section 4 backend work.

## 1. Vision

Turn the existing `csimple-addon` (currently a personal/dev-focused Electron+Node addon) into a **consumer-facing PC automation platform** where any user can:

1. **Show, don't tell** — demonstrate a task once (mouse, keyboard, webcam, mic, screen — any PC input) by just doing it normally.
2. Have the system **generalize** that demonstration into a reusable, robust "skill" — not a brittle exact-replay macro.
3. **Share and discover** skills through a public marketplace, so the community builds the automation library together.

The product should feel like "recording a Loom, except at the end you have a robot that can do the thing for you."

## 2. Target user & platform

- **Audience:** general consumers (not just developers/power users) — onboarding and UI must not require technical knowledge.
- **Platform:** Windows only for v1 (matches current addon's PowerShell/UIA/Win32 dependencies). Do not spend effort on cross-platform abstraction yet.
- **Distribution:** desktop installer (NSIS, as today) + a lightweight companion web frontend, similar to the current `sthopwood.com/net` integration pattern.

## 3. Core interaction model

Two complementary flows, both need to exist and interoperate:

- **Demonstration → generalized skill**: user performs a task once (or a few times) while the recorder captures mouse, keyboard, focus changes, screen state, etc. (see `server/automation/recorder/`). The compiler (`recorder/compiler.js`) currently does literal coalescing — this needs to become a *generalization* pipeline (see Section 5).
- **Natural language / agent-driven**: user describes a goal in text or voice, and the existing agent loop (`server/automation/agent-loop.js`) + tool registry (`server/automation/tool-registry.js`) plans and executes it directly, optionally invoking a matching skill if one exists (`findRelevantSkills`).

These two flows should feed each other: agent-loop runs should be recordable, and recorded skills should be describable/searchable in natural language for the agent to find and reuse.

## 4. Marketplace — ⬜ planned (no backend surface built yet)

> ⚠️ **Scope correction for the agent:** the marketplace is *not* just "extend the existing skill endpoints." Today's skill endpoints (`/api/data/csimple/workspace/skill/*`) store **private, per-user** items keyed `csimple_ws_{userId}_{kind}_{slug}`. The marketplace needs a **new shared/public namespace** with its own read path (anyone can discover) and controlled write path (publish/fork). Treat the private workspace skill store and the public marketplace as two distinct surfaces that a "publish" action bridges.

### 4.1 Data model (new backend surface)
- **Published skill record** (public, immutable per version): `marketId`, `authorUserId`, `name`, `slug`, `version` (semver), `steps` (scrubbed — see Section 6.1), `declaredCategories` (the tool categories the skill will invoke), `toolSchemaVersion`, `naturalLanguageDescription` (for search), `createdAt`.
- **Versioning + fork:** publishing a change creates a new immutable version; downloaders pin a version. A user can *fork* a published skill into their private workspace, edit, and re-publish under their own author id.
- **Ratings:** `{ marketId, version, raterUserId, stars (1-5), ranAt, outcome }` — one rating per user per version, only accepted from users who actually downloaded/ran it (prevents drive-by rating).
- **Counters (server-side, the KPI source):** `downloads`, `installs`, `creations` incremented atomically on the marketplace backend — NOT derived from the per-user JSONL action log.
- **Compatibility:** every published skill stores `toolSchemaVersion`. On download, the client compares against its own registry; if a referenced tool is missing/renamed, surface a "partially compatible" warning and degrade gracefully instead of hard-failing at run time (see Section 5.4).

### 4.2 API surface (extends `workspace-client.js`, new backend routes)

| Route | Purpose | Status |
|---|---|---|
| `POST /api/market/skills` | Publish skill (must run scrub + capability-manifest pre-check first) | ⬜ Planned |
| `GET /api/market/skills?q=<nl>&sort=trust\|downloads\|recent` | NL search + ranking | ⬜ Planned |
| `GET /api/market/skills/:marketId[/:version]` | Fetch a specific version | ⬜ Planned |
| `POST /api/market/skills/:marketId/install` | Increment `downloads`/`installs`, return installable scrubbed steps | ⬜ Planned |
| `POST /api/market/skills/:marketId/rate` | Submit run-gated rating | ⬜ Planned |
| `POST /api/market/skills/:marketId/flag` | Community flagging | ⬜ Planned |

### 4.3 Trust model
- **Reputation/rating-based, no manual moderation/code-review queue** (matches Non-goals).
- Ranking signal = rating × volume × author reputation (seeded from account age + prior skill ratings) × recency; community flags deprioritize.
- ⚠️ **Cold-start mitigation (design around it, don't skip):** a brand-new skill has zero ratings and could still harm early downloaders. Because the marketplace does NOT pre-review, the *real* safety floor is the execution layer (Section 6): every downloaded skill runs through the existing permission gate, shell allow/deny-list, and protected-path blocking regardless of what it claims. In addition:
  - New/low-trust skills default to **dry-run-first** on their first execution so the user sees exactly what would happen before anything real runs.
  - The pre-run capability summary (Section 6.2) is mandatory for any skill installed from the marketplace.
- Marketplace success metric: **skill downloads and skill creations** are the primary product KPI (not DAU/retention, not "flawless run" count). Build the server-side counters in 4.1 first; `getTelemetrySummary`/`GET /telemetry/summary` already exist and aggregate per-tool action telemetry (✅ shipped), but they have no concept of marketplace `downloads`/`installs`/`creations` yet — those counters still need to be added to the response schema once 4.1 lands.

### 4.4 Web frontend
- New route `sthopwood.com/market`, mirroring the existing `/net` integration pattern, linked to/from `/net`.
- Search by natural-language description, browse by trust/downloads/recent, view the pre-run capability summary before install.

### 4.5 Marketplace implementation checklist (Definition of Done)

- ⬜ Add new public-market storage namespace (not `csimple_ws_*`) with immutable version records.
- ⬜ Add server-atomic counters for `downloads`, `installs`, `creations` (not derived from client logs).
- ⬜ Wire publish path to run `scrubForPublish` + `summarizeCapabilities` before persistence.
- ⬜ Enforce install-before-rate gating with server-side proof of install/run.
- ⬜ Add marketplace routes to `server/automation/index.js` and client wrappers in `workspace-client.js`.
- ⬜ Add Jest unit tests for ranking, version pinning, and install/rate gate.
- ⬜ Add at least one eval scenario for the marketplace routes once they exist (the runner's HTTP scenario mode — §5.5 — is now implemented and ready to use).

### 4.6 Marketplace backend schema + ranking backlog — ⬜ planned (not started)

- ⬜ Define immutable version key shape: `marketId@version` (or equivalent) and enforce write-once semantics.
- ⬜ Add author-scope publish limits/rate limits to reduce spam bursts.
- ⬜ Store install/run attestations used for ratings gate (`canRate = installed && attemptedRun`).
- ⬜ Persist `outcome` alongside ratings for trust scoring (not just stars).
- ⬜ Implement ranking weights as explicit config (not magic constants in route code).
- ⬜ Add deterministic tie-breakers for equal trust score (recency, then downloads, then stable ID).
- ⬜ Add "low-trust" classifier used by dry-run-first enforcement.
- ⬜ Add backend contract tests for pagination, sort stability, and install/rate constraints.

## 5. Skill generalization (priority-ordered technical roadmap) — 🟡 partially implemented (5.1/5.2 shipped; 5.3/5.4/5.5/5.6 partial)

Fix the current addon's biggest known weakness: the compiler in `recorder/compiler.js` only does literal event coalescing (window focus dedup, click/drag/tap classification) — it does not generalize across variation. Build in this priority order:

### 5.1 LLM re-derivation — ✅ implemented 2026-07
Given the raw recording trace + a short goal description (from the user), have an LLM rewrite the step sequence into a more robust/abstracted form (e.g., prefer `uia_invoke`/`click_visual` over raw `click_at` coordinates where possible), similar to how `nl-compiler.js` already generates steps from English — but sourced from a demonstration instead of from scratch.

**Shipped as** `server/automation/recorder/generalize.js` (`generalizeSkill(skill, opts)`), reusing `nl-compiler.js`'s `validateSteps`/`STEP_SCHEMA_DOCS`/`_callLlm` (the latter now takes an optional `systemPrompt` argument) so re-derived steps are validated against the exact same abstracted schema and run through the existing `_normaliseStep` executor path unmodified. Best-effort by design: LLM failure or schema-invalid output returns the original literal-step skill untouched (`metadata.generalizeError`) — generalization never blocks saving or running a raw recording. New endpoint `POST /api/skill/generalize` (accepts `sessionId` or a pre-compiled `skill`, plus optional `goalDescription`). Unit tests in `generalize.test.js` (19 cases, offline via injected fake `llmClient`).

### 5.2 Parameter inference — ✅ implemented 2026-07
When a user demonstrates the same or similar task multiple times, diff the recordings to detect what varies (typed text, target names, numeric values) and promote those into `${param.x}` placeholders (the substitution mechanism already exists in `tools/skill.js` `substituteArgs`). **Capture UX:** a single demo is the default path (5.1 handles it alone); multi-demo is opt-in via a "demonstrate again" affordance on a recorded skill, so parameterization is a deliberate refinement, not required friction on the first recording.

**Shipped as** `server/automation/recorder/infer-params.js` (`inferParams(skills)`), taking 2+ already-compiled skills of the SAME demonstrated task and diffing them positionally (deliberately no fuzzy/LCS sequence alignment — matches "generalization never blocks" philosophy). Works on both the literal (`{tool,args}`) and abstracted (`{type,...}`) step schemas, and recurses into `loop_until_key`/`loop_n_times` `.body` arrays. Any leaf value that varies across all supplied demos is promoted to `${param.<name>}` and added to `skill.params`; positional/non-semantic leaves (pixel `x`/`y`, timing fields, `path` arrays, image-like keys) are never promoted even if they vary. A step-count mismatch degrades the whole call to a no-op (`report.reason` set, original skill returned unchanged); a step-*kind* mismatch at a given index skips only that step (`report.findings[].skipped`) without failing the rest. New endpoint `POST /api/skill/infer-params` (accepts `skills` array or `sessionIds` array, compiling each fresh via `compileRecording` in the latter case). Unit tests in `infer-params.test.js` (29 cases, fully offline).

### 5.3 Vision-based re-targeting — 🟡 partially implemented 2026-07
At replay time, if a `uia_invoke`/`click_at` step fails because the UI shifted, fall back to the existing `find_and_click_visual` (`vision-fusion.js`) to relocate an equivalent element rather than hard-failing. This closes the loop with the existing repair mechanism in `tools/skill.js` (`repairStep`) — extend that repair prompt to consider "find a visually/semantically similar element" as a first-class recovery action, not just "amend args blindly."

**Shipped as** `tools/skill.js` recovery-path upgrades:
- deterministic visual-retarget branch executed before LLM arg-amend retries (currently for failed `uia_invoke` and `click_at` style targets),
- repair provenance attached to each repair record (`originalTool`, `originalArgs`, `originalError`),
- retry backoff support (`repairBackoffMs`) layered on top of existing `maxRepairs`,
- event bus telemetry for repair lifecycle (`skill.repair.attempt|success|failed`),
- unit coverage in `tools/skill.test.js` for UI-shift visual recovery and hard-fail paths.

**Implementation checklist**

- ✅ Extend `repairStep` decision tree with an explicit "visual retarget" branch before generic argument edits.
- ✅ Preserve original failed selector/context as provenance in repair metadata for later debugging.
- ✅ Add retry budget + backoff so visual fallback cannot loop indefinitely.
- ✅ Emit event-bus telemetry for fallback attempts/success/failure.
- ✅ Add unit tests for recoverable UI-shift failure vs hard-failure cases.

### 5.4 Tool-version graceful degradation — 🟡 partially implemented 2026-07
Downloaded skills reference tools by name; the registry evolves. Before running an installed skill, resolve every step's tool against the local registry. Missing/renamed tools should downgrade the step (e.g. `uia_invoke` → `find_and_click_visual`) or surface a clear "this step can't run on your version" message — never crash mid-skill.

**Shipped as** `tools/skill.js` compatibility analysis + downgrade path:
- deterministic alias/fallback mapping (`click_visual`/`vision_click` → `find_and_click_visual`, `app_open`/`open_application` → `open_app`, `type` → `text_type`, `say_text` → `audio_speak`, plus fallback `uia_invoke` → `find_and_click_visual` when unavailable),
- recursive compatibility analyzer (`analyzeSkillCompatibility(skill)`) that classifies every resolved step as `compatible`, `degraded`, or `unsupported` (including loop bodies),
- new preview endpoint `POST /api/skill/compatibility`,
- `skill_run` preflight gate: runs are blocked by default when unsupported steps exist unless caller explicitly sets `allowUnsupported=true`, and per-step compatibility metadata is returned in run results.

**Implementation checklist**

- ✅ Build a compatibility resolver that maps old tool names to current equivalents.
- ✅ Classify per-step result as `compatible`, `degraded`, or `unsupported`.
- ✅ Surface compatibility summary before run; require explicit user confirmation when any step is `unsupported` (`allowUnsupported` gate).
- ✅ Add deterministic downgrade rules (no LLM-needed branch for straightforward renames).
- ✅ Add tests for mixed-version skill imports and partial execution behavior.

### 5.5 Measure it — reuse the eval harness — 🟡 partially implemented 2026-07
Generalization is only "better" if it's measurable. Use the existing `automation/eval/scenarios/` framework: for each generalization change, add scenarios that (a) replay a recorded trace, (b) assert the generalized skill still succeeds against a *perturbed* UI (moved window, renamed control, changed coordinates). A generalization change that doesn't move a scenario from fail→pass isn't done. New pipelines also get Jest unit tests, matching repo convention (`*.test.js` in `test:unit`).

> ✅ **Implementation update (2026-07):** `automation/eval/runner.js` now supports HTTP scenarios. A scenario may supply an `http: { method, path, body, headers }` block (mutually exclusive with `steps`) that is executed against a real, ephemeral, localhost-only Express server booted from the production `mountAutomation()` (see new `eval/http-app.js` — lazy singleton, closed via `closeEvalHttpServer()`). Assertions support dotted-path field lookups (`"stats.enabled": true`), `{ type: "array"|"string"|"number"|"boolean"|"object" }`, `{ equals|contains|matches|minLength|maxLength|exists }`, plus `status`/`ok` special cases. This retroactively activated **four previously-inert scenarios** (`13-voice-status.json`, `14-perception-frame.json`, `15-predictor.json`, `16-multi-agent.json`) whose `"http"` blocks had been silently ignored by the old runner and were "passing" with zero real assertions ever executed — they now run for real and pass. `12-nl-compile.json` (needs a live LLM/network call) is gated behind `require.env: { EVAL_ALLOW_LLM: "1" }` so it's skipped by default. A new fully-offline scenario `17-skill-capabilities-http.json` and a unit-test file `eval/runner.test.js` (31 cases: assertion-evaluator unit tests + an end-to-end run against the real ephemeral server) were added and wired into `npm run test:unit`. See `eval/README.md` for the documented HTTP scenario format.

**Remaining checklist**

- ✅ Extend eval runner with an HTTP scenario mode.
- ⬜ Add at least one perturbed-UI scenario per generalization axis (position shift, label rename, timing variance) — HTTP mode unblocks this but no perturbed-UI scenario exists yet.
- ⬜ Add CI gate requiring no regression in scenario pass rate for `automation/eval/scenarios/`.

### 5.6 Per-skill success criteria (runtime observability) — 🟡 partially implemented 2026-07
A generalized skill needs to know whether a run actually worked, or replay/repair/rating are all guessing. Reuse the workspace goal model's existing `successCriteria` field: let the author (or the LLM re-derivation step) attach a lightweight, checkable end-state assertion to a skill (e.g. "a window titled X is focused", "clipboard contains a URL", a `screenshot_check` vision condition). On replay, evaluate it to emit a definitive success/failure — this is what feeds the marketplace `outcome` on ratings (Section 4.1) and decides whether `repairStep` should fire.

**Shipped as** `tools/skill.js` runtime outcome evaluation:
- `skill_run` now computes and returns `outcome` with status + reason code (`passed`/`failed`/`indeterminate`),
- supported criteria types today: `step_ok`, `tool_succeeded`, `clipboard_contains`, `window_focused` (plus explicit indeterminate handling for unsupported/invalid criteria),
- outcome is included in action telemetry payload (`skill_run` audit record),
- failing success criteria now flips overall run status to failed even when raw tool steps succeeded,
- unit coverage added in `tools/skill.test.js` for pass/fail criteria behavior.

**Implementation checklist**

- ✅ Define a minimal, versioned `successCriteria` schema for skills.
- ✅ Evaluate criteria post-run and persist outcome with reason codes.
- 🟡 Pass outcome into marketplace rating payload (`outcome`) and telemetry (local skill-run telemetry shipped; marketplace rating pipe still pending).
- ⬜ Trigger `repairStep` only when criteria fail and retry budget remains.
- ✅ Add tests for criteria pass/fail/indeterminate states.

## 6. Safety & permissions — 🟡 partially implemented (backend seams shipped for 6.1/6.2/6.3; UI confirmation flows still open)

Keep and extend the existing permission model (`server/automation/permissions.js`, `security-guard.js`) — do not weaken it for the sake of a smoother consumer onboarding flow. Specifically:

- Category-based approval (`safe-read` / `sandboxed-write` / `shell` / `destructive` / `system`) stays.
- Shell allow/deny-list and protected-path blocking (`security-guard.js`) stays as a hard floor regardless of what a marketplace skill claims to do.
- No relaxing of the `globalKillSwitch` / dry-run mechanisms already present.

### 6.1 Privacy / PII scrubbing (✅ implemented 2026-07 — highest-risk gap, shipped before any publish flow)
Recordings capture screen frames, keystrokes, webcam, and mic. A raw recorded skill can embed passwords, personal file paths, tokens, and screenshots. **Publishing must not leak this.**
- Add a mandatory scrub pass in the generalization pipeline that runs *before* a skill can be published: strip absolute user paths (`C:\Users\<name>\...` → `${param.path}`), redact anything typed into password/secure fields, drop raw screenshots from published `steps`, and promote varying literals to `${param.x}` (this doubles as parameter inference, Section 5.2).
- Reuse the existing PII-safe fingerprinting approach in `pattern-learner.js` and honor the sensitive-capture consent gate (`permissions.dataCapture.keyboard`, `confirmSensitiveCapture`) — a recording made without keyboard-capture consent simply has no keystrokes to leak.
- The pre-publish UI must show the author a **"what will be shared"** review (the scrubbed steps + any remaining literals) and require explicit confirmation.

**Shipped as** `server/automation/recorder/scrub.js` (`scrubForPublish(skill)`), returning a NEW skill (absolute Windows user-profile paths promoted to `${param.userProfile}` via the existing `substituteArgs` mechanism, secret-shaped strings redacted via pattern list — GitHub/AWS/Slack/Google/Bearer/JWT/OpenAI-key shapes — and image/screenshot-shaped values dropped by key name or `data:image/` content) plus a `report` describing every redaction. **The report never includes the original sensitive value**, only a `kind` + human-readable `note`, so it can be shown directly to the author as the pre-publish review without becoming a second leak vector. New preview endpoint `POST /api/skill/scrub` (does not save/publish). Unit tests in `scrub.test.js` (32 cases). Recurses into `loop_until_key`/`loop_n_times` step bodies.

> ✅ **Update (2026-07):** capture-time sensitive-input consent gating is now implemented in the recorder start path (`confirmSensitiveCapture` + persisted `permissions.dataCapture.keyboard`), so the Section 6.1 scrub pass and capture gate are both in place.

### 6.2 Inspect-before-run capability summary (✅ implemented 2026-07)
Marketplace skills should be **inspectable before running** — from the skill's `steps` array (which already names every tool call) plus its `declaredCategories`, generate a human-readable summary: "this will: open Chrome, type text, click 3 things, run 1 shell command." Flag any mismatch between *declared* categories and what the steps *actually* invoke (a skill declaring `safe-read` but containing `shell_run` is a red flag to surface prominently). Mandatory before first run of any installed skill; non-technical users never see a wall of JSON.

**Shipped as** `server/automation/capability-summary.js` (`summarizeCapabilities(skill)`), which resolves every step through the SAME `tools/skill.js` `_normaliseStep` the executor uses at run time (so the summary can never drift from what actually executes), expanding `loop_until_key`/`loop_n_times` bodies. Returns `{ summary, actualCategories, declaredCategories, mismatches, toolCounts }`: `summary` is a deduped, counted, plain-English action list ("click on the screen (2x)", "open notepad.exe", "run 1 shell command"); `mismatches` lists any tool whose resolved category (via `tool-registry.js`) wasn't present in `skill.declaredCategories`, sorted most-severe-first — only computed when the skill actually declared categories (an absent declaration isn't treated as an implicit "nothing happens" claim). New read-only preview endpoint `POST /api/skill/capabilities`. Unit tests in `capability-summary.test.js` (17 cases, offline via a fake tool-registry injected through `require.cache`, matching the `tools/skill.test.js` pattern).

### 6.3 Cloud-vision consent — 🟡 partially implemented 2026-07
The generalization and vision-fallback paths send **screen captures to a cloud multimodal LLM** (`vision-fusion.js`, GitHub Models today). For a consumer product that's a real data-egress concern the current dev tool glosses over. Require explicit, revocable consent before any screen frame leaves the device, show which paths use it, and make the local/offline model seam (Section 7) the escape hatch for privacy-sensitive users. This consent is separate from the keyboard-capture consent in Section 6.1.

**Shipped as** backend consent gating in `permissions.js` + recorder/vision paths:
- new persisted consent state in automation permissions (`dataCapture.keyboard`, `cloudVision.granted`, timestamps + policy version),
- `find_and_click_visual` now blocks by default unless cloud-vision consent exists, with explicit one-time grant via `confirmCloudVisionCapture=true`,
- `screenshot_check` in `tools/skill.js` now hard-fails with a consent-required error when cloud-vision consent is absent (no silent model fallback),
- recorder start path now enforces keyboard capture consent (`confirmSensitiveCapture=true` required on first run),
- new consent status endpoint `GET /api/recorder/consent-status`,
- new consent management endpoints `GET/PUT /api/automation/consents` support explicit grant/revoke toggles for keyboard-capture and cloud-vision consent,
- consent grant/revoke updates now publish `permissions.changed` events with detailed change metadata (`source`, `changedKeys`, `changes`).

**Implementation checklist**

- ⬜ Add first-use consent modal for cloud vision with plain-language data egress description.
- ✅ Persist consent with versioned policy text hash to support future policy updates.
- ✅ Block multimodal calls when consent is absent/revoked and surface actionable next-step UI.
- ✅ Log consent grant/revoke events with structured metadata (`source`, `changedKeys`, before/after `changes`) from consent APIs.
- ✅ Add tests for allow/deny/revoke flows (permissions consent tests + `screenshot_check` consent tests + `vision-fusion` deny/grant/revoke tests).

### 6.4 Remaining safety implementation checklist

- ✅ Implement keyboard/sensitive-capture consent gate (`permissions.dataCapture.keyboard`, `confirmSensitiveCapture`) in the actual recorder pipeline.
- 🟡 Block publish/install flows on explicit pre-run capability confirmation in UI (backend run-path enforcement now shipped for marketplace-installed skills; UI confirmation flow still pending).
- 🟡 Require cloud-vision consent before any multimodal frame upload path (`vision-fusion.js`, `screenshot_check`, any future vision fallback calls). (`vision-fusion.js` + `screenshot_check` now gated; future multimodal paths still need wiring)
- 🟡 Add revoke/toggle UI and persist consent state so previously granted access can be withdrawn (backend persistence + consent toggle API shipped; UI still pending).
- 🟡 Ensure every deny path surfaces a user-visible reason (consent/capability deny paths now return explicit actionable errors; complete remaining non-consent deny-path audit).

## 7. Architecture constraints — 🟡 stack constraints already honored; LLM provider seam (7.1) still ⬜ planned

- **Keep the existing stack**: Electron + Node.js main process/server, Python subprocesses for ML workloads (Whisper STT, MediaPipe eye tracking, webcam/vision). Do not propose a rewrite.
- **Cloud-first AI, with a local/offline option**: default to cloud APIs (GitHub Models today, per `github-models-service.js`) for the "smart" parts (NL compilation, skill generalization, vision fallback) since that's simplest to ship, but preserve the ability to swap in local models later — don't hardcode cloud-only assumptions into new code. Concretely: define a small **LLM provider interface** (`chat`, `chatMultimodal`) and route `agent-loop.js`, `nl-compiler.js`, and `tools/skill.js` through it instead of newing up `GitHubModelsService` directly, so a local backend can be dropped in behind the same seam.
- Reuse existing subsystems rather than reinventing: tool registry, permission gate, event bus (`events.js`), recorder, agent loop, predictor/pattern-learner for proactive suggestions.

### 7.1 LLM provider seam implementation checklist — ⬜ planned

- ⬜ Add provider interface module with `chat`, `chatMultimodal`, and capability flags.
- ⬜ Implement `github-models` adapter behind the interface without behavior regressions.
- ⬜ Route `agent-loop.js`, `nl-compiler.js`, and `tools/skill.js` through the provider factory.
- ⬜ Add a local/offline stub adapter for development/testing fallback.
- ⬜ Centralize retries/timeouts/error mapping at the provider boundary.
- ⬜ Add unit tests proving callers no longer instantiate `GitHubModelsService` directly.

## 8. Monetization — ⬜ planned (no `requiresPlan`/Stripe wiring in `csimple-addon` yet)

Freemium:
- **Free**: core recording/replay, local skill library, manual triggers (hotkey/voice), basic agent loop.
- **Paid**: cloud AI features (better generalization models, more compute-heavy vision fallback calls, priority marketplace placement, etc.) — needs a clean seam so free users aren't blocked from the product's core loop, only from the AI-heavy upgrades.
- **Concrete seam:** reuse the portfolio backend's existing Stripe integration (`backend/services/stripeService.js`, `backend/constants/pricing.js`) and subscription tiers. Add a single `requiresPlan(tier)` check at the **cloud-AI call boundary** (the LLM provider interface from Section 7) — free users hit local/basic behavior, paid users get the cloud-heavy path. Do NOT scatter plan checks through feature code; gate at the one seam. Downgrading/expiring a plan must gracefully fall back to the free path, never break an installed skill's core replay.

### 8.1 Monetization implementation checklist — ⬜ planned

- ⬜ Implement `requiresPlan(tier)` at provider boundary only (no feature-level scatter).
- ⬜ Map each cloud-heavy capability to a minimum tier in one config table.
- ⬜ Ensure plan downgrade immediately flips to free/local path without skill execution breakage.
- ⬜ Add clear UX copy when premium-only path is blocked ("what still works for free").
- ⬜ Add integration tests for free, paid, expired, and grace-period states.

### 8.2 Example marketable use cases

Concrete "show don't tell" scenarios to use in marketing copy, demo videos, and onboarding examples — each should be a plausible single-demo recording a non-technical user could do in under a minute. Written for everyday people, not tech folks: plain language, no jargon, big obvious payoff up front.

1. **Never organize your downloads again** — show it once, and from then on every messy file sorts itself into the right folder automatically, forever.
2. **Grind your video game while you live your life** — show it the boring, repetitive part once, then go eat dinner, watch TV, or sleep while it keeps playing and racking up rewards for you.
3. **Fill out the same form a hundred times without lifting a finger** — do it once by hand, and it repeats your exact answers perfectly, as many times as you need.
4. **Turn 10,000 messy photos into a perfectly organized album overnight** — show it how you like things named once, and it renames your entire photo collection while you sleep.
5. **Copy information between programs like a tireless assistant** — show it moving one row of data from a spreadsheet into another app, and it does the rest of your list for you.
6. **Get your daily report done before you even sit down at your desk** — it builds the report, saves it, and emails it out automatically, every single morning.
7. **Post once, appear everywhere** — show it how you post to one place, and it shares the same thing to all your other accounts automatically.
8. **Wake up to a clean, sorted inbox** — teach it what "junk," "important," and "needs a reply" look like, and it keeps your email tidy around the clock.
9. **Turn a shoebox of receipts into a finished budget** — show it one receipt, and it reads the rest and adds them all up for you.
10. **Keep your game character stocked and ready 24/7** — it handles the repetitive shopping, crafting, and inventory cleanup so you always jump in ready to play.
11. **Make a whole folder of photos look professional in seconds** — show it your edit once, and it applies the same polish to every photo in the folder.
12. **Never miss a sold-out item again** — it watches the website for you and grabs it the instant it's back in stock, faster than any human could click.
13. **Turn messy meeting notes into something you'd actually want to send** — hand it your scribbles, and it hands back a clean, organized summary, automatically.
14. **Set up a brand-new computer exactly the way you like in minutes** — show it your setup once, and it repeats every click on any future PC, instantly.
15. **Have a tireless assistant watch your files for problems** — it scans through everything and flags what needs your attention, so you don't have to dig through it yourself.
16. **Keep your entire media collection perfectly organized without touching it** — new downloads sort themselves into the right place, labeled and ready.
17. **Apply to dozens of jobs or apartments while you do something else** — fill out one application, and it repeats your info across every listing for you.
18. **Never manually build an expense report again** — it gathers your receipts, sorts them, and submits them, no spreadsheets required.
19. **Back up what matters most, automatically, forever** — your important folders get safely copied to another drive or the cloud on a schedule you set once and never think about again.
20. **Run your entire livestream like a one-person production team** — one signal from you, and it switches scenes, fires off commands, and saves highlight clips right on cue.

## 9. Non-goals for this phase

- No cross-platform (Mac/Linux) support yet.
- No manual marketplace moderation/review queue.
- No enterprise/B2B features (SSO, team management, audit export) — this is a consumer product.
- No fixed deadline — this is an ongoing, iterative build. Don't over-plan a "launch date"; structure work as a prioritized backlog instead.

## 10. Suggested first milestones (prioritized backlog, for the agent to refine)

Ordered by value-per-risk. Ship the core "show don't tell" loop before the marketplace, and ship privacy scrubbing before *any* publish path.

1. ✅ **Generalization MVP** — LLM re-derivation (5.1) + multi-demo parameter inference (5.2) shipped.
   - ✅ Eval harness now supports an HTTP scenario mode (5.5) with four previously-inert scenarios now live; a perturbed-UI regression scenario for `generalizeSkill`/`inferParams` specifically is still an open TODO.
2. 🟡 **Privacy scrub pass** (6.1) — scrub engine + preview endpoint + capture-time sensitive-input consent gate shipped.
   - ⬜ Remaining: require scrub-report confirmation in pre-publish UI.
3. 🟡 **Pre-run capability summary** (6.2) — summarizer + preview endpoint + marketplace run-path confirmation gate shipped.
   - ⬜ Remaining: enforce mandatory pre-run confirmation UX for marketplace-installed skills.
4. 🟡 **Marketplace backend** (4.1–4.2) — public namespace, versioning, install-gated ratings, atomic counters.
   - 🟡 `/telemetry/summary` route + addon `getTelemetrySummary` wiring shipped; marketplace counter fields remain to add.
5. ⬜ **Marketplace web frontend** (`sthopwood.com/market`, 4.4) + trust ranking + dry-run-first for low-trust skills.
6. 🟡 **Vision re-targeting on replay** (5.3) — backend recovery path shipped; broaden target coverage + UI messaging remain.
7. ⬜ **Monetization seam** (8) — `requiresPlan` at LLM provider boundary.
8. ⬜ **Onboarding/UX polish** for non-technical users (after core safety + marketplace flows are in place).

Each milestone ships with Jest unit tests and, where it touches the automation loop, an `automation/eval/scenarios/` scenario — matching repo convention.

### 10.1 Next implementation slices (high-confidence, file-targeted)

Use these as concrete "pick up and code" slices in order:

1. **Marketplace persistence + routes**
   - `server/automation/index.js`
   - `server/automation/workspace-client.js`
   - new `server/automation/marketplace/*` module(s)
2. **Telemetry summary plumbing for marketplace counters** (partial)
   - ✅ `server/automation/workspace-client.js` (`getTelemetrySummary`)
   - ✅ backend `/telemetry/summary` endpoint in the portfolio backend service
   - ⬜ Extend summary schema to include marketplace `downloads`/`installs`/`creations` counters once 4.1 lands.
3. **Capability/scrub UI confirmations (mandatory for marketplace flow)**
   - frontend route(s) that currently consume `/net` integration patterns
4. **Recorder consent gate**
   - `server/automation/permissions.js`
   - recorder capture pipeline entry points under `server/automation/recorder/`
5. **Vision replay repair fallback**
   - `server/automation/tools/skill.js` (`repairStep`)
   - `server/automation/vision-fusion.js`

### 10.2 Sprint-ready backlog of not-done items (expanded)

#### P0 — do now

- ⬜ Marketplace public namespace + immutable version storage.
- ⬜ Install-gated ratings (server-enforced).
- 🟡 `/telemetry/summary` endpoint and `getTelemetrySummary` wiring (base endpoint + client shipped; marketplace counter fields still pending).
- ⬜ Mandatory pre-publish scrub confirmation UI.
- ⬜ Mandatory pre-run capability confirmation UI for installed market skills.

#### P1 — do next

- 🟡 Vision re-targeting fallback path in `repairStep` (core fallback shipped for key tools; broaden coverage + UX surfacing remain).
- 🟡 Tool-version compatibility resolver + downgrade messaging (backend + run gating shipped; UI integration and broader mapping coverage remain).
- 🟡 Recorder sensitive-capture consent gate (`dataCapture.keyboard` + confirmation flow) (backend gate shipped; frontend consent UX polish remains).
- 🟡 Cloud-vision consent and revoke flow (backend gating + revoke/toggle API + deny/grant/revoke tests shipped; frontend consent UX still pending).
- 🟡 Per-skill `successCriteria` evaluation + outcome persistence (runtime + telemetry shipped; marketplace outcome integration remains).

#### P2 — after core loop is stable

- ⬜ Trust-ranking tuning + low-trust dry-run-first policy hardening.
- ⬜ LLM provider seam extraction + local adapter quality pass.
- ⬜ Monetization gate at provider boundary with tier matrix.
- ⬜ Consumer onboarding polish and starter templates.

### 10.3 Release-gate checklist for first marketplace public beta

- ⬜ No publish path can bypass scrub + author confirmation.
- ⬜ No run path can bypass permissions/security guardrails.
- ⬜ Installed marketplace skills always show capability summary before first execution.
- ⬜ Low-trust skills default to dry-run-first.
- ⬜ Ratings endpoint rejects users with no install/run proof.
- ⬜ Telemetry exposes downloads/installs/creations from server counters.
- 🟡 All new routes have unit tests and error-path coverage (coverage expanded with `permissions.test`, `tools/skill.test`, and `vision-fusion.test`; index route-level tests still to add).

---

### Context for the agent: relevant existing files to read first

- `server/automation/recorder/` (recorder + compiler)
- `server/automation/tools/skill.js` (skill execution + repair)
- `server/automation/nl-compiler.js` (NL → steps)
- `server/automation/agent-loop.js` + `planner.js`
- `server/automation/permissions.js` + `security-guard.js`
- `server/automation/tool-registry.js`
- `server/automation/vision-fusion.js`
- `server/automation/workspace-client.js` (backend API client — marketplace likely extends this)
- `server/automation/index.js` (route mounting — see `/api/skill/*`)
