# Project Brief: Simple — Consumer PC Automation Platform

Give this document to your coding agent (Claude Code, etc.) as the starting spec.
It expands on an existing codebase (`simple-addon/`) rather than starting from
scratch — read the existing code first before proposing changes.

## Status legend

- ✅ **Implemented** — landed in code with tests.
- 🟡 **Partially implemented** — backend seam exists, integration/UI/guardrails still open.
- ⬜ **Planned** — not yet implemented.

---

## 1. Vision

Turn the existing `simple-addon` (currently a personal/dev-focused Electron+Node
addon) into a **consumer-facing PC automation platform** where any user can:

1. **Show, don't tell** — demonstrate a task once (mouse, keyboard, webcam, mic,
   screen — any PC input) by just doing it normally.
2. Have the system **generalize** that demonstration into a reusable, robust
   "skill" — not a brittle exact-replay macro.
3. **Share and discover** skills through a public marketplace, so the community
   builds the automation library together.

The product should feel like "recording a Loom, except at the end you have a
robot that can do the thing for you."

## 2. Target user & platform

- **Audience:** general consumers (not just developers/power users) — onboarding and UI must not require technical knowledge.
- **Platform:** Windows only for v1 (matches current addon's PowerShell/UIA/Win32 dependencies). Do not spend effort on cross-platform abstraction yet.
- **Distribution:** desktop installer (NSIS, as today) + a lightweight companion web frontend, similar to the current `sthopwood.com/net` integration pattern.

## 3. Core interaction model

Two complementary flows, both need to exist and interoperate:

- **Demonstration → generalized skill**: user performs a task once (or a few
  times) while the recorder captures mouse, keyboard, focus changes, screen
  state, etc. (see `server/automation/recorder/`). The compiler
  (`recorder/compiler.js`) currently does literal coalescing — this needs to
  become a *generalization* pipeline (see Section 5).
- **Natural language / agent-driven**: user describes a goal in text or voice,
  and the existing agent loop (`server/automation/agent-loop.js`) + tool registry
  (`server/automation/tool-registry.js`) plans and executes it directly,
  optionally invoking a matching skill if one exists (`findRelevantSkills`).

These two flows should feed each other: agent-loop runs should be recordable,
and recorded skills should be describable/searchable in natural language for the
agent to find and reuse.

## 4. Marketplace — 🟡 partially implemented (backend shipped; frontend + UI confirmations open)

> ⚠️ **Scope note:** the marketplace is *not* just "extend the existing skill
> endpoints." Today's skill endpoints (`/api/data/csimple/workspace/skill/*`)
> store **private, per-user** items keyed `csimple_ws_{userId}_{kind}_{slug}`.
> The marketplace needs a **new shared/public namespace** with its own read path
> (anyone can discover) and controlled write path (publish/fork). Treat the
> private workspace skill store and the public marketplace as two distinct
> surfaces that a "publish" action bridges.

### 4.1 Data model (new backend surface)

- **Published skill record** (public, immutable per version): `marketId`, `authorUserId`, `name`, `slug`, `version` (semver), `steps` (scrubbed — see §6.1), `declaredCategories` (the tool categories the skill will invoke), `toolSchemaVersion`, `naturalLanguageDescription` (for search), `createdAt`.
- **Versioning + fork:** publishing a change creates a new immutable version; downloaders pin a version. A user can *fork* a published skill into their private workspace, edit, and re-publish under their own author id.
- **Ratings:** `{ marketId, version, raterUserId, stars (1-5), ranAt, outcome }` — one rating per user per version, only accepted from users who actually downloaded/ran it (prevents drive-by rating).
- **Counters (server-side, the KPI source):** `downloads`, `installs`, `creations` incremented atomically on the marketplace backend — NOT derived from the per-user JSONL action log.
- **Compatibility:** every published skill stores `toolSchemaVersion`. On download, the client compares against its own registry; if a referenced tool is missing/renamed, surface a "partially compatible" warning and degrade gracefully (see §5.4).

### 4.2 API surface — ✅ shipped

> Actual mounted paths are `/api/data/market/skills*` on the backend (since
> `routeData.js` is mounted at `/api/data` for every route). The addon's own
> local server exposes bare `/api/market/skills*` proxies.

| Route (backend: prefix with `/api/data`) | Purpose | Status |
|---|---|---|
| `POST /api/market/skills` | Publish skill (server-side re-scrubs steps before persisting — §4.5) | ✅ Shipped |
| `GET /api/market/skills?q=<nl>&sort=trust\|downloads\|recent` | NL search + ranking | ✅ Shipped |
| `GET /api/market/skills/:marketId[/:version]` | Fetch a specific version | ✅ Shipped |
| `POST /api/market/skills/:marketId/install` | Increment `downloads`/`installs`, return installable scrubbed steps | ✅ Shipped |
| `POST /api/market/skills/:marketId/rate` | Submit run-gated rating | ✅ Shipped |
| `POST /api/market/skills/:marketId/flag` | Community flagging | ✅ Shipped |

**Implemented in:** `backend/controllers/marketplaceController.js` (DynamoDB
`Simple` table, `csimple_market_*` namespace), `backend/services/marketplaceRanking.js`
(pure trust/ranking helpers), `backend/services/marketplaceScrub.js` (server-side
§6.1 scrub port), `backend/services/marketplaceCapabilities.js` (server-side §6.2
mismatch-check port), routes in `backend/routes/routeData.js` behind
`marketReadLimiter`/`marketPublishLimiter`/`marketWriteLimiter`, addon proxies in
`server/automation/index.js`, and `workspace-client.js` wrappers
(`publishMarketSkill`, `searchMarketSkills`, `getMarketSkill`, `installMarketSkill`,
`rateMarketSkill`, `flagMarketSkill`).

### 4.3 Trust model

- **Reputation/rating-based, no manual moderation/code-review queue** (matches Non-goals).
- Ranking signal = rating × volume × author reputation (seeded from account age + prior skill ratings) × recency × outcome-reliability (`outcomeFailRate`, derived from `successCriteria` outcomes on ratings); community flags deprioritize.
- **Cold-start mitigation (design around it, don't skip):** a brand-new skill has zero ratings and could still harm early downloaders. Because the marketplace does NOT pre-review, the *real* safety floor is the execution layer (§6): every downloaded skill runs through the existing permission gate, shell allow/deny-list, and protected-path blocking regardless of what it claims. In addition:
  - New/low-trust skills default to **dry-run-first** on first execution so the user sees exactly what would happen before anything real runs.
  - The pre-run capability summary (§6.2) is mandatory for any skill installed from the marketplace.
- Marketplace success metric: **skill downloads and skill creations** are the primary product KPI. The server-side counters (§4.1) are ✅ shipped and atomic; `/telemetry/summary` also folds in the marketplace `downloads`/`installs`/`creations` counters (`getAuthorMarketplaceTotals()`).

### 4.4 Web frontend — ⬜ not started

- New route `sthopwood.com/market`, mirroring the existing `/net` integration pattern, linked to/from `/net`.
- Search by natural-language description, browse by trust/downloads/recent, view the pre-run capability summary before install.

### 4.5 Marketplace implementation checklist (Definition of Done)

- ✅ Add new public-market storage namespace (not `csimple_ws_*`) with immutable version records.
- ✅ Add server-atomic counters for `downloads`, `installs`, `creations`.
- ✅ Wire publish path to run `scrubForPublish` + `summarizeCapabilities` before persistence (server-side re-scrub + capability-mismatch check).
- ✅ Enforce install-before-rate gating with server-side proof of install/run.
- ✅ Add marketplace routes to `server/automation/index.js` and client wrappers in `workspace-client.js`.
- ✅ Add Jest unit tests for ranking, version pinning, and install/rate gate.
- ✅ Fold marketplace counters into `/telemetry/summary`.
- ⬜ Add at least one eval scenario for the marketplace routes (needs plumbing — marketplace routes live on the portfolio backend, not the addon's `mountAutomation()` server).

### 4.6 Backend schema + ranking backlog — 🟡 mostly shipped

- ✅ Define immutable version key shape `csimple_market_${marketId}_v${version}` with write-once semantics.
- ✅ Add author-scope publish limits/rate limits.
- ✅ Store install/run attestations used for the ratings gate.
- ✅ Persist `outcome` alongside ratings and aggregate it (`outcomeFailRate`) into `computeTrustScore`.
- ✅ Implement ranking weights as explicit config (`RANKING_WEIGHTS`/`LOW_TRUST_THRESHOLDS`).
- ✅ Add deterministic tie-breakers for equal trust score (`sortSkills()`).
- ✅ Add "low-trust" classifier (`classifyLowTrust()`, surfaced as `lowTrust` on install).
- 🟡 Add backend contract tests for pagination/sort stability/install-rate constraints (offline controller tests cover these; a dedicated live-DynamoDB integration pass, `back.test.js`-style, remains).

## 5. Skill generalization — 🟡 partially implemented (5.1/5.2/5.5/5.6 shipped; 5.3/5.4 partial)

Fix the current addon's biggest known weakness: the compiler in `recorder/compiler.js`
only does literal event coalescing (window focus dedup, click/drag/tap
classification) — it does not generalize across variation. Build in this priority order:

### 5.1 LLM re-derivation — ✅ implemented

Given the raw recording trace + a short goal description, have an LLM rewrite the
step sequence into a more robust/abstracted form (e.g. prefer `uia_invoke`/
`click_visual` over raw `click_at` coordinates), similar to how `nl-compiler.js`
already generates steps from English — but sourced from a demonstration instead
of from scratch.

**Where:** `server/automation/recorder/generalize.js` (`generalizeSkill(skill, opts)`),
reusing `nl-compiler.js`'s `validateSteps`/`STEP_SCHEMA_DOCS`/`_callLlm`. Best-effort
by design: LLM failure or schema-invalid output returns the original skill
untouched. Endpoint `POST /api/skill/generalize`. Tests in `generalize.test.js`.

### 5.2 Parameter inference — ✅ implemented

When a user demonstrates the same/similar task multiple times, diff the recordings
to detect what varies (typed text, target names, numeric values) and promote those
into `${param.x}` placeholders (substitution already exists in `tools/skill.js`
`substituteArgs`). Single demo is the default path (5.1 handles it alone);
multi-demo is opt-in via a "demonstrate again" affordance.

**Where:** `server/automation/recorder/infer-params.js` (`inferParams(skills)`).
Positional/non-semantic leaves (pixel `x`/`y`, timing, `path` arrays, image-like
keys) are never promoted. Endpoint `POST /api/skill/infer-params`. Tests in
`infer-params.test.js`.

### 5.3 Vision-based re-targeting — 🟡 partially implemented

At replay time, if a `uia_invoke`/`click_at` step fails because the UI shifted,
fall back to `find_and_click_visual` (`vision-fusion.js`) to relocate an equivalent
element rather than hard-failing. Extend the `repairStep` prompt in `tools/skill.js`
to consider "find a visually/semantically similar element" as a first-class
recovery action.

- ✅ Extend `repairStep` decision tree with an explicit "visual retarget" branch.
- ✅ Preserve original failed selector/context as provenance.
- ✅ Add retry budget + backoff so the fallback cannot loop indefinitely.
- ✅ Emit event-bus telemetry for fallback attempts/success/failure.
- ✅ Add unit tests for recoverable UI-shift failure vs hard-failure.
- 🟡 Broaden target coverage + add UI messaging for the recovered action.

### 5.4 Tool-version graceful degradation — 🟡 partially implemented

Downloaded skills reference tools by name; the registry evolves. Before running
an installed skill, resolve every step's tool against the local registry.
Missing/renamed tools should downgrade the step or surface a clear "this step
can't run on your version" message — never crash mid-skill.

- ✅ Build a compatibility resolver (`analyzeSkillCompatibility`) mapping old tool names to current equivalents, classifying each step `compatible`/`degraded`/`unsupported`.
- ✅ Surface a compatibility summary before run (`POST /api/skill/compatibility`) and gate runs when any step is `unsupported` (`allowUnsupported`).
- ✅ Add deterministic downgrade rules (no LLM needed for straightforward renames).
- ✅ Add tests for mixed-version skill imports and partial execution.
- 🟡 Broader mapping coverage + UI integration remain.

### 5.5 Measure it — reuse the eval harness — ✅ implemented

Generalization is only "better" if it's measurable. Use the existing
`automation/eval/scenarios/` framework: for each generalization change, add
scenarios that (a) replay a recorded trace and (b) assert the generalized skill
still succeeds against a *perturbed* UI (moved window, renamed control, changed
coordinates).

- ✅ Eval runner supports an HTTP scenario mode (real ephemeral `mountAutomation()` server via `eval/http-app.js`).
- ✅ One perturbed-UI scenario per generalization axis (position-shift `18`, label-rename `19`, timing-variance `20`).
- ✅ CI gate: `.github/workflows/ci.yml` `test-simple-addon` job runs `npm run test:unit` + `npm run eval` on every push/PR.

### 5.6 Per-skill success criteria (runtime observability) — ✅ implemented

A generalized skill needs to know whether a run actually worked. Reuse the
workspace goal model's `successCriteria` field: attach a checkable end-state
assertion to a skill (e.g. "a window titled X is focused", "clipboard contains a
URL"). On replay, evaluate it to emit a definitive success/failure — this feeds
the marketplace `outcome` on ratings (§4.1) and decides whether `repairStep` fires.

- ✅ Define a minimal, versioned `successCriteria` schema.
- ✅ Evaluate criteria post-run and persist outcome with reason codes.
- ✅ Pass outcome into marketplace rating + telemetry, and fold it back into ranking (`outcomeFailRate` → `computeTrustScore`).
- ✅ Trigger `repairStep` when criteria fail and retry budget remains (`maxCriteriaRepairs`, `strategy: 'criteria-retry'`).
- ✅ Add tests for criteria pass/fail/indeterminate states.

## 6. Safety & permissions — 🟡 partially implemented (backend seams shipped; UI confirmation flows open)

Keep and extend the existing permission model (`server/automation/permissions.js`,
`security-guard.js`) — do not weaken it for consumer onboarding:

- Category-based approval (`safe-read` / `sandboxed-write` / `shell` / `destructive` / `system`) stays.
- Shell allow/deny-list and protected-path blocking (`security-guard.js`) stays as a hard floor regardless of what a marketplace skill claims.
- No relaxing of the `globalKillSwitch` / dry-run mechanisms.

### 6.1 Privacy / PII scrubbing — ✅ implemented

Recordings capture screen frames, keystrokes, webcam, and mic. A raw recorded
skill can embed passwords, personal file paths, tokens, and screenshots.
**Publishing must not leak this.**

- Mandatory scrub pass before publish: strip absolute user paths (`C:\Users\<name>\...` → `${param.path}`), redact password/secret-shaped strings, drop raw screenshots, promote varying literals to `${param.x}`.
- Reuse the PII-safe fingerprinting in `pattern-learner.js` and honor the sensitive-capture consent gate (`permissions.dataCapture.keyboard`, `confirmSensitiveCapture`).
- Pre-publish UI must show a "what will be shared" review and require explicit confirmation.

**Where:** `server/automation/recorder/scrub.js` (`scrubForPublish(skill)`), with a
`report` that never includes the original sensitive value. Preview endpoint
`POST /api/skill/scrub`. Capture-time keyboard-consent gate is also in place.

### 6.2 Inspect-before-run capability summary — ✅ implemented

Marketplace skills should be **inspectable before running** — generate a
human-readable summary of what a skill will do, and flag any mismatch between
*declared* categories and what the steps *actually* invoke. Mandatory before
first run of any installed skill.

**Where:** `server/automation/capability-summary.js` (`summarizeCapabilities(skill)`),
resolving every step through the same `_normaliseStep` the executor uses.
Preview endpoint `POST /api/skill/capabilities`.

### 6.3 Cloud-vision consent — 🟡 partially implemented

The generalization and vision-fallback paths send **screen captures to a cloud
multimodal LLM** (`vision-fusion.js`, proxied through the backend to AWS Bedrock).
Require explicit, revocable consent before any screen frame leaves the device,
show which paths use it, and make the local/offline model seam (§7) the escape
hatch for privacy-sensitive users. Separate from the keyboard-capture consent (§6.1).

- ✅ Persist consent state (`dataCapture.keyboard`, `cloudVision.granted`) with policy versioning.
- ✅ Block multimodal calls when consent is absent/revoked, with actionable errors.
- ✅ Log consent grant/revoke events with structured metadata.
- ✅ Consent endpoints (`GET/PUT /api/automation/consents`, `GET /api/recorder/consent-status`).
- ✅ Tests for allow/deny/revoke flows.
- ⬜ Add first-use consent modal with plain-language data-egress description.

### 6.4 Remaining safety checklist

- ✅ Keyboard/sensitive-capture consent gate in the recorder pipeline.
- 🟡 Block publish/install on explicit pre-run capability confirmation in UI (backend enforcement shipped; UI flow pending).
- 🟡 Require cloud-vision consent before any multimodal upload path (`vision-fusion.js` + `screenshot_check` gated; future paths need wiring).
- 🟡 Add revoke/toggle UI and persist consent state (backend shipped; UI pending).
- 🟡 Ensure every deny path surfaces a user-visible reason (consent/capability deny paths done; remaining non-consent deny-path audit open).

## 7. Architecture constraints — ✅ provider seam shipped

- **Keep the existing stack**: Electron + Node.js main process/server, Python subprocesses for ML workloads (Whisper STT, MediaPipe eye tracking, webcam/vision). Do not propose a rewrite.
- **Cloud-first AI, with a local/offline option**: default to cloud APIs (AWS Bedrock — Claude Haiku 4.5 — proxied through the portfolio backend) for the "smart" parts (NL compilation, skill generalization, vision fallback); preserve the ability to swap in local models later. Define a small **LLM provider interface** (`chat`, `chatMultimodal`) and route all callers through it.
- Reuse existing subsystems rather than reinventing: tool registry, permission gate, event bus (`events.js`), recorder, agent loop, predictor/pattern-learner.

### 7.1 LLM provider seam — ✅ implemented

- ✅ Provider factory `server/automation/llm-provider.js` (`createLlmProvider(opts)`), returning the same `.setToken`/`.chat`/`.chatWithImage` shape callers already used.
- ✅ All LLM-calling modules route through it: `agent-loop.js`, `nl-compiler.js`, `tools/skill.js`, `vision-fusion.js`, `tools/webcam.js`.
- ✅ `createLocalStubProvider()` — deterministic, offline, opt-in adapter for dev/testing.
- ✅ `withRetries()` — bounded retry+backoff at the provider boundary (skips auth/config errors).
- ✅ Default adapter is `backend-proxy` (proxies through `/api/data/csimple/agent-chat` / `agent-vision`); the old per-user GitHub PAT model is gone (`github-models-service.js` deleted).
- ✅ Unit tests proving callers no longer instantiate `GitHubModelsService` directly.

## 8. Monetization — ⬜ planned

Freemium:

- **Free**: core recording/replay, local skill library, manual triggers (hotkey/voice), basic agent loop.
- **Paid**: cloud AI features (better generalization models, compute-heavy vision fallback, priority marketplace placement) — needs a clean seam so free users aren't blocked from the core loop, only from AI-heavy upgrades.
- **Concrete seam:** reuse the portfolio backend's existing Stripe integration (`backend/services/stripeService.js`, `backend/constants/pricing.js`) and tiers. Add a single `requiresPlan(tier)` check at the **cloud-AI call boundary** (the LLM provider interface, §7) — do NOT scatter plan checks through feature code. Downgrade/expiry must gracefully fall back to the free path, never break an installed skill's core replay.

### 8.1 Monetization checklist — ⬜ planned

- ⬜ Implement `requiresPlan(tier)` at the provider boundary only.
- ⬜ Map each cloud-heavy capability to a minimum tier in one config table.
- ⬜ Ensure plan downgrade immediately flips to free/local path without skill-execution breakage.
- ⬜ Add clear UX copy when a premium-only path is blocked.
- ⬜ Add integration tests for free, paid, expired, and grace-period states.

### 8.2 Example marketable use cases

Concrete "show don't tell" scenarios for marketing copy, demo videos, and
onboarding — each a plausible single-demo recording a non-technical user could
do in under a minute, in plain language with the payoff up front.

1. **Never organize your downloads again** — show it once, and every messy file sorts itself into the right folder forever.
2. **Grind your video game while you live your life** — show it the repetitive part once, then it keeps playing while you're away.
3. **Fill out the same form a hundred times without lifting a finger** — it repeats your exact answers as many times as you need.
4. **Turn 10,000 messy photos into a perfectly organized album overnight** — it renames your whole collection while you sleep.
5. **Copy information between programs like a tireless assistant** — it does the rest of your list for you.
6. **Get your daily report done before you sit down** — it builds, saves, and emails it every morning.
7. **Post once, appear everywhere** — it shares the same thing to all your accounts automatically.
8. **Wake up to a clean, sorted inbox** — it keeps your email tidy around the clock.
9. **Turn a shoebox of receipts into a finished budget** — it reads and totals them for you.
10. **Keep your game character stocked and ready 24/7** — it handles the repetitive shopping, crafting, and cleanup.
11. **Make a whole folder of photos look professional in seconds** — it applies your edit to every photo.
12. **Never miss a sold-out item again** — it watches the site and grabs it the instant it restocks.
13. **Turn messy meeting notes into something you'd actually send** — it hands back a clean summary.
14. **Set up a brand-new computer exactly the way you like in minutes** — it repeats your setup on any future PC.
15. **Have a tireless assistant watch your files for problems** — it flags what needs your attention.
16. **Keep your entire media collection perfectly organized** — new downloads sort themselves, labeled and ready.
17. **Apply to dozens of jobs or apartments while you do something else** — it repeats your info across listings.
18. **Never manually build an expense report again** — it gathers, sorts, and submits.
19. **Back up what matters most, automatically, forever** — important folders copy on a schedule you set once.
20. **Run your entire livestream like a one-person production team** — it switches scenes, fires commands, and saves highlights on cue.

## 9. Non-goals for this phase

- No cross-platform (Mac/Linux) support yet.
- No manual marketplace moderation/review queue.
- No enterprise/B2B features (SSO, team management, audit export) — this is a consumer product.
- No fixed deadline — this is an ongoing, iterative build; structure work as a prioritized backlog.

## 10. Suggested first milestones (prioritized backlog)

Ordered by value-per-risk. Ship the core "show don't tell" loop before the
marketplace, and ship privacy scrubbing before *any* publish path.

1. ✅ **Generalization MVP** — LLM re-derivation (5.1) + multi-demo parameter inference (5.2).
2. 🟡 **Privacy scrub pass** (6.1) — scrub engine + preview endpoint + capture-time consent gate shipped. ⬜ Remaining: scrub-report confirmation in pre-publish UI.
3. 🟡 **Pre-run capability summary** (6.2) — summarizer + preview endpoint shipped. ⬜ Remaining: mandatory pre-run confirmation UX.
4. ✅ **Marketplace backend** (4.1–4.2) — public namespace, versioning, install-gated ratings, atomic counters.
5. 🟡 **Marketplace web frontend** (4.4) + trust ranking + dry-run-first — ranking + `lowTrust` classification shipped server-side; the `/market` frontend itself is ⬜ not started.
6. 🟡 **Vision re-targeting on replay** (5.3) — backend recovery path shipped; broaden coverage + UI messaging remain.
7. ⬜ **Monetization seam** (8) — `requiresPlan` at the LLM provider boundary.
8. ⬜ **Onboarding/UX polish** for non-technical users.

Each milestone ships with Jest unit tests and, where it touches the automation
loop, an `automation/eval/scenarios/` scenario.

### 10.1 Next implementation slices (file-targeted)

1. ✅ **Marketplace persistence + routes** — `backend/controllers/marketplaceController.js`, `backend/services/marketplaceRanking.js`, `backend/routes/routeData.js`; addon proxies in `server/automation/index.js` + wrappers in `server/automation/workspace-client.js`.
2. ✅ **Telemetry plumbing for marketplace counters** — `server/automation/workspace-client.js` (`getTelemetrySummary`) + backend `/telemetry/summary` (now includes a `marketplace` field via `getAuthorMarketplaceTotals()`).
3. **Capability/scrub UI confirmations** — frontend route(s) following the `/net` integration pattern.
4. **Recorder consent gate** — `server/automation/permissions.js` + recorder capture pipeline under `server/automation/recorder/`.
5. **Vision replay repair fallback** — `server/automation/tools/skill.js` (`repairStep`) + `server/automation/vision-fusion.js`.

### 10.2 Sprint-ready backlog of not-done items

#### P0 — do now

- ✅ Marketplace public namespace + immutable version storage.
- ✅ Install-gated ratings (server-enforced).
- ✅ `/telemetry/summary` including marketplace counters.
- ⬜ Mandatory pre-publish scrub confirmation UI.
- ⬜ Mandatory pre-run capability confirmation UI for installed market skills.

#### P1 — do next

- 🟡 Vision re-targeting: broaden coverage + UX surfacing.
- 🟡 Tool-version compatibility: UI integration + broader mapping coverage.
- 🟡 Recorder sensitive-capture consent: frontend consent UX polish.
- 🟡 Cloud-vision consent: frontend consent UX still pending.
- ✅ Per-skill `successCriteria` evaluation + outcome persistence (runtime, telemetry, ranking, and auto-repair all shipped).

#### P2 — after core loop is stable

- 🟡 Trust-ranking tuning + low-trust dry-run-first hardening (formula + classifier shipped; tune against real usage).
- 🟡 LLM provider local adapter quality pass (deterministic stub shipped; a real local model backend remains).
- ⬜ Monetization gate at provider boundary with tier matrix.
- ⬜ Consumer onboarding polish and starter templates.

### 10.3 Release-gate checklist for first marketplace public beta

- ✅ No publish path can bypass scrub + author confirmation (server enforces validation + rate limits, and independently re-runs the privacy scrub and capability-mismatch check before persisting).
- ⬜ No run path can bypass permissions/security guardrails (addon execution-time property — unchanged).
- 🟡 Installed marketplace skills always show capability summary before first execution (backend returns `lowTrust` + `capabilitySummary` on install; the mandatory pre-run UI confirmation is not yet built).
- 🟡 Low-trust skills default to dry-run-first (`classifyLowTrust()` + `lowTrust` flag shipped; client-side enforcement of "actually dry-run first when `lowTrust: true`" is still open).
