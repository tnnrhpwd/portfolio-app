# Windows Automation Agent — Roadmap to Best-in-Class

> Goal: turn the current CSimple addon + portfolio workspace API into the most capable, safest, and most personalizable Windows automation agent available. Inspired by OpenAdapt / Self-Operating Computer / Claude Computer Use, but with persistent per-user cloud memory and a friendly approval model.

Last updated: 2026-06-14

---

## 0. Current state (already shipped)

The end-to-end loop **signed-in user → cloud memory → local PC actions** is functional.

| Area | Files |
|---|---|
| Per-user workspace memory (memory/project/agent/skill/goal/action/log/decision) | `backend/controllers/workspaceController.js`, `backend/services/workspaceContext.js` |
| Workspace REST API mount | `backend/routes/routeData.js` (`/api/data/csimple/workspace/*`) |
| Web UI for memory & agents | `frontend/src/components/CSimple/WorkspaceManager.jsx` |
| Electron addon + tray | `csimple-addon/main.js`, `csimple-addon/tray.js` |
| Local API server | `csimple-addon/server/index.js` |
| Tool registry + permission gate | `csimple-addon/server/automation/tool-registry.js`, `csimple-addon/server/automation/permissions.js` |
| Tools: shell, fs, system, uia, screen, input, goal, vision-fusion | `csimple-addon/server/automation/tools/*`, `csimple-addon/server/automation/vision-fusion.js` |
| ReAct agent loop | `csimple-addon/server/automation/agent-loop.js` |
| Cloud audit log + workspace client | `csimple-addon/server/automation/workspace-client.js` |
| Permission Center BrowserWindow | `csimple-addon/renderer/permissions.html` |
| Eye tracking subsystem | `csimple-addon/scripts/eye_tracker.py`, `csimple-addon/eye-tracking-manager.js` |

---

## 1. Gaps to "best on the planet"

1. **Demonstration capture & replay** — record once, generalize to a reusable skill.
2. **Continuous perception** — background UIA tree snapshot + screenshot cache; saves LLM tokens.
3. **Skill library with parameter binding** — deterministic replay before LLM fallback.
4. **Browser automation** — Playwright/CDP tool family for the ~60% of tasks that are web.
5. **Triggers & schedules** — cron, file-watcher, hotkey, system-event triggers.
6. **Planner & sub-goal decomposition** — convert high-level goals into a tree.
7. **Live "agent's eyes" web panel** — SSE stream of screenshots + actions + tokens to web UI.
8. **Mobile approvals** — push approvals to phone instead of only local popup.
9. **Local model fallback** — tool-use-capable local LLM via Ollama/llama.cpp for private tasks.
10. **Eval harness & telemetry** — record/replay (goal, plan, outcome) tuples for regression testing.

---

## 2. Phased plan

### Phase 1 — Hardening (foundation safety) — 1–2 weeks

Goal: production-trustworthy security & observability before adding more autonomy.

| Task | Location | Acceptance |
|---|---|---|
| Encrypt cloud-relay token at rest with Windows DPAPI | `csimple-addon/server/cloud-relay.js` | Token never on disk plaintext |
| Bind addon HTTP server to 127.0.0.1 only; document the 3444 HTTPS path | `csimple-addon/server/index.js` | `netstat -ano | findstr 3001` shows loopback only |
| Code-sign installer & publish releases via signed updater | `csimple-addon/release.js`, `csimple-addon/auto-updater.js` | Installer not flagged by SmartScreen |
| Add structured telemetry: `POST /api/data/csimple/workspace/telemetry/append` (latency, tool, ok, errCode) | `backend/controllers/workspaceController.js`, new `csimple-addon/server/automation/telemetry.js` | Per-tool metrics queryable from web UI |
| Eval harness skeleton: `csimple-addon/server/automation/eval/` with a `runScenario(yaml)` API | new | Can replay 1 scripted scenario against a fixture |
| Backend rate-limit hardening on workspace endpoints | `backend/middleware/rateLimiter.js`, `backend/routes/routeData.js` | 429 on bursts; per-user buckets |
| Document threat model & permissions matrix | `docs/implementation/AUTOMATION_SECURITY.md` (new) | Reviewable doc |

### Phase 2 — Perception & web automation — 2–3 weeks ✅ COMPLETE

Goal: the agent can "see" the screen efficiently and drive web apps reliably.

| Task | Location | Status |
|---|---|---|
| `uia_snapshot` tool: full window UIA tree → compact JSON | `csimple-addon/server/automation/tools/uia.js` | ✅ Done. Three modes (tree/interactive/flat), file-based PS runner, env-var-expanded scenarios. |
| Perception cache (lighter alternative to a constant pump): on-demand caching of `uia_snapshot` with TTL, coalesces concurrent calls | `csimple-addon/server/automation/perception.js` | ✅ Done. `perception_recent` tool + optional background pump. |
| OCR fallback tool `screen_ocr` using Windows.Media.Ocr | `csimple-addon/server/automation/tools/ocr.js` | ✅ Done. Returns lines + per-word boxes; supports region capture + path-only OCR. |
| Set-of-marks helper: overlay numbered boxes from UIA tree onto a screenshot for vision LLM | `csimple-addon/server/automation/tools/set-of-marks.js` | ✅ Done. `screen_set_of_marks` returns annotated PNG + legend. |
| Playwright tool family: `browser_open/goto/click/fill/text/eval/screenshot/status/close` with managed Chromium | `csimple-addon/server/automation/tools/browser.js` | ✅ Done. Uses `playwright-core` + auto-detects Edge/Chrome (no bundled binary). |
| Browser session persistence (cookies, localStorage) | same | ✅ Done. `launchPersistentContext(userDataDir)` per profile; scenario 08 proves it. |

### Phase 3 — Skills & demonstrations — 3–4 weeks 🟡 IN PROGRESS

Goal: the agent learns from one demonstration; recurring tasks become deterministic.

| Task | Location | Status |
|---|---|---|
| Global input recorder (polling-based mouse + window-focus capture via PowerShell; native keyboard hook deferred to v2) | `csimple-addon/server/automation/recorder/polling-source.js`, `session.js`, `index.js` | ✅ Done. Persists JSONL to `<userData>/recordings/`, append-only, flush every 500ms. |
| Recorder UI: tray entry "Record demonstration" + "Recorded Skills…" window | `csimple-addon/tray.js`, `csimple-addon/renderer/recordings.html`, `main.js` | ✅ Done. Tray menu shows live status; renderer drives start/stop/compile/save/run. |
| Skill compiler: post-process recording → coalesce focus + clicks → parameterized tool-call sequence stored as workspace `kind=skill` | `csimple-addon/server/automation/recorder/compiler.js` | ✅ Done. Compiler v1 + 20-case unit test suite. v2 (UIA-bound clicks, type-text runs, param inference) deferred. |
| Skill runner tool: `skill_run(slug, args)` with `${param.x}` substitution, continueOnError, local cache + workspace fallback | `csimple-addon/server/automation/tools/skill.js` | ✅ Done. Two eval scenarios (09, 10) prove ephemeral run + param substitution. |
| Skill discovery in agent loop: prefer matching skill over open-ended planning | `csimple-addon/server/automation/agent-loop.js` | ✅ Done. Each step, top-3 token-overlap matches across cache + workspace are appended to the system prompt as `RECORDED SKILLS THAT MIGHT MATCH THIS GOAL` with explicit "prefer skill_run" instruction. |
| Skill versioning + concurrency via existing workspace `expectedUpdatedAt` | reuse | ⏳ Not started. |
| LLM repair fallback: if a step fails, ask the model to amend args using a fresh `uia_snapshot` | `tools/skill.js` | ✅ Done. `skill_run` now repairs failed steps: captures a fresh interactive `uia_snapshot`, asks the model for amended args (`{"action":"retry","args":{...}}` / `{"action":"abort"}`), retries once (configurable via `maxRepairs`, disable with `repair:false`). 19 unit tests in `tools/skill.test.js`. |
| Native keyboard hook (uiohook-napi or C# helper) for full demonstration fidelity | `recorder/` | ⏳ Not started — v1 captures mouse + focus only. |

### Phase 4 — Autonomy & remote control — 3–4 weeks 🟡 IN PROGRESS

Goal: the agent runs unattended, you supervise from anywhere.

| Task | Location | Status |
|---|---|---|
| Planner pass: before agent loop starts, LLM call decomposes goal into `parentGoalId`-linked sub-goals stored via workspace API | `csimple-addon/server/automation/planner.js`, hook into `agent-loop.js` start | ✅ Done. `shouldPlan` heuristic (length/connectives), `_validatePlan` rejects bad LLM output, idempotent re-runs skip existing slugs, decreasing priority preserves order. 27 unit tests. |
| Trigger engine: cron + file-watcher (chokidar) + hotkey (`iohook`) + system event → enqueue goal | `csimple-addon/server/automation/triggers.js` | ✅ Done. In-house 5-field cron parser, `fs.watch`-based file watcher, hotkey delegation to Electron `globalShortcut`. CRUD via `/api/triggers`. 19 unit tests. |
| Event bus + SSE stream `/api/agent/events` from addon → web UI live panel | `csimple-addon/server/automation/events.js`, `index.js` | ✅ Done. Ring-buffered, type-filterable, supports `sinceSeq` replay + heartbeat. Publishers wired in tool registry, agent loop, recorder, approval flow, permissions. 13 unit tests. |
| Live screenshot relay path (addon uploads small thumbnail via existing `s3Service` then SSE the URL) | `backend/services/s3Service.js`, `csimple-addon/server/automation/perception.js` | ⏳ Not started. |
| Pending-approval push: route approval to (a) local Permission Center AND (b) web UI banner AND (c) push notification (web-push or email fallback) | `backend/services/emailService.js`, new `backend/controllers/approvalController.js`, `csimple-addon/server/automation/index.js` | ⏳ Not started. |
| Unattended auto-approval: `autoApproveAll` flag fast-tracks `ask`-mode tool calls (no prompt) for hands-off runs | `csimple-addon/server/automation/permissions.js`, `frontend/src/components/CSimple/AgentLivePanel.jsx` | ✅ Done. `permissions.autoApproveAll` (default off). Hard stops still win: kill switch, per-tool/category `deny`, `dryRunMode`, and the shell deny-list are unaffected. Toggle on the `/net` live panel (+ `getAutomationPermissions`/`setAutoApproveAll` API helpers). 8 unit tests in `permissions.test.js`. |
| Multi-monitor support in `screen_capture` and `uia_*` | `csimple-addon/server/automation/tools/screen.js`, `tools/uia.js` | ⏳ Not started. |
| Live web UI panel (frontend) subscribing to SSE | `frontend/src/components/CSimple/AgentLivePanel.jsx` (+ `.css`), wired into `frontend/src/pages/Simple/Net/Net.jsx` | ✅ Done. Subscribes to addon `/api/agent/events` via EventSource; renders live `screen.frame` thumbnail, rolling activity feed, pending-approval cards (approve/deny), and Start/Stop/Kill-switch + Refresh-Frame controls. API helpers added to `frontend/src/services/csimpleApi.js` (`getAgentEventsUrl`, `getAgentStatus`, `startAgent`, `stopAgent`, `getPendingApprovals`, `resolveApproval`, `activateKillSwitch`, `relayScreenFrame`). |

### Phase 5 — Intelligence & ecosystem — ongoing

Goal: continuous improvement and community.

| Task | Location | Acceptance |
|---|---|---|
| Eval harness fixtures: 20+ recorded scenarios with success criteria | `csimple-addon/server/automation/eval/scenarios/` | `npm run eval` reports pass rate |
| Telemetry-driven prompt tuning: weekly aggregate "tools that fail most" → suggest prompt tweak | new `backend/services/agentTelemetry.js` + dashboard | Visible failure-cause histogram |
| Local-model tool-use path: integrate Ollama (llama3.1 or Qwen2.5) for offline/private tasks | `csimple-addon/server/llm-service.js`, `csimple-addon/python-manager.js` | `model=local` flag works end-to-end with tool calls |
| Skill marketplace: public workspace items (kind=skill, visibility=public) shareable via link | `backend/controllers/workspaceController.js` (visibility column), `frontend/src/components/CSimple/SkillMarketplace.jsx` | User can import another user's published skill |
| Long-term memory promotion: action log → distilled `memory` items on a schedule | `backend/services/workspaceContext.js`, new `backend/services/memoryDistiller.js` | Old logs roll up into a memory note weekly |
| Cross-device handoff: a goal started on PC A can be picked up on PC B with same workspace | already DB-backed; needs lock/lease | `agent_lease` field prevents two PCs from running same goal |

---

## 3. Immediate next 5 actions (pick first)

If you want to move today, these are the highest-leverage starting points:

1. **Add structured telemetry endpoint + addon emitter.** Tiny change, unlocks every later phase.
2. **`uia_snapshot` tool.** Drops vision token cost ~10x for most desktop apps. ~1 day.
3. **Eval harness skeleton.** Even one scripted scenario gives you a regression net before changes land.
4. **DPAPI for cloud token.** Removes the single biggest security wart.
5. **Playwright `browser_*` tool family (read-only first: open, screenshot, eval).** Opens up the web half of the world.

---

## 4. Open architectural questions

- **Where should skill recordings live?** Local-first (in `%APPDATA%/csimple-addon/recordings/`) with opt-in cloud sync vs. cloud-first via workspace API. Recommend local-first; user explicitly publishes a compiled skill.
- **Approval UX when offline:** if push approval fails, should the agent (a) wait, (b) downgrade to dry-run, (c) abort? Make policy per-user in `permissions.js`.
- **Tool sandbox escalation:** today `shell.js` runs as the user. For truly destructive tasks consider running tools inside a Hyper-V Sandbox / Windows Sandbox container and bridging UIA back out.
- **Determinism vs. learning:** when a saved skill drifts, how aggressive should the LLM repair be? Recommend "repair-once then ask user".

---

## 5. References & inspiration

- OpenAdapt (MLDSAI) — demonstration-based desktop automation
- Anthropic Claude Computer Use — vision + tool-use loop
- Microsoft UI Automation docs — `System.Windows.Automation`
- Playwright Node API — browser tool layer
- OS Atlas / SeeClick — UI grounding research for set-of-marks
