# Simple — Consumer PC Automation Platform (Plan & Architecture)

Single source of truth for the Simple platform: vision, architecture, current
state, the core agent loop, and the living roadmap/to-do. This merged the former
`simple-agent-prompt.md`, `ACTION_PLAN.md`, `AUTOMATION_ROADMAP.md`, and
`OBSERVE-ORIENT-GOAL-PLAN-ACTION.md` (2026-09-07). Security/threat model stays
in [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md).

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

The product should feel like "recording a Loom, except the result is a robot
that can do the thing for you."

## 2. Target user & platform

- **Audience:** general consumers (not just developers/power users) — onboarding and UI must not require technical knowledge.
- **Platform:** Windows only for v1 (matches current addon's PowerShell/UIA/Win32 dependencies).
- **Distribution:** desktop installer (NSIS, as today) + a lightweight companion web frontend (`sthopwood.com/net` integration pattern).

## 3. Core interaction model

Two complementary flows, both need to exist and interoperate:

- **Demonstration → generalized skill**: user performs a task once (or a few
  times) while the recorder captures mouse, keyboard, focus, screen state (see
  `server/automation/recorder/`). The compiler (`recorder/compiler.js`) currently
  does literal coalescing — the generalization pipeline is Section 5.
- **Natural language / agent-driven**: user describes a goal in text or voice,
  and the agent loop (`server/automation/agent-loop.js`) + tool registry
  (`server/automation/tool-registry.js`) plans and executes it directly, optionally
  invoking a matching skill (`findRelevantSkills`). The loop itself is the
  Observe → Orient → Goal → Plan → Action loop (Section 11).

These two flows feed each other: agent-loop runs are recordable, and recorded
skills are describable/searchable so the agent can find and reuse them.

## 4. Marketplace — 🟡 mostly shipped (backend, /market frontend, and pre-run capability + dry-run-first enforcement done; eval scenario + live-DynamoDB pass remain)

> ⚠️ **Scope note:** the marketplace is *not* "extend the existing skill
> endpoints." Today's skill endpoints (`/api/data/csimple/workspace/skill/*`)
> store **private, per-user** items keyed `csimple_ws_{userId}_{kind}_{slug}`.
> The marketplace needs a **new shared/public namespace** with its own read path
> (anyone can discover) and controlled write path (publish/fork).
> Link to it on the addon dashboard, /net, and /simple UIs

### 4.1 Data model (new backend surface)

- **Published skill record** (public, immutable per version): `marketId`, `authorUserId`, `name`, `slug`, `version` (semver), `steps` (scrubbed — see §6.1), `declaredCategories`, `toolSchemaVersion`, `naturalLanguageDescription`, `createdAt`.
- **Versioning + fork:** publishing creates a new immutable version; downloaders pin a version. A user can *fork* a published skill into their private workspace, edit, and re-publish.
- **Ratings:** `{ marketId, version, raterUserId, stars, ranAt, outcome }` — one rating per user per version, only from users who actually downloaded/ran it.
- **Counters (server-side, the KPI source):** `downloads`, `installs`, `creations` incremented atomically on the backend — NOT derived from the per-user action log.
- **Compatibility:** every published skill stores `toolSchemaVersion`; on download the client compares against its own registry and degrades gracefully (§5.4).

### 4.2 API surface — ✅ shipped

> Mounted at `/api/data/market/skills*` on the backend (`routeData.js` is mounted
> at `/api/data`). The addon's local server exposes bare `/api/market/skills*` proxies.

| Route (backend: prefix with `/api/data`) | Purpose | Status |
|---|---|---|
| `POST /api/market/skills` | Publish skill (server-side re-scrub before persisting — §4.5) | ✅ Shipped |
| `GET /api/market/skills?q=<nl>&sort=trust\|downloads\|recent` | NL search + ranking | ✅ Shipped |
| `GET /api/market/skills/:marketId[/:version]` | Fetch a specific version | ✅ Shipped |
| `POST /api/market/skills/:marketId/install` | Increment `downloads`/`installs`, return installable scrubbed steps | ✅ Shipped |
| `POST /api/market/skills/:marketId/rate` | Submit run-gated rating | ✅ Shipped |
| `POST /api/market/skills/:marketId/flag` | Community flagging | ✅ Shipped |

**Implemented in:** `backend/controllers/marketplaceController.js` (DynamoDB
`Simple` table, `csimple_market_*` namespace), `backend/services/marketplaceRanking.js`
(pure trust/ranking helpers), `backend/services/marketplaceScrub.js` (§6.1 scrub
port), `backend/services/marketplaceCapabilities.js` (§6.2 mismatch-check port),
routes in `backend/routes/routeData.js`, addon proxies in `server/automation/index.js`,
and `workspace-client.js` wrappers.

### 4.3 Trust model

- **Reputation/rating-based, no manual moderation/code-review queue** (matches Non-goals).
- Ranking signal = rating × volume × author reputation × recency × outcome-reliability (`outcomeFailRate`, derived from `successCriteria` outcomes); community flags deprioritize.
- **Cold-start mitigation:** the *real* safety floor is the execution layer (§6) — every downloaded skill runs through the permission gate, shell allow/deny-list, and protected-path blocking regardless of what it claims. In addition:
  - New/low-trust skills default to **dry-run-first** on first execution.
  - The pre-run capability summary (§6.2) is mandatory for any marketplace install.
- Marketplace success metric: **skill downloads and creations** are the primary KPI; `/telemetry/summary` folds in the marketplace counters.

### 4.4 Web frontend — ✅ shipped

- Route `sthopwood.com/market` (`frontend/src/pages/Simple/Market/`): NL search, sort by trust/downloads/recent, detail modal with the pre-run capability summary, install → rate → flag, publish modal with scrub review, and save-to-addon (or JSON download).

### 4.5 Marketplace implementation checklist (Definition of Done)

- ✅ Public-market storage namespace (not `csimple_ws_*`) with immutable version records.
- ✅ Server-atomic counters for `downloads`, `installs`, `creations`.
- ✅ Publish path runs `scrubForPublish` + `summarizeCapabilities` before persistence.
- ✅ Install-before-rate gating with server-side proof of install/run.
- ✅ Marketplace routes in `server/automation/index.js` + client wrappers in `workspace-client.js`.
- ✅ Jest unit tests for ranking, version pinning, install/rate gate.
- ✅ Marketplace counters folded into `/telemetry/summary`.
- ✅ Eval scenarios for the marketplace proxy routes — `26-marketplace-publish-http`, `27-marketplace-search-http`, `28-marketplace-get-http`, `29-marketplace-install-http` (`server/automation/eval/scenarios/`), offline via the request-scoped `X-Simple-Eval-Stub: 1` header + `marketplace-eval-stub.js` (the addon's `/api/market/skills*` proxies swap in an in-memory client, so no live backend/JWT is needed).

### 4.6 Backend schema + ranking backlog — 🟡 mostly shipped

- ✅ Immutable version key shape `csimple_market_${marketId}_v${version}` with write-once semantics.
- ✅ Author-scope publish limits/rate limits.
- ✅ Install/run attestations for the ratings gate.
- ✅ `outcome` aggregated into ranking (`outcomeFailRate` → `computeTrustScore`).
- ✅ Ranking weights as explicit config (`RANKING_WEIGHTS`/`LOW_TRUST_THRESHOLDS`).
- ✅ Deterministic tie-breakers (`sortSkills()`).
- ✅ "Low-trust" classifier (`classifyLowTrust()`, surfaced as `lowTrust` on install).
- 🟡 Backend contract tests for pagination/sort stability/install-rate constraints (offline tests cover these; a live-DynamoDB integration pass, `back.test.js`-style, remains).

## 5. Skill generalization — ✅ implemented

Fix the addon's biggest weakness: `recorder/compiler.js` only does literal event
coalescing — it does not generalize across variation. Build in this priority order:

### 5.1 LLM re-derivation — ✅ implemented

Given the raw recording trace + a short goal description, have an LLM rewrite the
step sequence into a more robust/abstracted form (prefer `uia_invoke`/`click_visual`
over raw `click_at`), similar to how `nl-compiler.js` generates steps from English.

**Where:** `server/automation/recorder/generalize.js` (`generalizeSkill(skill, opts)`).
Best-effort by design — LLM failure or schema-invalid output returns the original
skill. Endpoint `POST /api/skill/generalize`. Tests in `generalize.test.js`.

### 5.2 Parameter inference — ✅ implemented

When a user demonstrates the same task multiple times, diff the recordings to
detect what varies and promote those into `${param.x}` placeholders (`tools/skill.js`
`substituteArgs`). Single demo is the default; multi-demo is opt-in.

**Where:** `server/automation/recorder/infer-params.js` (`inferParams(skills)`).
Pixel `x`/`y`, timing, `path` arrays, and image-like keys are never promoted.
Endpoint `POST /api/skill/infer-params`. Tests in `infer-params.test.js`.

### 5.3 Vision-based re-targeting — ✅ implemented

At replay time, if a `uia_invoke`/`click_at` step fails because the UI shifted,
fall back to `find_and_click_visual` (`vision-fusion.js`) rather than hard-failing.
Extend `repairStep` in `tools/skill.js` to consider "find a visually similar element."

- ✅ Explicit "visual retarget" branch in `repairStep`.
- ✅ Provenance, retry budget + backoff, event-bus telemetry, unit tests.
- ✅ UI messaging for the recovered action — the ShortcutsManager run banner now
  reports "recovered N step(s) automatically" when `repairsTotal > 0` (visual
  retarget / LLM repair), alongside the existing per-step `repairs` debug detail.
- ✅ Broaden target coverage — visual retarget now covers `uia_invoke`, `click_at`,
  and `browser_click` (web elements that move/change); `_deriveVisualQuery`
  derives a description from the step's args for any failing click-like step.
  Tested in `tools/skill.test.js`.

### 5.4 Tool-version graceful degradation — ✅ implemented

Before running an installed skill, resolve every step's tool against the local
registry; missing/renamed tools downgrade the step or surface a clear message —
never crash mid-skill.

- ✅ Compatibility resolver (`analyzeSkillCompatibility`), preview endpoint, `allowUnsupported` gate, deterministic downgrade rules, tests.
- ✅ UI integration — the marketplace install modal now shows a "Compatibility
  with your addon" summary (compatible / adjusted / unsupported counts + per-step
  findings) via `previewSkillCompatibility` → `POST /api/skill/compatibility`.
- ✅ Broader mapping coverage — `TOOL_ALIASES`/`TOOL_FALLBACKS` now cover common
  legacy/alternate names across fs / window / input / UIA / browser / screen /
  shell / app / audio / skill tools (plus a `click_at → find_and_click_visual`
  cross-version fallback); tested in `tools/skill.test.js`. New renames should
  still be added here as they land.

### 5.5 Measure it — reuse the eval harness — ✅ implemented

Use the `automation/eval/scenarios/` framework: each generalization change adds
scenarios that (a) replay a trace and (b) assert the skill still succeeds against
a *perturbed* UI (moved window, renamed control, changed coordinates).

- ✅ Eval runner supports an HTTP scenario mode (real ephemeral `mountAutomation()` server via `eval/http-app.js`).
- ✅ One perturbed-UI scenario per axis (position-shift `18`, label-rename `19`, timing-variance `20`).
- ✅ CI gate: `.github/workflows/ci.yml` `test-simple-addon` job runs `npm run test:unit` + `npm run eval` on every push/PR.

### 5.6 Per-skill success criteria (runtime observability) — ✅ implemented

Attach a checkable end-state assertion to a skill (`successCriteria`, e.g. "a window
titled X is focused"). On replay, evaluate it to emit a definitive success/failure —
this feeds the marketplace `outcome` on ratings (§4.1) and decides whether `repairStep` fires.

- ✅ Versioned `successCriteria` schema; post-run evaluation with reason codes.
- ✅ Outcome folded into rating + telemetry + ranking (`outcomeFailRate`).
- ✅ `repairStep` on criteria failure (`maxCriteriaRepairs`, `strategy: 'criteria-retry'`).
- ✅ Tests for pass/fail/indeterminate states.

## 6. Safety & permissions — 🟡 partially implemented (backend seams + consent UI shipped; deny-path audit + future multimodal wiring open)

Keep and extend the existing permission model (`server/automation/permissions.js`,
`security-guard.js`) — do not weaken it for consumer onboarding. Category-based
approval, shell allow/deny-list, protected-path blocking, and the
`globalKillSwitch`/dry-run mechanisms all stay.

### 6.1 Privacy / PII scrubbing — ✅ implemented

Recordings capture screen frames, keystrokes, webcam, and mic; a raw recorded skill
can embed passwords, personal paths, tokens, and screenshots. **Publishing must not
leak this.**

- Mandatory scrub pass before publish: strip absolute user paths, redact secret-shaped strings, drop raw screenshots, promote varying literals to `${param.x}`.
- Reuse the PII-safe fingerprinting in `pattern-learner.js`; honor the sensitive-capture consent gate (`permissions.dataCapture.keyboard`, `confirmSensitiveCapture`).
- Pre-publish UI must show a "what will be shared" review and require explicit confirmation.

**Where:** `server/automation/recorder/scrub.js` (`scrubForPublish(skill)`); the
report never includes the original sensitive value. Preview endpoint `POST /api/skill/scrub`.

### 6.2 Inspect-before-run capability summary — ✅ implemented

Generate a human-readable summary of what a skill will do, and flag any mismatch
between *declared* categories and what the steps *actually* invoke. Mandatory before
first run of any installed skill.

**Where:** `server/automation/capability-summary.js` (`summarizeCapabilities(skill)`).
Preview endpoint `POST /api/skill/capabilities`.

### 6.3 Cloud-vision consent — ✅ implemented

The generalization and vision-fallback paths send screen captures to a cloud LLM
(`vision-fusion.js`, proxied to AWS Bedrock). Require explicit, revocable consent
before any frame leaves the device, show which paths use it, and make the
local/offline model seam (§7) the escape hatch.

- ✅ Persisted consent state (`dataCapture.keyboard`, `cloudVision.granted`) with policy versioning.
- ✅ Block multimodal calls when consent is absent/revoked, with actionable errors.
- ✅ Consent endpoints (`GET/PUT /api/automation/consents`, `GET /api/recorder/consent-status`) + audit events.
- ✅ Tests for allow/deny/revoke flows.
- ✅ First-use consent modal with plain-language data-egress description — `frontend/src/components/SimpleAddon/PermissionsManager.jsx` shows a confirmation modal (what is shared, where it goes, how to revoke) before the first grant of keyboard capture or cloud vision.

### 6.4 Remaining safety checklist

- ✅ Keyboard/sensitive-capture consent gate in the recorder pipeline.
- ✅ Block publish/install on explicit pre-run capability confirmation (server 403 until confirmed + addon-dashboard review UI; low-trust skills also dry-run-first).
- 🟡 Require cloud-vision consent before any multimodal upload path (`vision-fusion.js` + `screenshot_check` gated; future paths need wiring).
- ✅ Revoke/toggle UI with persisted consent state — `PermissionsManager.jsx` surfaces both sensitive consents with on/off toggles + the §6.3 first-use modal; state persists via the addon permissions file and syncs to the account (`kind=settings`, `slug=automation-consents`).
- ✅ Ensure every deny path surfaces a user-visible reason — tool-permission
  denials now name the blocker (`permissions.requestApproval` distinguishes the
  emergency kill switch, a per-tool `deny` override, and a category `deny`),
  joining the already-specific consent/capability 403s. Tests in
  `permissions.test.js`.

## 7. Architecture — ✅ provider seam shipped

- **Keep the existing stack**: Electron + Node.js main process/server, Python subprocesses for ML (Whisper STT, MediaPipe eye tracking, webcam/vision). Do not rewrite.
- **Cloud-first AI, with a local/offline option**: default to AWS Bedrock (Claude Haiku 4.5) proxied through the portfolio backend; preserve the ability to swap in local models. Define a small **LLM provider interface** (`chat`, `chatMultimodal`) and route all callers through it.
- Reuse existing subsystems: tool registry, permission gate, event bus, recorder, agent loop, predictor/pattern-learner.

### Architecture overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INPUT (Perception): Webcam · Audio/Mic · Screen · Key/Mouse                │
│                          → PERCEPTION BUS (perception-bus.js)               │
├─────────────────────────────────────────────────────────────────────────────┤
│  INTERPRETATION: Vision (multimodal LLM) · Audio (Whisper) · Predictor      │
├─────────────────────────────────────────────────────────────────────────────┤
│  SYNTHESIS: AGENT LOOP (Observe → Orient → Goal → Plan → Action, §11)       │
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
| Agent loop (O-O-G-P-A) | `server/automation/agent-loop.js` (see §11) |
| Recorder + skill compiler/runner | `server/automation/recorder/*`, `server/automation/tools/skill.js` |
| Perception / UIA / browser / OCR tools | `server/automation/tools/*`, `server/automation/perception*.js` |
| Cloud audit + workspace client | `server/automation/workspace-client.js` |
| Live web panel + chat `/run` `/agent` | `frontend/src/components/SimpleAddon/*`, `SimpleChat.jsx` |
| Eval harness | `server/automation/eval/` |

### 7.1 LLM provider seam — ✅ implemented

- ✅ Provider factory `server/automation/llm-provider.js` (`createLlmProvider(opts)`).
- ✅ All LLM-calling modules route through it: `agent-loop.js`, `nl-compiler.js`, `tools/skill.js`, `vision-fusion.js`, `tools/webcam.js`.
- ✅ `createLocalStubProvider()` (deterministic, offline, opt-in) + `withRetries()` (bounded retry, skips auth/config errors).
- ✅ Default adapter is `backend-proxy` (`/api/data/csimple/agent-chat` / `agent-vision`); the old per-user GitHub PAT model is gone.
- ✅ Unit tests proving callers no longer instantiate `GitHubModelsService` directly.

## 8. Monetization — 🟡 provider-boundary credit gate shipped (UX copy + full integration matrix remain)

Freemium, gated at one seam (the LLM provider interface, §7.1) — not scattered
through feature code. Downgrade/expiry falls back to the free path without
breaking an installed skill's core replay.

### Decided tier model

| What | Free | Pro |
|---|---|---|
| Price | $0 | $15/mo (or $144/yr) |
| AI chat — Bedrock Claude Haiku 4.5, metered | $0.50/mo credit | $10/mo credit |
| OCR — platform-funded, metered | same credit allowance | same credit allowance |
| Local automation & addon | Unlimited (fair use) | Unlimited (fair use) |
| Cloud storage | 100 MB | 50 GB |
| Live phone viewing | — | Included |
| Support | Community | Email |

Locked decisions: **no BYOK** (all cloud AI is operator-funded and metered);
**OCR platform-funded**; **cancellation deferred to period end**; **annual billing**;
**no automation command cap**. (The admin `Special` flag can grant a specific user
unlimited credits — see [`special-user-flag.md`](special-user-flag.md); it's an admin
tool, not a documented tier.)

### 8.1 Monetization checklist — 🟡 partially implemented (provider-boundary gate shipped)

The meter already lived in `backend/utils/apiUsageTracker.js`
(`MEMBERSHIP_LIMITS` / `getMembershipLimit` / `canMakeApiCall` / `trackApiUsage`).
The gap was **enforcement at the provider boundary** — `agent-chat`/`agent-vision`
invoked Bedrock without checking it. That gate now exists.

- ✅ Enforce the credit limit at the provider boundary only — `agentChatProxy` /
  `agentVisionProxy` (`backend/controllers/workspaceController.js`) call
  `canMakeApiCall` before Bedrock, return a structured 402 (`planRequired`,
  `membership`, `limit`, `creditsRemaining`, `upgradeUrl`) when blocked, then
  `trackApiUsage` with the real token counts after success.
- ✅ Per-tier limits in one config table — `MEMBERSHIP_LIMITS` (Free $0.50 / Pro
  $10) in `backend/utils/apiUsageTracker.js`; local automation stays unmetered.
- 🟡 Downgrade immediately reflects in the limit — `getMembershipLimit(userRank)`
  resolves the rank from Stripe per call, so a downgrade/cancel drops the
  allowance on the next cloud-LLM call. (Grace-period copy and the local-path
  fallback for chat remain.)
- ✅ Blocked-call UX copy — `SimpleChat.jsx` already renders an "Usage Limit
  Reached → Upgrade" message for 402/credit/limit errors in both chat paths
  (and `dataService.js` shows upgrade toasts). The structured fields
  (`planRequired`/`membership`/`limit`/`creditsRemaining`/`upgradeUrl`) now also
  flow through `workspace-client.js` for richer copy later.
- 🟡 Integration tests — route gate covered in
  `backend/controllers/workspaceAgentGate.test.js`; the free/paid/expired/
  grace state machine now has unit coverage in
  `backend/utils/apiUsageTracker.test.js` (`getMembershipLimit`,
  `needsMonthlyReset`, `performMonthlyReset`). A full route-layer pass against
  real DynamoDB/Stripe fixtures remains.

### 8.2 Example marketable use cases

Concrete "show don't tell" scenarios for marketing/onboarding — each a plausible
single-demo recording in plain language with the payoff up front.

1. **Never organize your downloads again** — show it once; every messy file sorts itself forever.
2. **Grind your video game while you live your life** — show it the repetitive part; it keeps playing.
3. **Fill out the same form a hundred times** — it repeats your exact answers.
4. **Turn 10,000 photos into an organized album overnight** — it renames your collection.
5. **Copy information between programs** — it does the rest of your list.
6. **Get your daily report before you sit down** — it builds, saves, and emails it.
7. **Post once, appear everywhere** — it shares to all your accounts.
8. **Wake up to a clean inbox** — it keeps email tidy around the clock.
9. **Turn a shoebox of receipts into a budget** — it reads and totals them.
10. **Keep your game character stocked 24/7** — it handles shopping/crafting/cleanup.
11. **Make a folder of photos look professional** — it applies your edit to every photo.
12. **Never miss a sold-out item** — it watches and grabs it on restock.
13. **Turn messy notes into something you'd send** — it hands back a clean summary.
14. **Set up a new computer in minutes** — it repeats your setup.
15. **A tireless assistant for your files** — it flags what needs attention.
16. **Keep your media collection organized** — new downloads sort themselves.
17. **Apply to dozens of jobs while you do something else** — it repeats your info.
18. **Never build an expense report again** — it gathers, sorts, submits.
19. **Back up what matters, automatically** — copies on a schedule.
20. **Run your livestream like a one-person crew** — it switches scenes and saves clips.

## 9. Non-goals for this phase

- No cross-platform (Mac/Linux) support yet.
- No manual marketplace moderation/review queue.
- No enterprise/B2B features (SSO, team management, audit export) — consumer product.
- No fixed deadline — ongoing, iterative build; structure work as a prioritized backlog.

## 10. Roadmap & backlog

Ordered by value-per-risk. Ship the core "show don't tell" loop before the
marketplace, and ship privacy scrubbing before *any* publish path.

1. ✅ **Generalization MVP** — LLM re-derivation (5.1) + multi-demo parameter inference (5.2).
2. 🟡 **Privacy scrub pass** (6.1) — scrub engine + preview endpoint + consent gate shipped. ⬜ Remaining: scrub-report confirmation in pre-publish UI.
3. 🟡 **Pre-run capability summary** (6.2) — summarizer + preview endpoint shipped. ⬜ Remaining: mandatory pre-run confirmation UX.
4. ✅ **Marketplace backend** (4.1–4.2) — public namespace, versioning, install-gated ratings, atomic counters.
5. ✅ **Marketplace web frontend** (4.4) + trust ranking + dry-run-first — `/market` page, ranking + `lowTrust`, and dry-run-first enforcement all shipped.
6. ✅ **Vision re-targeting on replay** (5.3) — recovery path + UI messaging + broadened coverage (uia_invoke / click_at / browser_click) all shipped.
7. 🟡 **Monetization seam** (8) — provider-boundary credit gate + blocked-call UX copy + state-machine unit tests shipped; a full route-layer DynamoDB/Stripe fixture pass remains.
8. ⬜ **Onboarding/UX polish** for non-technical users.

Each milestone ships with Jest unit tests and, where it touches the loop, an
`automation/eval/scenarios/` scenario.

### 10.1 Next implementation slices (file-targeted)

1. ✅ **Marketplace persistence + routes** — `backend/controllers/marketplaceController.js`, `backend/services/marketplaceRanking.js`, `backend/routes/routeData.js`; addon proxies in `server/automation/index.js` + wrappers in `workspace-client.js`.
2. ✅ **Telemetry plumbing for marketplace counters** — `getTelemetrySummary` + `/telemetry/summary` (now includes a `marketplace` field).
3. **Capability/scrub UI confirmations** — frontend route(s) following the `/net` integration pattern.
4. **Recorder consent gate** — `server/automation/permissions.js` + recorder capture pipeline.
5. **Vision replay repair fallback** — `server/automation/tools/skill.js` (`repairStep`) + `server/automation/vision-fusion.js`.

### 10.2 Sprint-ready backlog of not-done items

#### P0 — do now

- ✅ Marketplace public namespace + immutable version storage.
- ✅ Install-gated ratings (server-enforced).
- ✅ `/telemetry/summary` including marketplace counters.
- ✅ Mandatory pre-publish scrub confirmation UI (PublishModal "what will be shared" review).
- ✅ Mandatory pre-run capability confirmation UI for installed market skills (addon-dashboard review on first run).

#### P1 — do next

- ✅ Vision re-targeting: coverage broadened (uia_invoke / click_at / browser_click) + UI messaging shipped.
- ✅ Tool-version compatibility: mapping coverage + UI integration shipped (add new aliases/fallbacks as renames land).
- 🟡 Recorder sensitive-capture consent: frontend consent UX polish.
- ✅ Cloud-vision consent: frontend consent UX shipped (first-use modal + revoke/toggle in `PermissionsManager.jsx`).
- ✅ Per-skill `successCriteria` evaluation + outcome persistence (runtime, telemetry, ranking, auto-repair all shipped).

#### P2 — after core loop is stable

- 🟡 Trust-ranking tuning + low-trust dry-run-first hardening (formula + classifier shipped; tune against real usage).
- 🟡 LLM provider local adapter quality pass (deterministic stub shipped; a real local model backend remains).
- ✅ Monetization gate at provider boundary (per-tier monthly credit limits via `MEMBERSHIP_LIMITS`; `agent-chat`/`agent-vision` now enforce it).
- ⬜ Consumer onboarding polish and starter templates.

### 10.3 Release-gate checklist for first marketplace public beta

- ✅ No publish path can bypass scrub + author confirmation (server re-runs privacy scrub + capability-mismatch check before persisting).
- ✅ No run path can bypass permissions/security guardrails — verified: every
  tool call funnels through `tool-registry.executeTool` → `permissions.requestApproval`
  (kill switch / deny / dry-run are enforced before ANY tool runs); composite
  tools (`skill_run`) re-enter the registry per nested step (covered in
  `tools/skill.test.js`); and the legacy chat action path is gated by
  `security-guard.js` (`checkActionPlan`/`checkPSScript`). Enforcement lives at
  the registry layer, not per call site.
- ✅ Installed marketplace skills always show capability summary before first execution (server 403s until confirmed once per version; addon dashboard renders the review).
- ✅ Low-trust skills default to dry-run-first (server forces the first pass into dry-run via `marketplace-gate.js`; addon dashboard surfaces a 'dry-run' result).

### 10.4 Future capability plans

Longer-horizon capabilities, listed by the roadmap.

- **Audio / voice pipeline** — mic → Whisper STT → intent → goal → TTS. (`scripts/voice_pipeline.py`, `server/audio-stream-manager.js`, `tools/audio.js`; endpoints `/api/voice/*`.)
- **Natural Language Macro Compiler** — English → structured skill steps (`nl-compiler.js`; `POST /api/skill/compile-natural`).
- **Continuous perception bus** — unified event stream (`perception-bus.js`) fed into the agent context.
- **Behavioral predictor** — n-gram model over action log; safe-read actions can execute speculatively (`predictor.js`).
- **Frontend integration** — NL macro textarea, perception status, voice input, predictions panel across `SimpleAddon/*`.

## 11. The O-O-G-P-A loop (design reference)

The agent loop was upgraded from ReAct to an explicit **Observe → Orient → Goal →
Plan → Action** loop with a critic and meta-learning. **Status: ✅ complete** —
every task (T0.1 → T8.2) is implemented, tested, and green. This section is the
design reference; the code is the source of truth.

### 11.1 Three nested loops

| Loop | Cadence | Stages | Purpose |
|---|---|---|---|
| Inner | per action (~seconds) | Observe → Orient → Plan → Action | Fast progress; Goal held fixed |
| Outer | per goal re-eval (every N steps / T minutes) | + Goal | Re-derive or abandon intent |
| Meta | per session/day | Critic over the action log | Learn skills, drop dead policies |

### 11.2 State machine

```text
IDLE → OBSERVING → ORIENTING → SELECTING_GOAL → PLANNING → ACTING → REFLECTING
                                              ↑_______________↓        (inner loop)
                          └─→ BLOCKED ─→ (wait / new goal) ─────────┘
IDLE ← DONE / FAILED / STOPPED (kill switch)
```

Every transition is observable in `GET /api/agent/status`. Stages:

- **Observe** — sensors (screen, UIA, audio, gaze, keyboard patterns) fuse into a `Frame`; the last action's outcome is part of the next frame.
- **Orient** — assemble a bounded, priority-ordered situation block (perception → recent actions → goals → lessons → suggestions), capped at `ORIENT_CAP_BYTES`; drift detection (token-set Jaccard similarity over the *semantic* parts) sets `drifted`.
- **Goal** — cadence-gated re-eval: `refreshGoalStatus()` runs every tick (terminal-status + stall check, never cadence-gated); `selectGoal()` re-derives intent on cadence/drift and can emit `blocked`/`done`/`abandoned` (self-block gated by `autoAbandon`, default false).
- **Plan** — choose a concrete tool call or `idle`.
- **Act** — execute the tool; record the outcome.
- **Reflect / Critic** — `critic.js` scores the action (−1..1), writes an idempotent `lesson` workspace item on failure, and injects lessons into the next Orient block.

### 11.3 Data model & endpoints

**Additive goal fields** (`workspaceController.js`): `nextReevaluateAt`, `stallCount`, `lastOutcomeDelta` (−1..1), `autoAbandon` (bool), `maxSteps` (int).

**New workspace kind `lesson`** — written by the critic, read by Orient as semantic
memory: `{ kind:"lesson", slug:"lesson-<hash>", content:{ pattern, context, do, avoid, confidence, sourceGoal } }`.

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agent/status` | `stage`, `loop` (inner/outer/meta), `stallCount`, `lastLesson` |
| `POST` | `/api/agent/start` | accept `goalSlug` + optional `{maxSteps, autoAbandon}` |
| `POST` | `/api/agent/block` | mark current goal `blocked` with a reason |
| `GET` | `/api/agent/lessons?goal=<slug>` | read critic lessons |
| `DELETE` | `/api/agent/worker/:goalSlug` | stop a worker |

**Configuration knobs** (in `agent-loop.js` defaults): `ORIENT_CAP_BYTES`, `EPISODIC_WINDOW`, `LESSON_TOPK`, `REEVAL_STEPS`, `REEVAL_MS`, `DRIFT_THRESHOLD`, `IDLE_SLEEP_MS`, `STALL_THRESHOLD`, `MAX_STEPS_DEFAULT`, `META_EVERY_ACTIONS`, `SKILL_PROMOTE_MIN_REPEATS`.

### 11.4 Success criteria (all met)

- Named `observe/orient/selectGoal/plan/act/reflect` stages, each unit-testable.
- Outer loop re-runs the Goal stage on cadence + drift and emits `blocked`/`done`/`abandoned`.
- A critic writes idempotent lessons and injects them into the next plan.
- The loop can `idle` and self-`block` on repeated stalls.
- Kill switch and permission gate remain authoritative at every stage.
- All existing eval scenarios pass; new ones green.
- UI shows live stage/loop/lessons without new security surface.

### 11.5 Open follow-ups

- ✅ **Adopt `MAX_STEPS_DEFAULT: 60`** — the loop's default step budget is now 60 (`DEFAULT_MAX_STEPS` in `agent-loop.js`, single-sourced into `DEFAULT_CONFIG.MAX_STEPS_DEFAULT`); keep tuning stall/abandon from real usage.
- ✅ **Semantic lesson recall** — the Orient stage now ranks the recent-lessons pool by token overlap with the current situation via `critic.recall`, backfilling remaining slots recent-first (`agent-loop.js` `_rankLessons`); tested in `agent-loop.test.js`.
- **Offline runner coverage** — goal-block-on-stall and orient-bound-cap are unit-tested only; the offline eval runner can't drive the LLM loop deterministically.
- **Server-side `goalAgentService`** — kept as the offline fallback for `/plans`; the addon O-O-G-P-A loop is now the primary path.

## 12. Readiness & validation

The reliability bar before turning purchasing/visibility back on.

**Readiness bar:**
1. **Hard gate** — key simulation, perception, and auto-execution each work in ≥2 common apps.
2. **Reliability gate** — each of the 11 validation scenarios passes 9/10 across sessions/days; fix and restart on any consistent failure.
3. **Account plumbing gate** — purchase confirmation and password reset confirmed end-to-end with a real account.
4. Re-run the whole check after any significant change to the perception/action pipeline.

**Validation scenarios** (executable in `simple-addon/server/automation/eval/validate-core-functionality.js`, driven from `simple-addon/` via `npm run validate:core`):

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

## 13. Living action items

The remaining checklist — check items off as they land, add new gaps as found.

- ⬜ **Reliability tally** — run each validation scenario ≥10 times and require 90%+ per scenario (see §12).
- ⬜ **Perception loop** — scenario 5 needs one real `--interactive` run with a human.
- ⬜ **Auto action execution** — scenario 8 needs one real signed-in run (all LLM calls proxy through the backend).
- ⬜ **Scenario 11** — needs a live desktop run before it counts toward the tally.
- ⬜ **`input_hold`** — held keys/buttons lack a real-desktop regression test; add one.
- ⬜ **Existing Pro subscribers** — tell them plainly what works and what doesn't.
- ⬜ **Account/transactional email plumbing** — verify purchase confirmation + forgot/reset-password loop with a real account.
- ⬜ **Single installer** — consolidate "download, trust cert, configure" into one flow if feasible.
- ✅ **Pricing-page cleanup** — `getPlanDisplayName` fallback fixed (returns "Pro (monthly/yearly)" / "Free" instead of the redundant "Pro Membership"); `BillingDisclosure.jsx` is cadence-aware (`billingInterval` prop, threaded from `CheckoutForm.jsx`); `subscriptionCancelledTemplate` reviewed and already plan-generic (no legacy names); no dead `Simple.jsx` or `Net.jsx` plan chips remain.
- ✅ **Home + Pricing value messaging** — Home: added an above-the-fold personal CTA ("What I can do for you" → `/pricing`, plus "Browse my work" → `/projects`) in the hero; the project catalog is already de-duplicated (curated carousel = specific projects, `WHATS_INSIDE` = category tiles, "around the site" = nav links — no literal re-listing remains). Pricing: the hero now leads with benefit copy ("Simple is an AI agent that runs on your PC…") before the plan cards. Files: `frontend/src/pages/Home/Home.jsx`, `frontend/src/pages/Pricing/Pricing.jsx`.

### 13.1 New findings (repo audit, 2026-09-09)

Issues surfaced while auditing the repo beyond the original plan. Ordered by
impact; none are Simple-core blockers, but several are user-visible or DRY/security-adjacent.

- ✅ **OAuth login/linking is a stub** — confirmed there are no OAuth buttons wired anywhere (`AuthCallback.jsx` is an orphaned component with no route), and removed the `console.log` that printed the OAuth authorization `code`. Full OAuth wiring remains a product decision.
- ✅ **AWS Textract OCR returns fabricated text** — `processWithAWSTextract` now calls the real AWS Textract `DetectDocumentText` API (the `@aws-sdk/client-textract` dependency was already installed) and returns the extracted LINE blocks instead of the mock string.
- ✅ **Centralize the backend base URL** — `SimpleChat`/`StorageMeter`/`UsageMeter` now import `getApiBase()` from `frontend/src/config/api.js` (this also fixed an inverted prod-vs-dev URL branch that pointed production at the Render origin instead of the Netlify proxy). The addon's two `BACKEND_URL = process.env.BACKEND_URL || …` lines remain env-overridable.
- ✅ **Email templates hardcode production URLs** — `backend/services/emailTemplates.js` now defines `const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.sthopwood.com'` and uses `${FRONTEND_URL}` for all six in-email links (account ×2, pricing ×2, net ×2), matching `passwordReset.js`.
- ✅ **Deprecated / dead code cleanup** — `backend/services/stripeHelpers.js` deleted; `isSimpleTier` removed from all six call sites (`backend/constants/pricing.js`, `frontend/src/constants/pricing.js`, `emailTemplates.js`, `webhookService.js`, `llmService.js`, `apiUsageTracker.js` — `webhookService` now uses `isProTier`). Remaining (cosmetic, no runtime effect): the commented-out Firebase JSX in `frontend/src/pages/Projects/PollBox/NewPoll.js`.
- ✅ **Stale compiler v2 TODO list** — `compiler.js`'s "v2 ideas (NOT implemented)" note now points parameter inference at `recorder/infer-params.js` (§5.2), and the `params: [] // v2` comment references the same.
- ✅ **Approval prompts log full tool args to the console (PII risk)** — `simple-addon/server/automation/index.js` now logs only the arg keys (never values) on approval prompts; full args still reach the UI via the `approval.pending` event.
- ✅ **Duplicated LLM-metering logic in `getHashData`** — extracted a shared `runBedrockTask(req, { label, inputTokens, outputTokens, generate })` helper in `backend/controllers/getHashData.js`; both `getword:` and `getdef:` branches now gate → generate → track → respond through it (same 402 body and usage-tracking log).
- ✅ **Silently swallowed errors in `llmService`** — the stream path's `loadUserContextFromDB` now warns (matching the non-stream path), and the credits-field parse + action-log wrappers log at debug instead of silently swallowing. The remaining `catch {}` blocks are intentional JSON-parse/title fallbacks.
- 🟡 **Plaintext secret fallback outside Electron** — `simple-addon/server/secret-storage.js` stores secrets in plaintext when `safeStorage` is unavailable (documented + one-shot warning; fine for CLI/Jest). Confirm the packaged addon always runs under Electron, and consider refusing to persist (instead of plaintext) in non-Electron contexts.
- ✅ **Hardcoded admin user ID duplicated across the codebase** — backend now centralizes on `process.env.ADMIN_USER_ID` everywhere (`putHashData.js` literal replaced; `testFunnelController.js` fallback removed). Frontend de-duplicated into one shared `frontend/src/constants/admin.js` (`ADMIN_USER_ID` + `GIRLFRIEND_NICKNAME`), imported by `adminShared.js`, `HeaderDropper.jsx`, `DeepStorage.jsx`, `Home.jsx`, `Muse.jsx` — the scattered literals are gone.
- 🟡 **Derive admin-ness server-side** — the backend now attaches an `isAdmin` flag to the register/login/guest responses (`postData.js`), and the frontend reads it via shared `isAdminUser()`/`isMuseVisitor()` helpers in `constants/admin.js` (`AdminLayout`/`HeaderDropper`/`DeepStorage`/`Home`/`Muse`). Remaining: the hardcoded ID + `'girlfriend'` gate still ship as a legacy fallback until every active session re-logs in — then the constants can be deleted.
- ✅ **Committed user PII in `backend/reports/support-tickets-*.json`** — deleted the committed export and added `backend/reports/support-tickets-*.json` to `.gitignore` so future `pull-support-tickets` runs stay local. ⚠️ The file is still in git history — full removal needs a history rewrite (e.g. `git filter-repo`/BFG) + force-push.
- ✅ **Stray refactor script** — `frontend/src/pages/Simple/Pay/refactor-script.js` deleted.
- ✅ **`backend/scripts/diagnose-login.js` TEMP diagnostic** — deleted.
- ✅ **Stale un-wired "custom credit limit" feature in `webhookService.js`** — removed `processCustomLimitUpdate` / `validateCustomLimit` / `verifySimpleMembership` / `processLimitIncrease` / `updateSubscriptionLimit` / `saveUserCredits` (all referenced removed `CREDITS`/`PLAN_IDS.SIMPLE`), their exports, and the now-unused imports; `webhookService.js` exports only `constructWebhookEvent` + `processWebhookEvent` with `liveStripe` + `logger`.

### 13.2 New findings (second audit pass, 2026-09-09)

- ✅ **Stale third backend URL in `screen-relay.js`** — the GCP Cloud Run fallback was replaced with the Render backend (`https://mern-plan-web-service.onrender.com`), matching `workspace-client.js`/`cloud-relay.js`.
- ✅ **Stale `openai/gpt-4o-mini` model ID in `planner.js`** — removed the hardcoded `modelId` so `planGoal` uses the provider seam's Bedrock default.
- ✅ **Committed default test credentials in `testFunnelController.js`** — `TEST_EMAIL`/`TEST_PASSWORD` are now env-only (`TEST_FUNNEL_EMAIL`/`TEST_FUNNEL_PASSWORD`); the hardcoded `testfunnel@simple.test` / `TestFunnel2024!` fallbacks are gone.
- ✅ **JWT tokens partially logged in `dataService.js`** — removed all three `Token preview: <first 50 chars>` console.logs.
- ✅ **Swallowed errors outside `llmService`** — the two `testFunnelController.js` `catch (_) {}` blocks now `console.warn` the error; the `action-bridge.js` `fs.unlinkSync` catches are left as intentional best-effort cleanup.
- 🟡 **Experimental `signal-bridge` predates the Bedrock-only decision** — marked ⚠️ DEPRECATED/UNWIRED in its header. Actual deletion (or re-implementation via the Bedrock proxy) is still a product decision.
- ✅ **`dangerouslySetInnerHTML` on FAQ answers** — `HelpFaqTab.jsx` now renders answers via a small link-aware text renderer (only `<a href>` is parsed into React elements; everything else is plain text), so no raw HTML is ever injected.
- 🟡 **Public guest account with a known password** — `backend/constants/guestAccount.js` hardcodes `guest@gmail.com` / `guest` for "Login as Guest" (and `createGuestUser.js` logs the password). A deliberate demo feature, but a shared account with a known credential should stay strictly read-only/rate-limited and excluded from paid/powerful paths.

### 13.3 New findings (third audit pass, 2026-09-09)

- 🟡 **S3 upload file-type validation trusts the client MIME type** — `validateFile` now rejects known-dangerous extensions (.html/.svg/.exe/…) and mismatches between the file extension and the declared `contentType`. Full magic-byte/signature inspection still requires a post-upload verification step (uploads are client→S3 via pre-signed URL, so the server never sees the bytes).
- ✅ **Production CSP permits `unsafe-eval` + `unsafe-inline`** — removed `unsafe-eval` from `netlify.toml` (no frontend code uses `eval`/`new Function`). `unsafe-inline` is retained for the Vite bootstrap script.
- 🟡 **JWT persisted in `localStorage`** — `frontend/src/features/data/dataSlice.js` stores the auth token in localStorage, so any XSS could exfiltrate it. Combined with the loose CSP above, prefer an `httpOnly` session cookie (or at least tighten CSP).
- ✅ **Stored secrets keyed to `JWT_SECRET` by default** — `secretCrypto.js` now warns at first use when `SECRETS_ENCRYPTION_KEY` is unset (making the JWT_SECRET fallback visible). Ops action: set a dedicated `SECRETS_ENCRYPTION_KEY` in Secrets Manager.
- ✅ **Minor: a few `target="_blank"` links omit `rel="noopener noreferrer"`** — added `rel` to the Wordle Solver link; the remaining `_blank` links are either same-origin or already carry `rel` (browsers also default `_blank` to `noopener`).

### 13.4 New findings (fourth audit pass, 2026-09-09)

- ✅ **Committed `frontend/jest-out.txt`** — deleted and added `jest-out*.txt` to `.gitignore`.
- ✅ **`npm audit` is non-blocking in CI** — removed `continue-on-error: true` from the three `npm audit --audit-level=high` steps, so high-severity vulnerabilities now fail the pipeline.
- ✅ **Referer analytics persists full URLs + query strings** — `accessData.js` now stores the referer as origin+path only (query string stripped and no `RefererQuery` field written).

### 13.5 New findings (fifth audit pass, 2026-09-09)

- 🟡 **HIGH — the addon's local HTTP API is unauthenticated and CORS-allows the production site + LAN origins** — hardened: `simple-addon/server/index.js` now rejects requests whose `Host` header isn't loopback/private (anti DNS-rebinding) and 403s non-allowlisted cross-site `Origin`s before any handler runs, so a drive-by `fetch('http://127.0.0.1:3001/...')` from an arbitrary site no longer executes. Remaining: the production site is still allowlisted, so a per-install random secret on every request (and tightening CORS to the Electron app's own origin) is still needed to close the allowlisted-origin path.

### 13.6 New findings (sixth audit pass, 2026-09-09)

- ✅ **Page-view analytics persist the full request URL (incl. query string)** — `accessData.js` now strips the query string (`req.originalUrl.split('?')[0]`) before persisting the `|URL:…` field, so reset/oauth tokens no longer reach the access log.
- ✅ **`deleteHashData.js` creator check is broken for non-24-char user IDs** — now parses `Creator:` up to the next `|` via `/(?:^|\|)Creator:([^|]+)/`, so both legacy 24-char and new 32-char crypto-hex IDs match and those users can delete their own data again.

### 13.7 New findings (seventh audit pass, 2026-09-09)

- ⬜ **Addon is distributed unsigned (no code-signing certificate)** — `simple-addon/` is built without `CSC_LINK`/`CSC_KEY`/`win.certificateSubjectName`, so (a) Windows SmartScreen flags the installer/portable exe, and (b) `electron-updater` can't verify update authenticity against a publisher certificate — update trust rests on TLS + the blockmap hash alone (a compromised GitHub repo could ship a malicious update that installs silently). Sign the build and set `publisherName` so updates are authenticated.
- ⬜ **CI actions pinned by mutable tags + mixed versions** — `.github/workflows/` mixes `actions/checkout@v4` / `setup-node@v4` (build-addon.yml, ci.yml's `test-simple-addon`) with `@v6` (ci.yml's other jobs, security.yml). Tag-based pinning lets a compromised action repo inject code; pin all actions to full commit SHAs and use one version consistently.

### 13.8 New findings (eighth audit pass, 2026-09-10)

- ✅ **Visitor IP is client-spoofable via `X-Forwarded-For`** — `checkIP` now uses `req.ip` (which respects the `trust proxy` setting) instead of parsing the client-supplied leftmost XFF entry, so recorded visitor IPs can no longer be spoofed.
- 🟡 **Unbounded per-request access-log writes** — `checkIP` appends a new `IP:…|Method:…|URL:…` DynamoDB record on essentially every request (authenticated or not), so the `Simple` table grows without bound and every API call costs an extra write. Consider sampling, a TTL/retention window, or a separate analytics table.

---

**Companion doc:** [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) — threat model, trust boundaries, and the permissions matrix.
