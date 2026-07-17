# Project Brief: CSimple — Consumer PC Automation Platform

Give this document to your coding agent (Claude Code, etc.) as the starting spec. It expands on an existing codebase (`csimple-addon/`) rather than starting from scratch — read the existing code first before proposing changes.

### Table of contents

1. [Vision](#1-vision)
2. [Target user & platform](#2-target-user--platform)
3. [Core interaction model](#3-core-interaction-model)
4. [Marketplace](#4-marketplace--partially-implemented-backend-shipped-2026-07-frontend--ui-confirmations-still-open) — 🟡 partial (backend shipped 2026-07; frontend + UI confirmations open)
5. [Skill generalization](#5-skill-generalization-priority-ordered-technical-roadmap) — 🟡 partial (5.1/5.2/5.6 shipped)
6. [Safety & permissions](#6-safety--permissions) — 🟡 partial (backend seams shipped, UI open)
7. [Architecture constraints](#7-architecture-constraints--stack-constraints-already-honored-llm-provider-seam-71-now-shipped-for-core-callers) — 🟡 partial (7.1 seam shipped for core callers)
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
- 🟡 Section 5.5 (eval harness) now supports HTTP scenarios (`eval/http-app.js` + `runner.js` HTTP mode), activating four previously-inert scenarios, plus all three perturbed-UI generalization axes (position-shift, label-rename, timing-variance) now have offline regression scenarios (`18`/`19`/`20-skill-infer-params-*.json`); only the CI pass-rate gate remains open.
- ✅ Section 5.6 (per-skill success criteria) fully shipped, including `successCriteria`-triggered repair (`skill_run`'s `maxCriteriaRepairs`, `strategy: 'criteria-retry'`).
- 🟡 Section 6.1/6.2/6.3 backend seams shipped (scrub, capability summary, consent APIs); frontend confirmation UX remains.
- ✅ Marketplace backend now exists with server-side atomic `downloads`/`installs`/`creations` counters (`backend/controllers/marketplaceController.js`), now folded into `/telemetry/summary` via `getAuthorMarketplaceTotals()` (`getTelemetrySummary` + `/telemetry/summary` returns a `marketplace: { downloads, installs, creations, skillCount }` field alongside per-tool action telemetry — see §10.2 P0). Publish-time server-side re-enforcement is now complete for BOTH the privacy scrub (§6.1) and the declared-vs-actual capability/category mismatch check (§6.2, `backend/services/marketplaceCapabilities.js`).
- 🟡 Section 7.1 (LLM provider seam) now shipped for its three named callers (`server/automation/llm-provider.js`, `createLlmProvider()`) — `agent-loop.js`, `nl-compiler.js`, and `tools/skill.js` (both its call sites) no longer instantiate `GitHubModelsService` directly; `vision-fusion.js`/`tools/webcam.js` still do, and a local-stub adapter + centralized retry policy are shipped but not yet exercised by any caller in production.

### Implementation update (2026-07-16)

- ✅ Marketplace backend (§4.1/§4.2) shipped: `backend/controllers/marketplaceController.js` (public `csimple_market_*` DynamoDB namespace, separate from the private `csimple_ws_*` workspace skill store), routes mounted at `/api/data/market/skills*` in `backend/routes/routeData.js` (note: paths are `/api/data/market/...`, not `/api/market/...` as originally sketched in §4.2, since `routeData.js` is mounted at `/api/data` for every backend route), and pure/offline-testable ranking + trust-gate helpers in `backend/services/marketplaceRanking.js`. Addon-side thin proxies added at `/api/market/skills*` (the addon's own local server, unaffected by the backend's `/api/data` prefix) in `server/automation/index.js`, backed by new `workspace-client.js` wrappers (`publishMarketSkill`, `searchMarketSkills`, `getMarketSkill`, `installMarketSkill`, `rateMarketSkill`, `flagMarketSkill`) that call `/api/data/market/...` on the backend. `publishSkill` now also independently re-runs the privacy/PII scrub pass server-side (`backend/services/marketplaceScrub.js`, §4.5) before persisting, rather than trusting the client already scrubbed, and `rateMarketSkill`'s `outcome` field now feeds a trust-score penalty (`outcomeFailRate`, §4.3/§5.6). 61 Jest cases (`marketplaceRanking.test.js` (21) + `marketplaceController.test.js` (27) + `marketplaceScrub.test.js` (13), fully offline via a fake DynamoDB doc-client). Still open at the time: server-side re-enforcement of the capability-summary/category-mismatch check at publish time (now shipped — see "continued 2" below), and all pre-publish/pre-run confirmation UI (still open).

### Implementation update (2026-07-16, continued)

- ✅ `/telemetry/summary` now surfaces marketplace KPIs (§10.2 P0): `backend/controllers/marketplaceController.js` exports `getAuthorMarketplaceTotals(authorUserId)` (a plain scan-and-aggregate helper, not an HTTP route), which `backend/controllers/workspaceController.js`'s `getTelemetrySummary` lazily requires and calls, adding a best-effort `marketplace: { downloads, installs, creations, skillCount }` field to its response alongside the existing per-tool `tools[]` telemetry. Lazy `require()` (not a module-scope import) avoids any circular-require risk between the two controllers and keeps `workspaceController.test.js`-style tests from needing to mock the marketplace DynamoDB surface. A marketplace-lookup failure degrades to `marketplace: null` rather than breaking the (already-computed) action telemetry response. 4 new Jest cases added to `marketplaceController.test.js` for `getAuthorMarketplaceTotals` (zero-totals for unknown/undefined author, multi-skill aggregation, author isolation).
- 🟡 Marketplace search pagination + sort-stability contract tests added (§4.6 backlog item, closing most of the remaining gap): `marketplaceController.test.js` now covers page truncation, no-overlap across pages, out-of-range pages, and deterministic ordering for ties. A dedicated live-DynamoDB (`back.test.js`-style) integration pass for the marketplace routes is still the one remaining gap for that checklist item.

### Implementation update (2026-07-16, continued 2)

- ✅ Server-side capability-mismatch re-enforcement at publish time (§4.5's last open sub-item, §6.2): new `backend/services/marketplaceCapabilities.js` is a deliberate, independent port of the addon's `capability-summary.js` `summarizeCapabilities` (static `TOOL_CATEGORY_MAP` mirroring every registered tool's category, since the backend can't require the addon's `tool-registry.js`/`tools/skill.js`). `publishSkill` now calls it on the server-scrubbed steps and returns a `capabilitySummary` (with `mismatches`) on the publish response — closing the gap where a client could under-declare `declaredCategories` (e.g. claim `safe-read` while shipping `shell_run`) with nothing server-side ever catching it. `installMarketSkill` also now returns `capabilitySummary` alongside the existing `lowTrust` flag, so the mandatory pre-run confirmation UI (still ⬜, see §6.4) has everything it needs without the client re-deriving it. No manual moderation queue is introduced (§4.3/§9) — mismatches are surfaced, not blocking. 12 new Jest cases: `marketplaceCapabilities.test.js` (8, pure) + 4 new cases in `marketplaceController.test.js` covering the publish/install wiring.
- ✅ `successCriteria`-triggered repair (§5.6's last open checklist item): `tools/skill.js`'s `skill_run` now retries when every step reported `ok` but the post-run `successCriteria` check still fails (previously `repairStep`/visual-retarget only fired on a hard tool-execution error). On a criteria failure with no step failure, the LAST executed step is retried via the same LLM repair fallback (`repairStep`, told *why* via a `successCriteria failed: <reasonCode> — <detail>` synthetic error), then criteria are re-evaluated; passes flip the run back to `failed: false`, declines/failed-retries leave it failed. Gated by a new `maxCriteriaRepairs` arg (default 1, independent of `maxRepairs`/`repairBackoffMs`) and surfaced via a new `skill.repair.*` event `strategy: 'criteria-retry'` plus `summary.criteriaRepairsAttempted`. 3 new Jest-style cases in `tools/skill.test.js` (pass-after-repair, decline-stays-failed, `maxCriteriaRepairs=0` disables the path entirely).
- ✅ First perturbed-UI eval scenario for §5.5's remaining checklist item: `eval/scenarios/18-skill-infer-params-perturbed-position.json` exercises `POST /api/skill/infer-params` with two demonstrations of the same task whose click coordinates differ (simulating a moved window — the position-shift axis) and whose typed text also varies, asserting pixel coordinates are never promoted to a param while the typed text correctly becomes `${param.text}`. Label-rename and timing-variance axes are still open.

### Implementation update (2026-07-16, continued 3)

- ✅ LLM provider seam (§7.1): new `server/automation/llm-provider.js` (`createLlmProvider(opts)`) centralizes the instantiation that `agent-loop.js`, `nl-compiler.js`, and `tools/skill.js` (both its call sites, including the `screenshot_check` control-flow handler) used to do inline (`require('../github-models-service'); new GitHubModelsService()`). Deliberately a pure instantiation-seam refactor, not an API change: `createLlmProvider()` returns the same shape (`.setToken`/`.chat`/`.chatWithImage`) callers already relied on, so none of the existing token-resolution logic in those three files had to change, and `require.cache`-based test doubles (e.g. `vision-fusion.test.js`'s pattern) keep working unmodified. Also ships `createLocalStubProvider()` (deterministic, offline, opt-in — not auto-wired as a production fallback) and `withRetries()` (bounded retry+backoff, opt-in via `createLlmProvider({ retries })`, skips retrying auth/config errors so real setup problems still surface immediately). 9 new Jest-style cases in `llm-provider.test.js`, wired into `test:unit`. `vision-fusion.js`/`tools/webcam.js` (mentioned only in §7's prose, not its checklist) still instantiate `GitHubModelsService` directly — the one remaining gap for full §7.1 completion.
- ✅ Remaining perturbed-UI axes for §5.5: `eval/scenarios/19-skill-infer-params-perturbed-label-rename.json` (a `uia_invoke` target's on-screen `name` changes between demos while `automationId` stays constant — asserts the renamed label IS promoted to a param, since relabeling is a legitimate semantic variation) and `20-skill-infer-params-perturbed-timing.json` (a `wait` step's `ms` duration varies 4x between demos — asserts timing never gets baked in as a required param). All three named generalization axes (position-shift, label-rename, timing-variance) now have offline regression coverage; only the CI pass-rate gate remains open for §5.5.

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

## 4. Marketplace — 🟡 partially implemented (backend shipped 2026-07; frontend + UI confirmations still open)

> ⚠️ **Scope correction for the agent:** the marketplace is *not* just "extend the existing skill endpoints." Today's skill endpoints (`/api/data/csimple/workspace/skill/*`) store **private, per-user** items keyed `csimple_ws_{userId}_{kind}_{slug}`. The marketplace needs a **new shared/public namespace** with its own read path (anyone can discover) and controlled write path (publish/fork). Treat the private workspace skill store and the public marketplace as two distinct surfaces that a "publish" action bridges.

### 4.1 Data model (new backend surface)
- **Published skill record** (public, immutable per version): `marketId`, `authorUserId`, `name`, `slug`, `version` (semver), `steps` (scrubbed — see Section 6.1), `declaredCategories` (the tool categories the skill will invoke), `toolSchemaVersion`, `naturalLanguageDescription` (for search), `createdAt`.
- **Versioning + fork:** publishing a change creates a new immutable version; downloaders pin a version. A user can *fork* a published skill into their private workspace, edit, and re-publish under their own author id.
- **Ratings:** `{ marketId, version, raterUserId, stars (1-5), ranAt, outcome }` — one rating per user per version, only accepted from users who actually downloaded/ran it (prevents drive-by rating).
- **Counters (server-side, the KPI source):** `downloads`, `installs`, `creations` incremented atomically on the marketplace backend — NOT derived from the per-user JSONL action log.
- **Compatibility:** every published skill stores `toolSchemaVersion`. On download, the client compares against its own registry; if a referenced tool is missing/renamed, surface a "partially compatible" warning and degrade gracefully instead of hard-failing at run time (see Section 5.4).

### 4.2 API surface (extends `workspace-client.js`, new backend routes) — ✅ shipped 2026-07

> Actual mounted paths are `/api/data/market/skills*` on the backend (since `routeData.js` is mounted at `/api/data` for every route in this repo — see `backend/server.js`), not the bare `/api/market/skills*` originally sketched below. The addon's own local server DOES expose bare `/api/market/skills*` proxies (unaffected by the backend's `/api/data` prefix) — see `server/automation/index.js`.

| Route (backend: prefix with `/api/data`) | Purpose | Status |
|---|---|---|
| `POST /api/market/skills` | Publish skill (server-side re-scrubs steps before persisting — §4.5 — in addition to the addon's client-side `/api/skill/scrub` call) | ✅ Shipped |
| `GET /api/market/skills?q=<nl>&sort=trust\|downloads\|recent` | NL search + ranking | ✅ Shipped |
| `GET /api/market/skills/:marketId[/:version]` | Fetch a specific version | ✅ Shipped |
| `POST /api/market/skills/:marketId/install` | Increment `downloads`/`installs`, return installable scrubbed steps | ✅ Shipped |
| `POST /api/market/skills/:marketId/rate` | Submit run-gated rating | ✅ Shipped |
| `POST /api/market/skills/:marketId/flag` | Community flagging | ✅ Shipped |

**Shipped as** `backend/controllers/marketplaceController.js` (DynamoDB table `Simple`, new `csimple_market_*` id namespace — `meta`/`version`/`install`/`rating`/`flag`/author-rate-limit records, immutable version records never overwritten), `backend/services/marketplaceRanking.js` (pure, DB-free trust/ranking helpers: `computeAuthorReputation`, `computeTrustScore`, `classifyLowTrust`, `canRate`, `sortSkills` — see §4.6), `backend/services/marketplaceScrub.js` (server-side re-enforcement of the §6.1 privacy scrub — a deliberate self-contained port of the addon's `recorder/scrub.js`, documented in-file as to why it's duplicated rather than required across the repo/deploy boundary), `backend/services/marketplaceCapabilities.js` (server-side re-enforcement of the §6.2 declared-vs-actual capability/category mismatch check — likewise a deliberate self-contained port of the addon's `capability-summary.js` `summarizeCapabilities`, using a static `TOOL_CATEGORY_MAP` instead of the addon's live `tool-registry.js`), routes wired in `backend/routes/routeData.js` behind new `marketReadLimiter`/`marketPublishLimiter`/`marketWriteLimiter` rate limiters, and addon-side proxies + `workspace-client.js` wrappers (`publishMarketSkill`, `searchMarketSkills`, `getMarketSkill`, `installMarketSkill`, `rateMarketSkill`, `flagMarketSkill`). 73 Jest cases across `marketplaceRanking.test.js` (21, pure — including trust-score outcome-fail-rate penalty coverage, §5.6), `marketplaceScrub.test.js` (13, pure), `marketplaceCapabilities.test.js` (8, pure), and `marketplaceController.test.js` (31, offline via a fake in-memory DynamoDB doc-client — including pagination/sort-stability coverage, `getAuthorMarketplaceTotals` telemetry-aggregation coverage, publish-time scrub-enforcement coverage, publish/install-time capability-mismatch-enforcement coverage, and outcome-aggregation/ranking coverage).

### 4.3 Trust model
- **Reputation/rating-based, no manual moderation/code-review queue** (matches Non-goals).
- Ranking signal = rating × volume × author reputation (seeded from account age + prior skill ratings) × recency × outcome-reliability (✅ shipped 2026-07: `outcomeFailRate`, derived from `successCriteria` pass/fail outcomes on ratings, penalizes `computeTrustScore` — §5.6); community flags deprioritize.
- ⚠️ **Cold-start mitigation (design around it, don't skip):** a brand-new skill has zero ratings and could still harm early downloaders. Because the marketplace does NOT pre-review, the *real* safety floor is the execution layer (Section 6): every downloaded skill runs through the existing permission gate, shell allow/deny-list, and protected-path blocking regardless of what it claims. In addition:
  - New/low-trust skills default to **dry-run-first** on their first execution so the user sees exactly what would happen before anything real runs.
  - The pre-run capability summary (Section 6.2) is mandatory for any skill installed from the marketplace.
- Marketplace success metric: **skill downloads and skill creations** are the primary product KPI (not DAU/retention, not "flawless run" count). The server-side counters (4.1) are ✅ shipped and atomic; `getTelemetrySummary`/`GET /telemetry/summary` already exist and aggregate per-tool action telemetry (✅ shipped), and now also fold in the marketplace `downloads`/`installs`/`creations` counters for the requesting author (✅ shipped 2026-07, `getAuthorMarketplaceTotals()`).

### 4.4 Web frontend
- New route `sthopwood.com/market`, mirroring the existing `/net` integration pattern, linked to/from `/net`.
- Search by natural-language description, browse by trust/downloads/recent, view the pre-run capability summary before install.

### 4.5 Marketplace implementation checklist (Definition of Done)

- ✅ Add new public-market storage namespace (not `csimple_ws_*`) with immutable version records.
- ✅ Add server-atomic counters for `downloads`, `installs`, `creations` (not derived from client logs).
- ✅ Wire publish path to run `scrubForPublish` + `summarizeCapabilities` before persistence (`backend/services/marketplaceScrub.js` re-runs the privacy/PII scrub server-side on every publish call and always persists the re-scrubbed output; `backend/services/marketplaceCapabilities.js` — an independent port of the addon's `summarizeCapabilities` — now also re-runs the declared-vs-actual category mismatch check server-side on every publish call, returning `capabilitySummary` on the response — see §4.2 route table).
- ✅ Enforce install-before-rate gating with server-side proof of install/run.
- ✅ Add marketplace routes to `server/automation/index.js` and client wrappers in `workspace-client.js`.
- ✅ Add Jest unit tests for ranking, version pinning, and install/rate gate.
- ✅ Fold marketplace `downloads`/`installs`/`creations` counters into `/telemetry/summary` (`getAuthorMarketplaceTotals()` in `marketplaceController.js`, consumed by `workspaceController.getTelemetrySummary`).
- ⬜ Add at least one eval scenario for the marketplace routes (the runner's HTTP scenario mode — §5.5 — is implemented and ready to use; the marketplace routes live on the portfolio backend rather than the addon's own `mountAutomation()` server, so wiring an eval scenario for them needs a bit more plumbing than the existing HTTP scenarios).

### 4.6 Marketplace backend schema + ranking backlog — 🟡 mostly shipped 2026-07

- ✅ Define immutable version key shape: `csimple_market_${marketId}_v${version}` and enforce write-once semantics (version records are always freshly `Put`, never read-modify-written).
- ✅ Add author-scope publish limits/rate limits to reduce spam bursts (`AUTHOR_PUBLISH_MAX` per rolling `AUTHOR_PUBLISH_WINDOW_MS`, tracked per-author in a dedicated DynamoDB record).
- ✅ Store install/run attestations used for ratings gate (`canRate = installed && attemptedRun`).
- ✅ Persist `outcome` alongside ratings for trust scoring (not just stars) — and now aggregated (`meta.outcomeFailCount`/`outcomeFailRate`) and consumed by `computeTrustScore` as an explicit ranking penalty, not just stored inert.
- ✅ Implement ranking weights as explicit config (`RANKING_WEIGHTS`/`LOW_TRUST_THRESHOLDS` in `marketplaceRanking.js`, not magic constants in route code).
- ✅ Add deterministic tie-breakers for equal trust score (recency, then downloads, then stable ID) — `sortSkills()`.
- ✅ Add "low-trust" classifier used by dry-run-first enforcement — `classifyLowTrust()`, surfaced as `lowTrust` on install responses.
- 🟡 Add backend contract tests for pagination, sort stability, and install/rate constraints (offline controller tests now cover pagination truncation/no-overlap/out-of-range pages, deterministic tie-break ordering, and the core install/rate/flag/publish flows; a dedicated live-DynamoDB integration pass, matching `back.test.js`'s style, remains).

## 5. Skill generalization (priority-ordered technical roadmap) — 🟡 partially implemented (5.1/5.2/5.6 shipped; 5.3/5.4/5.5 partial)

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

> ✅ **Implementation update (2026-07-16):** `eval/scenarios/18-skill-infer-params-perturbed-position.json` is the first perturbed-UI-axis regression scenario, exercising the **position-shift** axis: two demonstrations of the same task recorded with different click coordinates (as if the target window moved) are fed through `POST /api/skill/infer-params`, asserting pixel coordinates are never promoted to a param (so a moved window can't silently bake in stale coordinates) while the varying typed text correctly becomes `${param.text}`.

> ✅ **Implementation update (2026-07-16, continued 3):** all three named perturbed-UI axes now have offline regression coverage: `19-skill-infer-params-perturbed-label-rename.json` (a `uia_invoke` target's on-screen `name` changes between demos while its `automationId` stays constant — asserts the renamed label IS promoted to `${param.name}`, since a relabeled control is a legitimate semantic variation, not something inference should choke on) and `20-skill-infer-params-perturbed-timing.json` (a `wait` step's `ms` duration varies 4x between demos — asserts timing never gets baked in as a required param). Combined with scenario 18 (position-shift), §5.5's "one scenario per generalization axis" checklist item is now fully closed.

**Remaining checklist**

- ✅ Extend eval runner with an HTTP scenario mode.
- ✅ Add at least one perturbed-UI scenario per generalization axis (position shift, label rename, timing variance) — all three axes now covered (`18-skill-infer-params-perturbed-position.json`, `19-skill-infer-params-perturbed-label-rename.json`, `20-skill-infer-params-perturbed-timing.json`).
- ⬜ Add CI gate requiring no regression in scenario pass rate for `automation/eval/scenarios/`.

### 5.6 Per-skill success criteria (runtime observability) — ✅ implemented 2026-07
A generalized skill needs to know whether a run actually worked, or replay/repair/rating are all guessing. Reuse the workspace goal model's existing `successCriteria` field: let the author (or the LLM re-derivation step) attach a lightweight, checkable end-state assertion to a skill (e.g. "a window titled X is focused", "clipboard contains a URL", a `screenshot_check` vision condition). On replay, evaluate it to emit a definitive success/failure — this is what feeds the marketplace `outcome` on ratings (Section 4.1) and decides whether `repairStep` should fire.

**Shipped as** `tools/skill.js` runtime outcome evaluation:
- `skill_run` now computes and returns `outcome` with status + reason code (`passed`/`failed`/`indeterminate`),
- supported criteria types today: `step_ok`, `tool_succeeded`, `clipboard_contains`, `window_focused` (plus explicit indeterminate handling for unsupported/invalid criteria),
- outcome is included in action telemetry payload (`skill_run` audit record),
- failing success criteria now flips overall run status to failed even when raw tool steps succeeded,
- unit coverage added in `tools/skill.test.js` for pass/fail criteria behavior.

> ✅ **Update (2026-07):** the marketplace rating pipe now reads `outcome` back into ranking, closing the "shipped `outcome` field but nothing consumed it" gap. `backend/controllers/marketplaceController.js`'s `rateMarketSkill` aggregates a new `meta.outcomeFailCount` (ADD delta on every rate/re-rate, correctly decrementing when a re-rating flips `outcome` from `"failed"` to anything else) alongside the existing `ratingCount`/`ratingSum`. `metaToSummary` derives `outcomeFailRate = outcomeFailCount / ratingCount` and passes it into `computeTrustScore` (`backend/services/marketplaceRanking.js`), which now applies an explicit `outcomeFailWeight` penalty (`RANKING_WEIGHTS.outcomeFailWeight`) — so a skill with a perfect star average but a high failed-outcome rate from `successCriteria` still ranks below an equally-starred skill whose runs actually pass. 5 new Jest cases across `marketplaceRanking.test.js` and `marketplaceController.test.js` (including an end-to-end "flaky vs. reliable, same stars" ranking-order assertion).

> ✅ **Update (2026-07-16):** `skill_run` now also triggers a repair attempt when every step reported `ok` but the post-run `successCriteria` check still fails — previously only a hard tool-execution error would engage `repairStep`/visual-retarget, so a "silent" criteria failure (all steps technically succeeded, but the end-state check didn't hold) never got a repair chance. The LAST executed step is retried via the same LLM repair fallback (told *why*, via a synthetic `successCriteria failed: <reasonCode> — <detail>` error), then criteria are re-evaluated; a passing retry flips the run back to `failed: false`. Gated by a new `maxCriteriaRepairs` arg (default 1, independent of the existing `maxRepairs`/`repairBackoffMs` per-step-error budget) and surfaced via `skill.repair.*` events with `strategy: 'criteria-retry'` plus a new `summary.criteriaRepairsAttempted` field. 3 new test cases in `tools/skill.test.js`.

**Implementation checklist**

- ✅ Define a minimal, versioned `successCriteria` schema for skills.
- ✅ Evaluate criteria post-run and persist outcome with reason codes.
- ✅ Pass outcome into marketplace rating payload (`outcome`) and telemetry, AND fold it back into ranking (`outcomeFailRate` → `computeTrustScore`, §4.3/§4.6).
- ✅ Trigger `repairStep` only when criteria fail and retry budget remains (`maxCriteriaRepairs`, `strategy: 'criteria-retry'`).
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

## 7. Architecture constraints — 🟡 stack constraints already honored; LLM provider seam (7.1) now shipped for core callers

- **Keep the existing stack**: Electron + Node.js main process/server, Python subprocesses for ML workloads (Whisper STT, MediaPipe eye tracking, webcam/vision). Do not propose a rewrite.
- **Cloud-first AI, with a local/offline option**: default to cloud APIs (GitHub Models today, per `github-models-service.js`) for the "smart" parts (NL compilation, skill generalization, vision fallback) since that's simplest to ship, but preserve the ability to swap in local models later — don't hardcode cloud-only assumptions into new code. Concretely: define a small **LLM provider interface** (`chat`, `chatMultimodal`) and route `agent-loop.js`, `nl-compiler.js`, and `tools/skill.js` through it instead of newing up `GitHubModelsService` directly, so a local backend can be dropped in behind the same seam.
- Reuse existing subsystems rather than reinventing: tool registry, permission gate, event bus (`events.js`), recorder, agent loop, predictor/pattern-learner for proactive suggestions.

### 7.1 LLM provider seam implementation checklist — 🟡 partially implemented 2026-07-16

> ✅ **Implementation update (2026-07-16):** `server/automation/llm-provider.js` (`createLlmProvider(opts)`) is the new provider factory. Every caller that previously did `require('../github-models-service'); new GitHubModelsService()` inline — `agent-loop.js`'s `_lazyLoadLlm()`, `nl-compiler.js`'s `_callLlm()`, and `tools/skill.js`'s `_resolveLlm()` plus its second inline fallback in the `screenshot_check` control-flow handler — now call `createLlmProvider()` instead. This is a **pure instantiation-seam refactor, not an API change**: `createLlmProvider()` returns the exact same shape callers already depended on (`.setToken(token)`, `.chat(opts)`, `.chatWithImage(opts)`), plus additive `providerName`/`capabilities`/`chatMultimodal` fields, so none of the token-resolution or call-site logic around it had to change. The module also ships `createLocalStubProvider()` (a deterministic, network-free adapter — opt-in via `createLlmProvider({ mode: 'local-stub' })`, NOT wired in as an automatic production fallback, since that would be a silent behavior change) and `withRetries(fn, { retries, backoffMs })`, a reusable bounded-retry-with-backoff wrapper applied to `chat`/`chatWithImage`/`chatMultimodal` when `createLlmProvider({ retries })` is called with `retries > 0` (default `retries: 0` preserves prior no-retry behavior exactly). Retries only fire on transient/network-shaped errors (timeouts, connection resets) — never on auth/config errors like "token not configured", so a genuine setup problem still surfaces immediately instead of being masked by pointless retries. 9 new Jest-style cases in `llm-provider.test.js` (pass-through of injected clients, github-models wrapping, local-stub behavior, retry/no-retry/give-up paths), wired into `test:unit`. `vision-fusion.js` and `tools/webcam.js` still instantiate `GitHubModelsService` directly (not in the checklist's originally-named caller list) — routing them through the same seam is the one remaining gap for full checklist completion.

- ✅ Add provider interface module with `chat`, `chatMultimodal`, and capability flags (`llm-provider.js`, `CAPABILITIES`).
- ✅ Implement `github-models` adapter behind the interface without behavior regressions (`_wrapGithubModels` — additive metadata only, zero method-behavior changes).
- 🟡 Route `agent-loop.js`, `nl-compiler.js`, and `tools/skill.js` through the provider factory (all three done — `tools/skill.js` has 2 call sites, both routed; `vision-fusion.js`/`tools/webcam.js`, mentioned only in prose not the checklist, still instantiate directly).
- ✅ Add a local/offline stub adapter for development/testing fallback (`createLocalStubProvider()`).
- ✅ Centralize retries/timeouts/error mapping at the provider boundary (`withRetries()`, opt-in via `createLlmProvider({ retries })`).
- 🟡 Add unit tests proving callers no longer instantiate `GitHubModelsService` directly (proven for the 3 checklisted callers via `llm-provider.test.js` + full `test:unit` regression pass; `vision-fusion.js`/`tools/webcam.js` remain unmigrated).

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
   - ✅ Eval harness now supports an HTTP scenario mode (5.5) with four previously-inert scenarios now live, plus all three perturbed-UI regression axes for `inferParams` (position-shift, label-rename, timing-variance — scenarios `18`/`19`/`20`); only a CI pass-rate gate remains open for 5.5.
2. 🟡 **Privacy scrub pass** (6.1) — scrub engine + preview endpoint + capture-time sensitive-input consent gate shipped.
   - ⬜ Remaining: require scrub-report confirmation in pre-publish UI.
3. 🟡 **Pre-run capability summary** (6.2) — summarizer + preview endpoint + marketplace run-path confirmation gate shipped; server-side re-enforcement at publish/install time now also shipped (`backend/services/marketplaceCapabilities.js`).
   - ⬜ Remaining: enforce mandatory pre-run confirmation UX for marketplace-installed skills.
4. ✅ **Marketplace backend** (4.1–4.2) — public namespace, versioning, install-gated ratings, atomic counters shipped 2026-07 (`backend/controllers/marketplaceController.js` + `backend/services/marketplaceRanking.js`).
   - ✅ `/telemetry/summary` route + addon `getTelemetrySummary` wiring shipped, and now also surfaces the marketplace `downloads`/`installs`/`creations` counters for the requesting author via `getAuthorMarketplaceTotals()`.
5. 🟡 **Marketplace web frontend** (`sthopwood.com/market`, 4.4) + trust ranking + dry-run-first for low-trust skills.
   - ✅ Ranking + `lowTrust` classification now computed server-side (`marketplaceRanking.js`) and returned from install/search responses — the frontend itself is still ⬜ not started.
6. 🟡 **Vision re-targeting on replay** (5.3) — backend recovery path shipped; broaden target coverage + UI messaging remain.
7. ⬜ **Monetization seam** (8) — `requiresPlan` at LLM provider boundary.
8. ⬜ **Onboarding/UX polish** for non-technical users (after core safety + marketplace flows are in place).

Each milestone ships with Jest unit tests and, where it touches the automation loop, an `automation/eval/scenarios/` scenario — matching repo convention.

### 10.1 Next implementation slices (high-confidence, file-targeted)

Use these as concrete "pick up and code" slices in order:

1. ✅ **Marketplace persistence + routes** — shipped 2026-07.
   - `backend/controllers/marketplaceController.js`, `backend/services/marketplaceRanking.js`, `backend/routes/routeData.js`
   - `server/automation/index.js` (addon-side `/api/market/skills*` proxies), `server/automation/workspace-client.js` (client wrappers)
2. ✅ **Telemetry summary plumbing for marketplace counters** — shipped 2026-07.
   - ✅ `server/automation/workspace-client.js` (`getTelemetrySummary`)
   - ✅ backend `/telemetry/summary` endpoint in the portfolio backend service
   - ✅ Summary schema now includes a `marketplace: { downloads, installs, creations, skillCount }` field (`getAuthorMarketplaceTotals()` in `marketplaceController.js`, called from `workspaceController.getTelemetrySummary`).
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

- ✅ Marketplace public namespace + immutable version storage.
- ✅ Install-gated ratings (server-enforced).
- ✅ `/telemetry/summary` endpoint and `getTelemetrySummary` wiring, now including marketplace `downloads`/`installs`/`creations` counters via `getAuthorMarketplaceTotals()`.
- ⬜ Mandatory pre-publish scrub confirmation UI.
- ⬜ Mandatory pre-run capability confirmation UI for installed market skills.

#### P1 — do next

- 🟡 Vision re-targeting fallback path in `repairStep` (core fallback shipped for key tools; broaden coverage + UX surfacing remain).
- 🟡 Tool-version compatibility resolver + downgrade messaging (backend + run gating shipped; UI integration and broader mapping coverage remain).
- 🟡 Recorder sensitive-capture consent gate (`dataCapture.keyboard` + confirmation flow) (backend gate shipped; frontend consent UX polish remains).
- 🟡 Cloud-vision consent and revoke flow (backend gating + revoke/toggle API + deny/grant/revoke tests shipped; frontend consent UX still pending).
- ✅ Per-skill `successCriteria` evaluation + outcome persistence (runtime, telemetry, marketplace ranking integration, AND `repairStep` auto-trigger-on-criteria-failure all shipped — see §5.6).

#### P2 — after core loop is stable

- 🟡 Trust-ranking tuning + low-trust dry-run-first policy hardening (ranking formula + low-trust classifier shipped in `marketplaceRanking.js` with explicit config; further tuning against real usage data remains).
- 🟡 LLM provider seam extraction + local adapter quality pass (§7.1 core seam shipped for `agent-loop.js`/`nl-compiler.js`/`tools/skill.js` + a deterministic local-stub adapter; `vision-fusion.js`/`tools/webcam.js` migration and a real "quality" local adapter, e.g. an actual local model backend rather than the current echo-only stub, remain open).
- ⬜ Monetization gate at provider boundary with tier matrix. *(the provider boundary itself now exists — `createLlmProvider()` in `llm-provider.js` — as the natural place to add `requiresPlan(tier)` per §8, but no gating logic has been added yet)*
- ⬜ Consumer onboarding polish and starter templates.

### 10.3 Release-gate checklist for first marketplace public beta

- ✅ No publish path can bypass scrub + author confirmation (server enforces slug/steps/category validation + author-scope rate limiting, AND now independently re-runs BOTH the privacy/PII scrub pass (`backend/services/marketplaceScrub.js`) AND the declared-vs-actual capability/category mismatch check (`backend/services/marketplaceCapabilities.js`) server-side before persisting — see §4.5).
- ⬜ No run path can bypass permissions/security guardrails. *(unchanged by this update — this is an addon execution-time property, not a marketplace-backend property)*
- 🟡 Installed marketplace skills always show capability summary before first execution. *(backend now returns both `lowTrust` AND `capabilitySummary` on install — see `installMarketSkill`; the mandatory pre-run UI confirmation itself is still not built)*
- 🟡 Low-trust skills default to dry-run-first (`classifyLowTrust()` + `lowTrust` flag now shipped and returned from `installMarketSkill`; the *client-side enforcement* of "actually dry-run first when `lowTrust: true`" is still open).
- ✅ Ratings endpoint rejects users with no install/run proof (`canRate()` gate in `marketplaceController.rateMarketSkill`).
- ✅ Telemetry exposes downloads/installs/creations from server counters (the counters are atomic in `marketplaceController.js`, exposed via `GET /api/data/market/skills` search results, AND now folded into the `/telemetry/summary` endpoint as a `marketplace` field via `getAuthorMarketplaceTotals()`).
- 🟡 All new routes have unit tests and error-path coverage (coverage expanded with `permissions.test`, `tools/skill.test`, `vision-fusion.test`, and now `marketplaceRanking.test`/`marketplaceController.test`/`marketplaceScrub.test`/`marketplaceCapabilities.test` (73 cases, offline — including pagination/sort-stability, telemetry-aggregation, publish-time scrub-enforcement, publish/install-time capability-mismatch-enforcement, and outcome-into-ranking coverage); a `back.test.js`-style live-DynamoDB integration pass for the new routes still remains, matching the pre-existing gap for `workspaceController.js`).

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
