# Windows Automation Agent — Roadmap to Best-in-Class

> Goal: turn the current Simple addon + portfolio workspace API into the most capable, safest, and most personalizable Windows automation agent available. Inspired by OpenAdapt / Self-Operating Computer / Claude Computer Use, but with persistent per-user cloud memory and a friendly approval model.

Consolidated 2026-09-07 — absorbed the former
`AUTONOMOUS_WINDOWS_AGENT_PLAN.md`; its vision, architecture, and future-phase
plans now live in §Vision, §Architecture, and §3 below.

---

## Vision

Build the best Windows automation software on the planet: a multimodal, LLM-driven
agent that reads webcam, PC audio, keyboard/mouse events, and screen images —
synthesises them into a unified perceptual model — then acts preemptively on behalf
of the user to complete goals stored per-user in the cloud database.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INPUT LAYER (Perception)                                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Webcam    │  │  Audio/Mic │  │  Screen    │  │ Key/Mouse  │            │
│  │  (OpenCV)  │  │  (Whisper) │  │  (WinAPI)  │  │  (hook)    │            │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘            │
│        │               │               │               │                   │
│        └───────────────┴───────────────┴───────────────┘                   │
│                                    │                                        │
│                         ┌──────────▼───────────┐                           │
│                         │   PERCEPTION BUS      │                           │
│                         │  (perception-bus.js)  │                           │
│                         └──────────┬────────────┘                           │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│  INTERPRETATION LAYER (Neural Models)                                       │
│  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────────┐  │
│  │ Vision Interpreter │  │  Audio Interpreter │  │ Behavioral Predictor │  │
│  │  GPT-4o-mini       │  │  Whisper STT       │  │  Pattern matcher     │  │
│  │  (face+scene desc) │  │  + intent extract  │  │  (action log)        │  │
│  └─────────┬──────────┘  └────────┬───────────┘  └──────────┬───────────┘  │
└────────────┼───────────────────────┼──────────────────────────┼─────────────┘
             │                       │                          │
┌────────────▼───────────────────────▼──────────────────────────▼─────────────┐
│  SYNTHESIS LAYER (Goal-Directed Planning)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     AGENT LOOP (ReAct → OODA)                       │   │
│  │  Workspace Goals (DB) → Plan → Tool Calls → Reflect → Update Goals │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐ │
│  │  Voice Assistant │  │  NL Macro Compiler│  │  Vision-Action Predictor  │ │
│  │  (STT→intent→TTS)│  │  (English→skill) │  │  (preemptive execution)   │ │
│  └──────────────────┘  └──────────────────┘  └───────────────────────────┘ │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│  OUTPUT LAYER (Action Tools)                                                │
│  shell_run · fs_write · uia_invoke · input_tap · browser_* · screen_relay  │
│  clipboard_write · process_kill · find_and_click_visual · skill_run        │
└─────────────────────────────────────────────────────────────────────────────┘
```

> Note: the loop is being upgraded from ReAct to an explicit
> **Observe → Orient → Goal → Plan → Action** loop — see
> [`OBSERVE-ORIENT-GOAL-PLAN-ACTION.md`](OBSERVE-ORIENT-GOAL-PLAN-ACTION.md).

---

## 0. Current state (already shipped)

The end-to-end loop **signed-in user → cloud memory → local PC actions** is functional.

| Area | Files |
|---|---|
| Per-user workspace memory (memory/project/agent/skill/goal/action/log/decision) | `backend/controllers/workspaceController.js`, `backend/services/workspaceContext.js` |
| Workspace REST API mount | `backend/routes/routeData.js` (`/api/data/csimple/workspace/*`) |
| Web UI for memory & agents | `frontend/src/components/SimpleAddon/WorkspaceManager.jsx` |
| Electron addon + tray | `simple-addon/main.js`, `simple-addon/tray.js` |
| Local API server | `simple-addon/server/index.js` |
| Tool registry + permission gate | `simple-addon/server/automation/tool-registry.js`, `simple-addon/server/automation/permissions.js` |
| Tools: shell, fs, system, uia, screen, input, goal, vision-fusion | `simple-addon/server/automation/tools/*`, `simple-addon/server/automation/vision-fusion.js` |
| ReAct agent loop | `simple-addon/server/automation/agent-loop.js` |
| Cloud audit log + workspace client | `simple-addon/server/automation/workspace-client.js` |
| Permission Center BrowserWindow | `simple-addon/renderer/permissions.html` |
| Eye tracking subsystem | `simple-addon/scripts/eye_tracker.py`, `simple-addon/eye-tracking-manager.js` |

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
| Encrypt cloud-relay token at rest with Windows DPAPI | `simple-addon/server/cloud-relay.js` | Token never on disk plaintext |
| Bind addon HTTP server to 127.0.0.1 only; document the 3444 HTTPS path | `simple-addon/server/index.js` | `netstat -ano | findstr 3001` shows loopback only |
| Code-sign installer & publish releases via signed updater | `simple-addon/release.js`, `simple-addon/auto-updater.js` | Installer not flagged by SmartScreen |
| Add structured telemetry: `POST /api/data/csimple/workspace/telemetry/append` (latency, tool, ok, errCode) | `backend/controllers/workspaceController.js`, new `simple-addon/server/automation/telemetry.js` | Per-tool metrics queryable from web UI |
| Eval harness skeleton: `simple-addon/server/automation/eval/` with a `runScenario(yaml)` API | new | Can replay 1 scripted scenario against a fixture |
| Backend rate-limit hardening on workspace endpoints | `backend/middleware/rateLimiter.js`, `backend/routes/routeData.js` | 429 on bursts; per-user buckets |
| Document threat model & permissions matrix | `docs/implementation/AUTOMATION_SECURITY.md` (new) | Reviewable doc |

### Phase 2 — Perception & web automation — 2–3 weeks ✅ COMPLETE

Goal: the agent can "see" the screen efficiently and drive web apps reliably.

| Task | Location | Status |
|---|---|---|
| `uia_snapshot` tool: full window UIA tree → compact JSON | `simple-addon/server/automation/tools/uia.js` | ✅ Done. Three modes (tree/interactive/flat), file-based PS runner, env-var-expanded scenarios. |
| Perception cache (lighter alternative to a constant pump): on-demand caching of `uia_snapshot` with TTL, coalesces concurrent calls | `simple-addon/server/automation/perception.js` | ✅ Done. `perception_recent` tool + optional background pump. |
| OCR fallback tool `screen_ocr` using Windows.Media.Ocr | `simple-addon/server/automation/tools/ocr.js` | ✅ Done. Returns lines + per-word boxes; supports region capture + path-only OCR. |
| Set-of-marks helper: overlay numbered boxes from UIA tree onto a screenshot for vision LLM | `simple-addon/server/automation/tools/set-of-marks.js` | ✅ Done. `screen_set_of_marks` returns annotated PNG + legend. |
| Playwright tool family: `browser_open/goto/click/fill/text/eval/screenshot/status/close` with managed Chromium | `simple-addon/server/automation/tools/browser.js` | ✅ Done. Uses `playwright-core` + auto-detects Edge/Chrome (no bundled binary). |
| Browser session persistence (cookies, localStorage) | same | ✅ Done. `launchPersistentContext(userDataDir)` per profile; scenario 08 proves it. |

### Phase 3 — Skills & demonstrations — 3–4 weeks 🟡 IN PROGRESS

Goal: the agent learns from one demonstration; recurring tasks become deterministic.

| Task | Location | Status |
|---|---|---|
| Global input recorder (polling-based mouse + window-focus capture via PowerShell; native keyboard hook deferred to v2) | `simple-addon/server/automation/recorder/polling-source.js`, `session.js`, `index.js` | ✅ Done. Persists JSONL to `<userData>/recordings/`, append-only, flush every 500ms. |
| Recorder UI: tray entry "Record demonstration" + "Recorded Skills…" window | `simple-addon/tray.js`, `simple-addon/renderer/recordings.html`, `main.js` | ✅ Done. Tray menu shows live status; renderer drives start/stop/compile/save/run. |
| Skill compiler: post-process recording → coalesce focus + clicks → parameterized tool-call sequence stored as workspace `kind=skill` | `simple-addon/server/automation/recorder/compiler.js` | ✅ Done. Compiler v1 + 20-case unit test suite. v2 (UIA-bound clicks, type-text runs, param inference) deferred. |
| Skill runner tool: `skill_run(slug, args)` with `${param.x}` substitution, continueOnError, local cache + workspace fallback | `simple-addon/server/automation/tools/skill.js` | ✅ Done. Two eval scenarios (09, 10) prove ephemeral run + param substitution. |
| Skill discovery in agent loop: prefer matching skill over open-ended planning | `simple-addon/server/automation/agent-loop.js` | ✅ Done. Each step, top-3 token-overlap matches across cache + workspace are appended to the system prompt as `RECORDED SKILLS THAT MIGHT MATCH THIS GOAL` with explicit "prefer skill_run" instruction. |
| Skill versioning + concurrency via existing workspace `expectedUpdatedAt` | reuse | ⏳ Not started. |
| LLM repair fallback: if a step fails, ask the model to amend args using a fresh `uia_snapshot` | `tools/skill.js` | ✅ Done. `skill_run` now repairs failed steps: captures a fresh interactive `uia_snapshot`, asks the model for amended args (`{"action":"retry","args":{...}}` / `{"action":"abort"}`), retries once (configurable via `maxRepairs`, disable with `repair:false`). 19 unit tests in `tools/skill.test.js`. |
| Native keyboard hook (uiohook-napi or C# helper) for full demonstration fidelity | `recorder/` | ⏳ Not started — v1 captures mouse + focus only. |

### Phase 4 — Autonomy & remote control — 3–4 weeks 🟡 IN PROGRESS

Goal: the agent runs unattended, you supervise from anywhere.

| Task | Location | Status |
|---|---|---|
| Planner pass: before agent loop starts, LLM call decomposes goal into `parentGoalId`-linked sub-goals stored via workspace API | `simple-addon/server/automation/planner.js`, hook into `agent-loop.js` start | ✅ Done. `shouldPlan` heuristic (length/connectives), `_validatePlan` rejects bad LLM output, idempotent re-runs skip existing slugs, decreasing priority preserves order. 27 unit tests. |
| Trigger engine: cron + file-watcher (chokidar) + hotkey (`iohook`) + system event → enqueue goal | `simple-addon/server/automation/triggers.js` | ✅ Done. In-house 5-field cron parser, `fs.watch`-based file watcher, hotkey delegation to Electron `globalShortcut`. CRUD via `/api/triggers`. 19 unit tests. |
| Event bus + SSE stream `/api/agent/events` from addon → web UI live panel | `simple-addon/server/automation/events.js`, `index.js` | ✅ Done. Ring-buffered, type-filterable, supports `sinceSeq` replay + heartbeat. Publishers wired in tool registry, agent loop, recorder, approval flow, permissions. 13 unit tests. |
| Live screenshot relay path (addon uploads small thumbnail via existing `s3Service` then SSE the URL) | `backend/services/s3Service.js`, `simple-addon/server/automation/perception.js` | ⏳ Not started. |
| Pending-approval push: route approval to (a) local Permission Center AND (b) web UI banner AND (c) push notification (web-push or email fallback) | `backend/services/emailService.js`, new `backend/controllers/approvalController.js`, `simple-addon/server/automation/index.js` | ⏳ Not started. |
| Unattended auto-approval: `autoApproveAll` flag fast-tracks `ask`-mode tool calls (no prompt) for hands-off runs | `simple-addon/server/automation/permissions.js`, `frontend/src/components/SimpleAddon/AgentLivePanel.jsx` | ✅ Done. `permissions.autoApproveAll` (default off). Hard stops still win: kill switch, per-tool/category `deny`, `dryRunMode`, and the shell deny-list are unaffected. Toggle on the `/net` live panel (+ `getAutomationPermissions`/`setAutoApproveAll` API helpers). 8 unit tests in `permissions.test.js`. |
| Multi-monitor support in `screen_capture` and `uia_*` | `simple-addon/server/automation/tools/screen.js`, `tools/uia.js` | ⏳ Not started. |
| Live web UI panel (frontend) subscribing to SSE | `frontend/src/components/SimpleAddon/AgentLivePanel.jsx` (+ `.css`), wired into `frontend/src/pages/Simple/Net/Net.jsx` | ✅ Done. Subscribes to addon `/api/agent/events` via EventSource; renders live `screen.frame` thumbnail, rolling activity feed, pending-approval cards (approve/deny), and Start/Stop/Kill-switch + Refresh-Frame controls. API helpers added to `frontend/src/services/simpleAddonApi.js` (`getAgentEventsUrl`, `getAgentStatus`, `startAgent`, `stopAgent`, `getPendingApprovals`, `resolveApproval`, `activateKillSwitch`, `relayScreenFrame`). |

### Phase 5 — Intelligence & ecosystem — ongoing

Goal: continuous improvement and community.

| Task | Location | Acceptance |
|---|---|---|
| Eval harness fixtures: 20+ recorded scenarios with success criteria | `simple-addon/server/automation/eval/scenarios/` | `npm run eval` reports pass rate |

---

## 3. Future capability plans

Longer-horizon capabilities (formerly the "Phase 6–10" of the absorbed
`AUTONOMOUS_WINDOWS_AGENT_PLAN.md`). These overlap with §1 gaps; the
Observe→Orient→Goal→Plan→Action plan owns the current loop work.

### 3.1 Audio / voice pipeline

**Goal**: mic input → Whisper STT → intent → goal creation → TTS response.

Files:
- `simple-addon/scripts/voice_pipeline.py` — Python subprocess: record audio, run Whisper, detect wakeword, return transcript JSON
- `simple-addon/server/audio-stream-manager.js` — Node.js manager: spawn/restart voice_pipeline.py, emit events (transcript-ready, wakeword, audio-level)
- `simple-addon/server/automation/tools/audio.js` — agent tool: `audio_transcribe` (last N seconds), `audio_listen` (blocking, with timeout)
- Updated `requirements.txt`: add `openai-whisper`, `sounddevice`, `pyttsx3`
- Endpoints: `POST /api/voice/listen`, `POST /api/voice/speak`, `GET /api/voice/status`

Voice assistant flow:
1. Background: continuous audio level monitoring (VAD — voice activity detection)
2. On wakeword "hey simple" OR button press → start recording
3. Silence detection (>800ms) → send to Whisper
4. Intent extraction → create/update goal OR answer question directly
5. TTS response via pyttsx3

### 3.2 Natural Language Macro Compiler

**Goal**: "mine stone in minecraft until I press escape" → structured skill steps.

Files:
- `simple-addon/server/automation/nl-compiler.js` — LLM-based compiler
  - Parses English instruction into typed step array
  - Supported step types: `key_tap`, `key_hold`, `type_text`, `wait_ms`, `click_coords`, `loop_until_key`, `loop_N_times`, `condition_check`, `skill_run`, `screenshot_ocr_check`
  - Validates output; rejects unsafe patterns
  - Supports "until I press <key>" → `loop_until_key` terminator
- Endpoint: `POST /api/skill/compile-natural`
- Frontend update: NL macro textarea in `ShortcutsManager.jsx`

### 3.3 Continuous perception bus

**Goal**: unified event stream from all input sources, fed into agent context.

Files:
- `simple-addon/server/automation/perception-bus.js` — EventEmitter:
  - Sources: screen (configurable interval), audio (transcript stream), eye gaze (from eye-tracking-manager IPC), UIA (foreground window changes), keyboard patterns (from action log tail)
  - Emits `frame` events with unified snapshot `{ts, screen, audio, gaze, foregroundWindow, recentActions}`
  - Rolling history: last 20 frames
  - `getLatestFrame()` — agent context integration
  - `subscribe(fn)` / `unsubscribe(fn)`
- Updated `agent-loop.js`: inject `perceptionBus.getLatestFrame()` into system prompt
- Endpoint: `GET /api/perception/status`, `GET /api/perception/frame`

Webcam capture tool (extends eye tracker's Python process):
- `simple-addon/server/automation/tools/webcam.js` — `webcam_capture`: capture a frame from the webcam (not eye tracker), return base64 JPEG, optionally run face/scene description via multimodal LLM

### 3.4 Behavioral predictor

**Goal**: observe action patterns → predict + preemptively execute safe next steps.

Files:
- `simple-addon/server/automation/predictor.js`:
  - Reads last 50 actions from workspace action log
  - Builds n-gram model over (tool, args_fingerprint) sequences
  - Predicts next action with probability
  - Safe-read actions (screen_capture, uia_snapshot, fs_read) can execute speculatively
  - Emits `prediction` event on perception bus
- Endpoint: `GET /api/agent/predictions`
- Frontend: show predicted next action in Live Panel with "Run Now" / "Ignore" buttons

### 3.5 Frontend integration

**Goal**: expose all new capabilities in the web UI.

Files:
- `ShortcutsManager.jsx`: add NL macro textarea with "Compile" button
- `AgentLivePanel.jsx`: add perception bus status, voice waveform, predictions panel
- `SimpleChat.jsx`: voice input button (hold-to-talk or wakeword toggle)
- `simpleAddonApi.js`: new helpers for voice, NL compiler, perception, predictor

---

## 4. Data Model (DynamoDB Workspace)

```
Kind        Slug pattern              Purpose
─────────── ──────────────────────── ──────────────────────────────────────────
goal        <user-slug>              Active goal with priority, status, criteria
action      log-<YYYY-MM-DD>         JSONL ring buffer (200KB) — tool audit log
skill       <macro-slug>             Recorded or NL-compiled macro steps JSON
memory      user_profile             Long-term user memory (injected into context)
memory      behavioral-patterns      Predictor n-gram cache (updated daily)
decision    <ISO-date>-<slug>        Reflection summaries from agent loop
project     triggers                 Trigger engine config (cron/file/hotkey)
project     voice-config             Wakeword, mic index, Whisper model size
log         <YYYY-MM-DD>             Audit log for all workspace mutations
```

---

## 5. Safety & Privacy Controls

| Concern | Mitigation |
|---------|-----------|
| Continuous audio recording | Default OFF; user opt-in per session; no cloud upload |
| Webcam capture | Default OFF; per-goal consent; frames never stored |
| Keyboard capture | Sensitive capture consent (keyboard=false default) |
| Shell commands | Deny-list enforced; destructive commands need approval |
| Prediction preemptive actions | Only safe-read tools; all writes still gated by permission |
| Data retention | Audio buffer: max 30s rolling; frames: max 20 in RAM; never persisted |
| Kill switch | Emergency stop clears all buffers, stops all subprocesses |

> For the full threat model, permissions matrix, and trust boundaries, see
> [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md).

---

## Related docs

- [`simple-agent-prompt.md`](simple-agent-prompt.md) — the platform brief (vision, marketplace, skill generalization, monetization).
- [`OBSERVE-ORIENT-GOAL-PLAN-ACTION.md`](OBSERVE-ORIENT-GOAL-PLAN-ACTION.md) — the current agent-loop implementation plan.
- [`AUTOMATION_SECURITY.md`](AUTOMATION_SECURITY.md) — threat model & security notes.
