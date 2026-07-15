# Project Brief: CSimple — Consumer PC Automation Platform

Give this document to your coding agent (Claude Code, etc.) as the starting spec. It expands on an existing codebase (`csimple-addon/`) rather than starting from scratch — read the existing code first before proposing changes.

---

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

## 4. Marketplace

> ⚠️ **Scope correction for the agent:** the marketplace is *not* just "extend the existing skill endpoints." Today's skill endpoints (`/api/data/csimple/workspace/skill/*`) store **private, per-user** items keyed `csimple_ws_{userId}_{kind}_{slug}`. The marketplace needs a **new shared/public namespace** with its own read path (anyone can discover) and controlled write path (publish/fork). Treat the private workspace skill store and the public marketplace as two distinct surfaces that a "publish" action bridges.

### 4.1 Data model (new backend surface)
- **Published skill record** (public, immutable per version): `marketId`, `authorUserId`, `name`, `slug`, `version` (semver), `steps` (scrubbed — see Section 6.1), `declaredCategories` (the tool categories the skill will invoke), `toolSchemaVersion`, `naturalLanguageDescription` (for search), `createdAt`.
- **Versioning + fork:** publishing a change creates a new immutable version; downloaders pin a version. A user can *fork* a published skill into their private workspace, edit, and re-publish under their own author id.
- **Ratings:** `{ marketId, version, raterUserId, stars (1-5), ranAt, outcome }` — one rating per user per version, only accepted from users who actually downloaded/ran it (prevents drive-by rating).
- **Counters (server-side, the KPI source):** `downloads`, `installs`, `creations` incremented atomically on the marketplace backend — NOT derived from the per-user JSONL action log.
- **Compatibility:** every published skill stores `toolSchemaVersion`. On download, the client compares against its own registry; if a referenced tool is missing/renamed, surface a "partially compatible" warning and degrade gracefully instead of hard-failing at run time (see Section 5.4).

### 4.2 API surface (extends `workspace-client.js`, new backend routes)
- `POST /api/market/skills` — publish (runs the scrub + capability-manifest step first).
- `GET  /api/market/skills?q=<nl>&sort=trust|downloads|recent` — natural-language search + ranking.
- `GET  /api/market/skills/:marketId[/:version]` — fetch a version.
- `POST /api/market/skills/:marketId/install` — increments `downloads`/`installs`, returns the scrubbed steps to copy into the user's private workspace.
- `POST /api/market/skills/:marketId/rate` — gated on prior install.
- `POST /api/market/skills/:marketId/flag` — community flagging.

### 4.3 Trust model
- **Reputation/rating-based, no manual moderation/code-review queue** (matches Non-goals).
- Ranking signal = rating × volume × author reputation (seeded from account age + prior skill ratings) × recency; community flags deprioritize.
- ⚠️ **Cold-start mitigation (design around it, don't skip):** a brand-new skill has zero ratings and could still harm early downloaders. Because the marketplace does NOT pre-review, the *real* safety floor is the execution layer (Section 6): every downloaded skill runs through the existing permission gate, shell allow/deny-list, and protected-path blocking regardless of what it claims. In addition:
  - New/low-trust skills default to **dry-run-first** on their first execution so the user sees exactly what would happen before anything real runs.
  - The pre-run capability summary (Section 6.2) is mandatory for any skill installed from the marketplace.
- Marketplace success metric: **skill downloads and skill creations** are the primary product KPI (not DAU/retention, not "flawless run" count). Build the server-side counters in 4.1 first; wire them into `getTelemetrySummary` (currently a stub hitting a non-existent `/telemetry/summary`).

### 4.4 Web frontend
- New route `sthopwood.com/market`, mirroring the existing `/net` integration pattern, linked to/from `/net`.
- Search by natural-language description, browse by trust/downloads/recent, view the pre-run capability summary before install.

## 5. Skill generalization (priority-ordered technical roadmap)

Fix the current addon's biggest known weakness: the compiler in `recorder/compiler.js` only does literal event coalescing (window focus dedup, click/drag/tap classification) — it does not generalize across variation. Build in this priority order:

### 5.1 LLM re-derivation — ✅ implemented 2026-07
Given the raw recording trace + a short goal description (from the user), have an LLM rewrite the step sequence into a more robust/abstracted form (e.g., prefer `uia_invoke`/`click_visual` over raw `click_at` coordinates where possible), similar to how `nl-compiler.js` already generates steps from English — but sourced from a demonstration instead of from scratch.

**Shipped as** `server/automation/recorder/generalize.js` (`generalizeSkill(skill, opts)`), reusing `nl-compiler.js`'s `validateSteps`/`STEP_SCHEMA_DOCS`/`_callLlm` (the latter now takes an optional `systemPrompt` argument) so re-derived steps are validated against the exact same abstracted schema and run through the existing `_normaliseStep` executor path unmodified. Best-effort by design: LLM failure or schema-invalid output returns the original literal-step skill untouched (`metadata.generalizeError`) — generalization never blocks saving or running a raw recording. New endpoint `POST /api/skill/generalize` (accepts `sessionId` or a pre-compiled `skill`, plus optional `goalDescription`). Unit tests in `generalize.test.js` (19 cases, offline via injected fake `llmClient`).

### 5.2 Parameter inference — ✅ implemented 2026-07
When a user demonstrates the same or similar task multiple times, diff the recordings to detect what varies (typed text, target names, numeric values) and promote those into `${param.x}` placeholders (the substitution mechanism already exists in `tools/skill.js` `substituteArgs`). **Capture UX:** a single demo is the default path (5.1 handles it alone); multi-demo is opt-in via a "demonstrate again" affordance on a recorded skill, so parameterization is a deliberate refinement, not required friction on the first recording.

**Shipped as** `server/automation/recorder/infer-params.js` (`inferParams(skills)`), taking 2+ already-compiled skills of the SAME demonstrated task and diffing them positionally (deliberately no fuzzy/LCS sequence alignment — matches "generalization never blocks" philosophy). Works on both the literal (`{tool,args}`) and abstracted (`{type,...}`) step schemas, and recurses into `loop_until_key`/`loop_n_times` `.body` arrays. Any leaf value that varies across all supplied demos is promoted to `${param.<name>}` and added to `skill.params`; positional/non-semantic leaves (pixel `x`/`y`, timing fields, `path` arrays, image-like keys) are never promoted even if they vary. A step-count mismatch degrades the whole call to a no-op (`report.reason` set, original skill returned unchanged); a step-*kind* mismatch at a given index skips only that step (`report.findings[].skipped`) without failing the rest. New endpoint `POST /api/skill/infer-params` (accepts `skills` array or `sessionIds` array, compiling each fresh via `compileRecording` in the latter case). Unit tests in `infer-params.test.js` (29 cases, fully offline).

### 5.3 Vision-based re-targeting
At replay time, if a `uia_invoke`/`click_at` step fails because the UI shifted, fall back to the existing `find_and_click_visual` (`vision-fusion.js`) to relocate an equivalent element rather than hard-failing. This closes the loop with the existing repair mechanism in `tools/skill.js` (`repairStep`) — extend that repair prompt to consider "find a visually/semantically similar element" as a first-class recovery action, not just "amend args blindly."

### 5.4 Tool-version graceful degradation
Downloaded skills reference tools by name; the registry evolves. Before running an installed skill, resolve every step's tool against the local registry. Missing/renamed tools should downgrade the step (e.g. `uia_invoke` → `find_and_click_visual`) or surface a clear "this step can't run on your version" message — never crash mid-skill.

### 5.5 Measure it — reuse the eval harness
Generalization is only "better" if it's measurable. Use the existing `automation/eval/scenarios/` framework: for each generalization change, add scenarios that (a) replay a recorded trace, (b) assert the generalized skill still succeeds against a *perturbed* UI (moved window, renamed control, changed coordinates). A generalization change that doesn't move a scenario from fail→pass isn't done. New pipelines also get Jest unit tests, matching repo convention (`*.test.js` in `test:unit`).

> ⚠️ **Implementation note (2026-07):** `automation/eval/runner.js` only supports tool-registry scenarios (`steps: [{ tool, args, expect }]` executed directly against `tool-registry.js`) — it has NO support for hitting arbitrary HTTP endpoints like `/api/skill/generalize`. The existing `eval/scenarios/12-nl-compile.json` has an `"http"` block that the runner does not read; treat that scenario file as a stale/aspirational pattern, not a template. Until `runner.js` gains HTTP-scenario support (or `generalizeSkill`/`compile` are exposed as registered tools), §5.1's re-derivation is covered by the offline unit tests in `generalize.test.js` only — a true "perturbed UI" regression scenario is still an open TODO.

### 5.6 Per-skill success criteria (runtime observability)
A generalized skill needs to know whether a run actually worked, or replay/repair/rating are all guessing. Reuse the workspace goal model's existing `successCriteria` field: let the author (or the LLM re-derivation step) attach a lightweight, checkable end-state assertion to a skill (e.g. "a window titled X is focused", "clipboard contains a URL", a `screenshot_check` vision condition). On replay, evaluate it to emit a definitive success/failure — this is what feeds the marketplace `outcome` on ratings (Section 4.1) and decides whether `repairStep` should fire.

## 6. Safety & permissions

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

> ⚠️ **Correction (2026-07):** the "sensitive-capture consent gate" (`permissions.dataCapture.keyboard`, `confirmSensitiveCapture`) referenced above does **not** currently exist in the codebase — a prior repo-memory note describing it as shipped was stale/inaccurate. The scrub pass above does not depend on that gate and works regardless. Building the actual capture-time consent gate is still an open TODO, separate from the scrub-at-publish-time pass.

### 6.2 Inspect-before-run capability summary (✅ implemented 2026-07)
Marketplace skills should be **inspectable before running** — from the skill's `steps` array (which already names every tool call) plus its `declaredCategories`, generate a human-readable summary: "this will: open Chrome, type text, click 3 things, run 1 shell command." Flag any mismatch between *declared* categories and what the steps *actually* invoke (a skill declaring `safe-read` but containing `shell_run` is a red flag to surface prominently). Mandatory before first run of any installed skill; non-technical users never see a wall of JSON.

**Shipped as** `server/automation/capability-summary.js` (`summarizeCapabilities(skill)`), which resolves every step through the SAME `tools/skill.js` `_normaliseStep` the executor uses at run time (so the summary can never drift from what actually executes), expanding `loop_until_key`/`loop_n_times` bodies. Returns `{ summary, actualCategories, declaredCategories, mismatches, toolCounts }`: `summary` is a deduped, counted, plain-English action list ("click on the screen (2x)", "open notepad.exe", "run 1 shell command"); `mismatches` lists any tool whose resolved category (via `tool-registry.js`) wasn't present in `skill.declaredCategories`, sorted most-severe-first — only computed when the skill actually declared categories (an absent declaration isn't treated as an implicit "nothing happens" claim). New read-only preview endpoint `POST /api/skill/capabilities`. Unit tests in `capability-summary.test.js` (17 cases, offline via a fake tool-registry injected through `require.cache`, matching the `tools/skill.test.js` pattern).

### 6.3 Cloud-vision consent
The generalization and vision-fallback paths send **screen captures to a cloud multimodal LLM** (`vision-fusion.js`, GitHub Models today). For a consumer product that's a real data-egress concern the current dev tool glosses over. Require explicit, revocable consent before any screen frame leaves the device, show which paths use it, and make the local/offline model seam (Section 7) the escape hatch for privacy-sensitive users. This consent is separate from the keyboard-capture consent in Section 6.1.

## 7. Architecture constraints

- **Keep the existing stack**: Electron + Node.js main process/server, Python subprocesses for ML workloads (Whisper STT, MediaPipe eye tracking, webcam/vision). Do not propose a rewrite.
- **Cloud-first AI, with a local/offline option**: default to cloud APIs (GitHub Models today, per `github-models-service.js`) for the "smart" parts (NL compilation, skill generalization, vision fallback) since that's simplest to ship, but preserve the ability to swap in local models later — don't hardcode cloud-only assumptions into new code. Concretely: define a small **LLM provider interface** (`chat`, `chatMultimodal`) and route `agent-loop.js`, `nl-compiler.js`, and `tools/skill.js` through it instead of newing up `GitHubModelsService` directly, so a local backend can be dropped in behind the same seam.
- Reuse existing subsystems rather than reinventing: tool registry, permission gate, event bus (`events.js`), recorder, agent loop, predictor/pattern-learner for proactive suggestions.

## 8. Monetization

Freemium:
- **Free**: core recording/replay, local skill library, manual triggers (hotkey/voice), basic agent loop.
- **Paid**: cloud AI features (better generalization models, more compute-heavy vision fallback calls, priority marketplace placement, etc.) — needs a clean seam so free users aren't blocked from the product's core loop, only from the AI-heavy upgrades.
- **Concrete seam:** reuse the portfolio backend's existing Stripe integration (`backend/services/stripeService.js`, `backend/constants/pricing.js`) and subscription tiers. Add a single `requiresPlan(tier)` check at the **cloud-AI call boundary** (the LLM provider interface from Section 7) — free users hit local/basic behavior, paid users get the cloud-heavy path. Do NOT scatter plan checks through feature code; gate at the one seam. Downgrading/expiring a plan must gracefully fall back to the free path, never break an installed skill's core replay.

## 9. Non-goals for this phase

- No cross-platform (Mac/Linux) support yet.
- No manual marketplace moderation/review queue.
- No enterprise/B2B features (SSO, team management, audit export) — this is a consumer product.
- No fixed deadline — this is an ongoing, iterative build. Don't over-plan a "launch date"; structure work as a prioritized backlog instead.

## 10. Suggested first milestones (prioritized backlog, for the agent to refine)

Ordered by value-per-risk. Ship the core "show don't tell" loop before the marketplace, and ship privacy scrubbing before *any* publish path.

1. **Generalization MVP** — ✅ LLM re-derivation shipped (Section 5.1). ✅ Multi-demo parameter inference shipped (Section 5.2). Remaining: gate future changes behind a real eval scenario once `runner.js` supports HTTP scenarios or `generalizeSkill`/`inferParams` are exposed as tools (Section 5.5).
2. **Privacy scrub pass** (Section 6.1) — ✅ shipped as `recorder/scrub.js` + `POST /api/skill/scrub` preview endpoint. Remaining: the actual capture-time consent gate (`dataCapture.keyboard`/`confirmSensitiveCapture`) doesn't exist yet — build it; and wire the scrub pass + report into a real pre-publish confirmation UI once the marketplace frontend (milestone 5) exists.
3. **Pre-run capability summary** (Section 6.2) — ✅ shipped as `capability-summary.js` + `POST /api/skill/capabilities`. Remaining: wire it into an actual pre-run confirmation UI (currently backend-only, no frontend consumer yet) and require it (not just offer it) on marketplace-installed skills once the marketplace exists.
4. **Marketplace backend** (Section 4.1–4.2) — new shared/public namespace, versioning, ratings-gated-on-install, and server-side download/creation counters. Wire the counters into `getTelemetrySummary` (build the missing `/telemetry/summary` endpoint).
5. **Marketplace web frontend** (`sthopwood.com/market`, Section 4.4) + trust ranking + dry-run-first for low-trust skills.
6. **Vision re-targeting on replay** (Section 5.3) — extend `repairStep` to relocate similar elements.
7. **Monetization seam** (Section 8) — `requiresPlan` gate at the LLM provider boundary.
8. Only after the above: onboarding/UX polish for non-technical users.

Each milestone ships with Jest unit tests and, where it touches the automation loop, an `automation/eval/scenarios/` scenario — matching repo convention.

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
