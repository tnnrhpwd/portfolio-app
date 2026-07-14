# Autonomous Windows Agent — Implementation Plan

## Vision

Build the best Windows automation software on the planet: a multimodal, LLM-driven agent that reads webcam, PC audio, keyboard/mouse events, and screen images — synthesises them into a unified perceptual model — then acts preemptively on behalf of the user to complete goals stored per-user in the cloud database.

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
│  │                     AGENT LOOP (ReAct)                              │   │
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

---

## Implementation Phases

### Phase 1–5 (DONE)
- Agent loop (ReAct), tool registry, skill recorder, hotkeys, permissions ✅
- Workspace API (goals, actions, memory, projects, skills in DynamoDB) ✅
- Eye tracking (webcam → gaze → cursor) ✅
- Perception cache (UIA snapshot) ✅
- Planner (multi-step goal decomposition) ✅
- Triggers (cron, file-watch, hotkey → goal) ✅
- Live web panel (EventSource monitoring) ✅
- Skill repair fallback ✅
- Sensitive capture consent ✅

### Phase 6 — Audio / Voice Pipeline (NEXT)
**Goal**: mic input → Whisper STT → intent → goal creation → TTS response.

Files:
- `csimple-addon/scripts/voice_pipeline.py` — Python subprocess: record audio, run Whisper, detect wakeword, return transcript JSON
- `csimple-addon/server/audio-stream-manager.js` — Node.js manager: spawn/restart voice_pipeline.py, emit events (transcript-ready, wakeword, audio-level)
- `csimple-addon/server/automation/tools/audio.js` — agent tool: `audio_transcribe` (last N seconds), `audio_listen` (blocking, with timeout)
- Updated `requirements.txt`: add `openai-whisper`, `sounddevice`, `pyttsx3`
- Endpoints: `POST /api/voice/listen`, `POST /api/voice/speak`, `GET /api/voice/status`

Voice assistant flow:
1. Background: continuous audio level monitoring (VAD — voice activity detection)
2. On wakeword "hey csimple" OR button press → start recording
3. Silence detection (>800ms) → send to Whisper
4. Intent extraction → create/update goal OR answer question directly
5. TTS response via pyttsx3

### Phase 7 — Natural Language Macro Compiler
**Goal**: "mine stone in minecraft until I press escape" → structured skill steps.

Files:
- `csimple-addon/server/automation/nl-compiler.js` — LLM-based compiler
  - Parses English instruction into typed step array
  - Supported step types: `key_tap`, `key_hold`, `type_text`, `wait_ms`, `click_coords`, `loop_until_key`, `loop_N_times`, `condition_check`, `skill_run`, `screenshot_ocr_check`
  - Validates output; rejects unsafe patterns
  - Supports "until I press <key>" → `loop_until_key` terminator
- Endpoint: `POST /api/skill/compile-natural`
- Frontend update: NL macro textarea in `ShortcutsManager.jsx`

### Phase 8 — Continuous Perception Bus
**Goal**: unified event stream from all input sources, fed into agent context.

Files:
- `csimple-addon/server/automation/perception-bus.js` — EventEmitter:
  - Sources: screen (configurable interval), audio (transcript stream), eye gaze (from eye-tracking-manager IPC), UIA (foreground window changes), keyboard patterns (from action log tail)
  - Emits `frame` events with unified snapshot `{ts, screen, audio, gaze, foregroundWindow, recentActions}`
  - Rolling history: last 20 frames
  - `getLatestFrame()` — agent context integration
  - `subscribe(fn)` / `unsubscribe(fn)`
- Updated `agent-loop.js`: inject `perceptionBus.getLatestFrame()` into system prompt
- Endpoint: `GET /api/perception/status`, `GET /api/perception/frame`

Webcam capture tool (extends eye tracker's Python process):
- `csimple-addon/server/automation/tools/webcam.js` — `webcam_capture`: capture a frame from the webcam (not eye tracker), return base64 JPEG, optionally run face/scene description via multimodal LLM

### Phase 9 — Behavioral Predictor
**Goal**: observe action patterns → predict + preemptively execute safe next steps.

Files:
- `csimple-addon/server/automation/predictor.js`:
  - Reads last 50 actions from workspace action log
  - Builds n-gram model over (tool, args_fingerprint) sequences
  - Predicts next action with probability
  - Safe-read actions (screen_capture, uia_snapshot, fs_read) can execute speculatively
  - Emits `prediction` event on perception bus
- Endpoint: `GET /api/agent/predictions`
- Frontend: show predicted next action in Live Panel with "Run Now" / "Ignore" buttons

### Phase 10 — Frontend Integration
**Goal**: expose all new capabilities in the web UI.

Files:
- `ShortcutsManager.jsx`: add NL macro textarea with "Compile" button
- `AgentLivePanel.jsx`: add perception bus status, voice waveform, predictions panel
- `CSimpleChat.jsx`: voice input button (hold-to-talk or wakeword toggle)
- `csimpleApi.js`: new helpers for voice, NL compiler, perception, predictor

---

## Data Model (DynamoDB Workspace)

```
Kind        Slug pattern              Purpose
─────────── ──────────────────────── ──────────────────────────────────────────
goal        <user-slug>              Active goal with priority, status, criteria
action      log-<YYYY-MM-DD>         JSONL ring buffer (200KB) — tool audit log
skill       <macro-slug>             Recorded or NL-compiled macro steps JSON
memory      user_profile             Long-term user memory (injected into context)
memory      behavioral-patterns      Predictor n-gram cache (updated daily)
decision    <ISO-date>-<slug>        Reflection summaries from ReAct loop
project     triggers                 Trigger engine config (cron/file/hotkey)
project     voice-config             Wakeword, mic index, Whisper model size
log         <YYYY-MM-DD>             Audit log for all workspace mutations
```

---

## Safety & Privacy Controls

| Concern | Mitigation |
|---------|-----------|
| Continuous audio recording | Default OFF; user opt-in per session; no cloud upload |
| Webcam capture | Default OFF; per-goal consent; frames never stored |
| Keyboard capture | Sensitive capture consent (keyboard=false default) |
| Shell commands | Deny-list enforced; destructive commands need approval |
| Prediction preemptive actions | Only safe-read tools; all writes still gated by permission |
| Data retention | Audio buffer: max 30s rolling; frames: max 20 in RAM; never persisted |
| Kill switch | Emergency stop clears all buffers, stops all subprocesses |

---

## Performance Budget

| Component | Target latency | Notes |
|-----------|---------------|-------|
| STT (Whisper tiny) | <500ms | Local CPU; tiny model ~39M params |
| STT (Whisper base) | <1.5s | Better accuracy; base model ~74M params |
| NL compiler (LLM) | <3s | GitHub Models API; cached for same description |
| Agent step | <5s | Including tool execution |
| Perception bus frame | 100ms–5s | Configurable per source |
| UIA snapshot | ~700ms | Cached, reused for 4s |
| Screen capture | ~200ms | PowerShell .NET |
| Webcam frame | ~50ms | OpenCV |
| Prediction | <10ms | In-process n-gram lookup |

---

## LLM Cost Strategy

- Default model: `openai/gpt-4o-mini` (~$0.15/M input tokens) for agent reasoning
- Whisper: local inference (free, runs in Python venv)
- Vision tasks (webcam description, SOM): `openai/gpt-4o-mini` with image
- Heavy planning: `openai/gpt-4o` only when explicitly requested
- Prediction: zero LLM cost (n-gram pattern matching)
- NL compiler: one-shot LLM call, result cached by description hash

---

## Security Considerations (OWASP Top 10)

- **Injection**: All shell commands piped through stdin (no string interpolation); NL compiler output validated against schema before execution
- **Broken Access Control**: All write endpoints require signed-in user token; addon endpoints bound to 127.0.0.1
- **Cryptographic failures**: GitHub token stored in Electron keychain (secret-storage.js); never in logs
- **SSRF**: Webcam/audio data never sent to arbitrary URLs; only to GitHub Models API
- **Security Misconfiguration**: Kill switch always accessible; no default admin credentials
- **Logging**: All tool executions audit-logged; PII (transcripts) logged locally only, never cloud
