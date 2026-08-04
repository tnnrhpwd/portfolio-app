# Simple — Consumer Marketplace & Skill Generalization Plan
> Revised agent brief (2026-07-14). Replaces simple-agent-prompt.md.
> **Read this first, then read the code.** Sections marked ✅ are already shipped.

---

## 0. Orientation: what actually exists today

The original brief describes much of the existing codebase as if it needs to be built.
It does not. Do NOT redesign or re-implement the following — they are production code:

| Area | File(s) | Status |
|---|---|---|
| Recorder (mouse/keyboard/focus/screen events) | `server/automation/recorder/` | ✅ done |
| Compiler (literal event coalescing → skill JSON) | `recorder/compiler.js` | ✅ done (v1 only — see §3) |
| NL → skill step compiler | `server/automation/nl-compiler.js` | ✅ done |
| ReAct agent loop | `server/automation/agent-loop.js` | ✅ done |
| Tool registry + permission gate (5-tier category model) | `permissions.js`, `tool-registry.js` | ✅ done |
| Security guard (shell allow/deny, protected-path FS) | `server/automation/security-guard.js` | ✅ done |
| Vision fallback (`find_and_click_visual`) | `server/automation/vision-fusion.js` | ✅ done |
| Skill execution + `repairStep` + `substituteArgs` | `server/automation/tools/skill.js` | ✅ done |
| Skill CRUD + hotkeys + compile routes | `/api/skill/*` in `server/automation/index.js` | ✅ done |
| Multi-agent pool (3 concurrent loops) | `server/automation/index.js` `_agentPool` | ✅ done |
| Pattern-learner + predictor | `automation/pattern-learner.js`, `automation/predictor.js` | ✅ done |
| Wakeword / voice pipeline | `server/audio-stream-manager.js`, `scripts/voice_pipeline.py` | ✅ done |
| Workspace API (memory/skill/goal/action/log) | `backend/controllers/workspaceController.js` | ✅ done |
| Telemetry summary endpoint | `workspace-client.js` `getTelemetrySummary` → `/telemetry/summary` | ✅ done (not a stub) |
| Freemium billing (Free / Pro $15/mo) | `backend/constants/pricing.js`, Stripe service | ✅ done |
| AgentLivePanel, GoalManager, ShortcutsManager UIs | `frontend/src/components/SimpleAddon/` | ✅ done |

**The two things that are genuinely not built:**
1. `recorder/compiler.js` **generalization** (v2 — LLM re-derivation, parameter inference, vision repair as first-class path)
2. **Marketplace** — no backend routes, no DynamoDB schema, no frontend page exist anywhere.

Start there. Do not audit or redesign anything in the table above.

---

## 1. Vision (unchanged)

Turn Simple into a consumer PC automation platform where any user can:
1. Demonstrate a task once → system generalizes it into a robust, reusable skill.
2. Publish skills to a community marketplace; discover and run skills others made.

The product should feel like "recording a Loom, except the result is a robot that does the thing."

Target audience: general Windows consumers, not developers. Onboarding must require zero technical knowledge.

---

## 2. Work item A — Compiler generalization (v2)

`recorder/compiler.js` currently does literal event coalescing only. The file's own TODO comments document the gaps. Fix in this priority order:

### A1 — LLM re-derivation (do first)

**Input**: raw recording trace (output of `session.js`) + user-supplied one-sentence goal description.

**Output**: a skill JSON identical in schema to what `nl-compiler.js` already produces, but informed by the actual recorded actions rather than invented from scratch.

**How**: pipe `{ goal, trace }` through a new `compiler.llmRewrite(trace, goal)` function. Prompt must:
- Prefer `uia_invoke` / `click_visual` over raw `click_at` coordinates wherever a UIA element was captured at click time in the trace (the recorder already collects this — check `session.js`).
- Prefer `type_text` steps over individual `key_down/key_up` sequences.
- Collapse repeated `window_focus` transitions into a single leading `window_focus` step.
- Preserve the literal typed text as `${param.query}` placeholder if the goal description implies it varies.

Reuse `GitHubModelsService` (same as `agent-loop.js` and `nl-compiler.js` do). Do not introduce a new LLM client.

Run the existing `nl-compiler.js` `validateSteps` on the output before returning — it already has schema + security checks (shell injection guards, excessive step count, etc.). Do not duplicate those checks.

Expose as: `POST /api/skill/compile` accepts an optional `{ goalDescription }` body field. If present, run LLM re-derivation instead of the v1 literal path. Backward compatible — no field = v1 behavior unchanged.

### A2 — Parameter inference (do second)

When the user records the **same goal multiple times** (session IDs passed as an array to compile), diff the traces to detect what varies across recordings:
- Typed text strings → promote to `${param.query}`, `${param.value}`, etc.
- Window titles that differ → `${param.targetApp}`.
- Numeric arguments that differ → `${param.count}`.

`substituteArgs` in `tools/skill.js` already handles runtime substitution of `${param.x}` — just ensure the inferred params are added to the skill's `params[]` array with type/description.

### A3 — Vision repair as first-class path (do third)

`repairStep` in `tools/skill.js` currently asks the LLM to amend args blindly. Extend the repair prompt to offer a new action type: `{ "action": "visual_locate", "description": "<what to find>" }`. When the agent returns this action, call `find_and_click_visual` (already in `vision-fusion.js`) with the description, then retry the original tool. This closes the loop between `repairStep` and the existing vision subsystem.

**Do not** change `repairStep`'s interface or existing behavior for the `retry`/`abort` paths — only add the new branch.

---

## 3. Work item B — Marketplace

Nothing for the marketplace exists yet. Build it end-to-end.

### B1 — Data model

Add a new **public** DynamoDB access pattern alongside the existing private workspace items. The portfolio backend (`backend/controllers/workspaceController.js`) owns this.

Proposed key structure (fits existing single-table DynamoDB pattern):
```
PK:  mkt_skill_{skillId}         (skillId = nanoid or slug + author suffix)
SK:  2000-01-01T00:00:00.000Z    (sentinel, same pattern as workspace items)
```

Attributes:
```js
{
  skillId,        // globally unique
  authorUserId,   // who published it
  name,
  description,    // plain English, used for NL search
  slug,           // author-scoped slug
  version,        // semver string, default "1.0.0"
  steps,          // full skill JSON (same schema as private skills)
  toolCategories, // derived on publish: unique set of tool categories used
  stepSummary,    // human-readable array: ["opens Chrome", "types text", "clicks 3 things"]
                  // generated server-side on publish, not trusted from client
  downloadCount,  // Number, atomic increment
  runCount,       // Number, atomic increment (incremented on skill_run from marketplace)
  rating,         // Number 0-5, rolling average
  ratingCount,    // Number
  tags,           // string[]
  publishedAt,    // ISO string
  updatedAt,
  isHidden,       // boolean — low-rating auto-flag (see §B3)
}
```

### B2 — Backend API routes

Add to `backend/routes/routeData.js` under `/api/marketplace/`:

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/marketplace/skill` | required | Publish a skill. Server generates `stepSummary` and `toolCategories` from `steps[]` — never trust client. |
| `GET` | `/api/marketplace/skill` | optional | List/search. Query: `q` (NL search via embedding or LIKE), `tag`, `sort` (downloads/rating/recent), `page`. |
| `GET` | `/api/marketplace/skill/:skillId` | optional | Fetch single skill (steps included). |
| `POST` | `/api/marketplace/skill/:skillId/download` | optional | Increments `downloadCount`. Returns the skill JSON. |
| `POST` | `/api/marketplace/skill/:skillId/run-count` | required | Increments `runCount`. Called by addon after a successful marketplace skill run. |
| `POST` | `/api/marketplace/skill/:skillId/rate` | required | Submit 1-5 star rating. One per user per skillId (enforce via DynamoDB conditional write). |

`stepSummary` generation logic (server-side, on publish):
```js
// Map tool names → plain-English phrases
const TOOL_PHRASES = {
  shell_run:    'runs a command',
  open_app:     'opens an application',
  window_focus: 'switches windows',
  uia_invoke:   'clicks a UI element',
  click_at:     'clicks the screen',
  type_text:    'types text',
  find_and_click_visual: 'finds and clicks something on screen',
  // ...extend as tools grow
};
```
Group by tool, count occurrences, produce: `["opens an application", "types text", "clicks 4 UI elements"]`.

`toolCategories` is derived by looking each step's tool up in the existing tool registry's category map — reuse `tool-registry.js`'s category metadata, don't hardcode.

### B3 — Trust / cold-start mitigation

Pure reputation ranking has a cold-start problem: a new malicious skill has zero ratings and could harm early users before ratings accumulate. The execution layer is the real safety floor (permission gate, security guard, kill switch — all stay unchanged). The marketplace layer adds these signals on top, not instead:

- Skills with `ratingCount < 5` get a **"new — unverified"** badge in the UI and are sorted below rated skills by default.
- Skills where `rating < 2.5 && ratingCount >= 5` have `isHidden` set to `true` (still accessible by direct URL, just not surfaced in search/lists).
- On any marketplace skill download, the addon **must** show the pre-run summary (§B4) and prompt permission approval for any category above `safe-read`, regardless of the user's saved per-tool settings. This is enforced addon-side in `skill_run` by checking if the skill came from a marketplace download (add a `source: 'marketplace'` field to the skill JSON).

### B4 — Pre-run skill summary UI (addon side)

Before running any marketplace skill for the first time, surface a BrowserWindow (same pattern as `renderer/permissions.html`) showing:

```
This skill will:
  • open an application
  • type text (2 times)
  • click 4 UI elements
  • run a shell command ⚠️

[Run]  [Cancel]  [Inspect steps...]
```

Source: the `stepSummary` array from the marketplace payload. "Inspect steps..." expands the raw JSON for power users.

Enforce: if the skill contains any `shell` or `destructive` category tool and the user hasn't explicitly approved it in this dialog, block execution. Do not inherit the global auto-approve setting for marketplace skills.

### B5 — Frontend: sthopwood.com/market

New React page at `frontend/src/pages/Market.jsx` (or route `/market` in whatever router is in use).

Layout:
- Search bar (NL query → `GET /api/marketplace/skill?q=...`)
- Sort: Most Downloaded / Highest Rated / Newest
- Skill cards: name, description, author, download count, star rating, `stepSummary` tags, "Download" button
- Skill detail drawer/modal: full description, `stepSummary`, tool categories, version, author, rating widget
- "Publish a Skill" button (requires login → triggers publish flow)

Link from `/net` sidebar and link back to `/net` from `/market` header. This matches the existing sthopwood.com/net integration pattern.

### B6 — Telemetry / KPIs

Primary product KPIs are **skill downloads** and **skill creations** (publish events), not DAU.

Wire these events into the existing `getTelemetrySummary` / `/telemetry/summary` system:
- On `POST /api/marketplace/skill` → emit `marketplace.skill.publish` event.
- On `POST /api/marketplace/skill/:skillId/download` → emit `marketplace.skill.download` event with `skillId`.
- On skill_run with `source: 'marketplace'` → emit `marketplace.skill.run` event.

These should be queryable from the existing telemetry endpoint so the admin panel can surface them without new infrastructure.

---

## 4. Monetization gates (reference existing plans)

Existing plans: **Free** ($0) and **Pro** ($15/mo) — see `backend/constants/pricing.js`.

The free/paid seam for marketplace + generalization:

| Feature | Free | Pro |
|---|---|---|
| Record + replay (local, literal compiler) | ✅ | ✅ |
| Hotkeys, voice triggers, basic agent loop | ✅ | ✅ |
| Browse + download marketplace skills | ✅ | ✅ |
| Publish skills to marketplace | ✅ (1/day limit) | ✅ unlimited |
| LLM re-derivation (A1) on compile | ❌ → local literal compiler only | ✅ |
| Parameter inference (A2) | ❌ | ✅ |
| Vision repair fallback (A3) | ❌ | ✅ |
| Priority placement in marketplace search | ❌ | ✅ |

Gate these on the server side in `backend/middleware/` using the existing `isPaidTier` helper from `pricing.js`. Do not add gating logic in the addon — the addon calls the portfolio backend for AI work, so the gate lives there.

---

## 5. Architecture constraints

- **Do not rewrite the stack.** Electron + Node + Python subprocesses. Keep it.
- **Do not introduce new LLM clients.** Reuse `GitHubModelsService`. The swap-for-local-model seam already exists.
- **Marketplace lives on the portfolio backend** (`backend/`), not on the addon. The addon calls the portfolio backend via `workspace-client.js` (same as it calls workspace, goal, action APIs).
- **Security guard and permission gate are non-negotiable floors.** Do not weaken or bypass them for marketplace convenience.
- **`globalKillSwitch` and dry-run** remain fully functional for all marketplace skills.

---

## 6. Ordered milestone backlog

Work in this order. Each milestone is independently shippable.

### Milestone 1 — Compiler v2, LLM re-derivation (A1)
- Implement `compiler.llmRewrite(trace, goal)` using `GitHubModelsService`.
- Extend `POST /api/skill/compile` to accept `goalDescription`.
- Run `validateSteps` on output.
- Write unit tests alongside (add to `recorder/compiler.test.js`).
- Gate behind Pro tier on the backend.

### Milestone 2 — Marketplace backend (B1 + B2)
- DynamoDB key design + access patterns.
- `POST /api/marketplace/skill` with server-side `stepSummary` + `toolCategories` generation.
- `GET /api/marketplace/skill` with basic search + sort.
- `POST /api/marketplace/skill/:skillId/download`.
- `POST /api/marketplace/skill/:skillId/rate`.
- Unit tests for `stepSummary` generation logic.
- Telemetry events (B6) wired in the same PR.

### Milestone 3 — Pre-run summary UI + marketplace trust enforcement (B3 + B4)
- Addon-side BrowserWindow showing `stepSummary` before first marketplace skill run.
- `source: 'marketplace'` field enforces fresh approval regardless of auto-approve setting.
- Cold-start "unverified" badge logic + `isHidden` auto-flag.

### Milestone 4 — Frontend market page (B5)
- `/market` React page with search, cards, detail drawer, publish flow.
- Link from/to `/net`.
- Auth gate on publish.

### Milestone 5 — Parameter inference (A2)
- Multi-recording diff → `${param.x}` promotion.
- Add `params[]` to output skill.

### Milestone 6 — Vision repair as first-class repair path (A3)
- Extend `repairStep` prompt + `visual_locate` action branch.
- Call `find_and_click_visual` on `visual_locate` response.

### Milestone 7 — Consumer onboarding UX
- Only after M1–M4 are solid. First-run wizard, sample skill library, in-app marketplace discovery.

---

## 7. Files to read before starting each milestone

**All milestones:**
- `simple-addon/server/automation/permissions.js` — category model
- `simple-addon/server/automation/security-guard.js` — hard floors

**M1 (compiler):**
- `simple-addon/server/automation/recorder/compiler.js` — read the TODO comments, they're accurate
- `simple-addon/server/automation/recorder/session.js` — understand what fields the trace has
- `simple-addon/server/automation/nl-compiler.js` — this is the pattern to follow for LLM calls + `validateSteps`
- `simple-addon/server/automation/tools/skill.js` — `substituteArgs`, `repairStep` signatures

**M2 (backend):**
- `backend/controllers/workspaceController.js` — DynamoDB patterns in use; follow the same style
- `backend/constants/pricing.js` — `isPaidTier`, `PLAN_IDS`
- `backend/routes/routeData.js` — how routes are mounted
- `simple-addon/server/automation/workspace-client.js` — `getTelemetrySummary` and workspace req() pattern

**M3 (pre-run UI):**
- `simple-addon/renderer/permissions.html` — BrowserWindow pattern to copy
- `simple-addon/server/automation/tools/skill.js` — `skill_run` entry point; add `source` check here

**M4 (frontend):**
- `frontend/src/components/SimpleAddon/` — existing component patterns (GoalManager, WorkspaceManager)
- `frontend/src/services/simpleAddonApi.js` — `addonFetch` vs `getPortfolioApiUrl()` — marketplace calls go to portfolio backend, not addon

**M5 (param inference):**
- `simple-addon/server/automation/recorder/session.js` — how multiple sessions are stored
- `simple-addon/server/automation/tools/skill.js` `substituteArgs`

**M6 (vision repair):**
- `simple-addon/server/automation/tools/skill.js` `repairStep` — extend this function
- `simple-addon/server/automation/vision-fusion.js` — `find_and_click_visual` signature
