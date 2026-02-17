# CSimple Integration — Phase 2 & 3 Implementation Plan

This document exists solely to give the implementing agent full context for building the Electron addon (Phase 2) and backend settings sync (Phase 3). Phase 1 (frontend integration) is already complete and deployed in this repo.

---

## What Phase 1 Already Did

The CSimple.Webapp UI was copied from `C-Simple/src/CSimple.Webapp/client/` into this portfolio-app and adapted to work inside the `/net` route. Here's exactly what exists now:

### Files in `frontend/src/`

**Service layer:**
- `services/csimpleApi.js` — All addon communication. Exports: `detectAddon()`, `getAddonStatus()`, `onAddonStatusChange()`, `startAddonPolling()`, `getLocalModels()`, `sendChatMessage()`, `streamChatMessage()`, `stopGeneration()`, `confirmAction()`, `getAddonSettings()`, `saveAddonSettings()`, `getNetworkInfo()`, `getBehaviors()`, `getBehaviorContent()`, `getActionBridgeStatus()`, `getPortfolioApiUrl()`, `getPortfolioLLMProviders()`. Addon detection tries `http://localhost:3001` and `https://localhost:3444` with a 2-second timeout on `/api/status`.

**Hooks in `hooks/csimple/`:**
- `useAddonDetection.js` — Polls every 30s, tracks `isConnected`, `isChecking`, `dismissed` (sessionStorage), `showInstallPrompt`
- `useSpeech.js` — TTS + STT + wake word detection (882 lines, uses Web Speech API)
- `useMicDevices.js` — `navigator.mediaDevices.enumerateDevices()` with metering via AudioContext
- `useInactivity.js` — Pauses mic listening after 3 minutes of no mouse/keyboard

**Components in `components/CSimple/`:**
- `CSimpleChat.jsx` — Main orchestrator (~580 lines). Adapted from CSimple.Webapp's `App.jsx`. Receives `addonStatus`, `user`, `portfolioLLMProviders`, `onPortfolioChat`, `portfolioChatLoading`, `portfolioChatResponse` as props. Routes chat to 3 providers based on `settings.llmProvider`:
  - `'portfolio'` → calls `onPortfolioChat(message, history)` which dispatches Redux `compressData` thunk
  - `'local'` → calls `sendChatMessage()` from csimpleApi (addon must be connected)
  - `'github'` → same path as local, addon routes to GitHub Models API
- `Sidebar.jsx` — Rewritten. Has LLM provider selector (portfolio/local/github), model dropdown that fetches from `getLocalModels()` when addon connected or shows portfolio models from `portfolioLLMProviders` prop. Disables local model select when addon disconnected.
- `ChatWindow.jsx` — Copied from CSimple.Webapp. Renders messages, input bar, speech controls.
- `MessageBubble.jsx` — Uses `react-markdown` for rendering. Copied unchanged.
- `ConfirmationPanel.jsx` — Copied unchanged. Shows confirmation options for actions.
- `AdvancedSettings.jsx` — Copied with import path fix (`../../hooks/csimple/useSpeech`) and `window.confirm` fix. Full settings editor including agent management, behavior files, theme selection.
- `AddonInstallPrompt.jsx` — New. Banner at top of chat when addon not detected. Links to GitHub releases page. Dismiss persists in sessionStorage.
- `CSimpleChat.css` — Layout + inactivity overlay (scoped with `.csimple-` prefix)
- `CSimpleTheme.css` — Theme bridge. Maps portfolio's `.light-theme`/`.dark-theme` body classes to CSimple CSS variables within `.csimple-root` container. Also supports all 13 CSimple themes via `[data-csimple-theme="..."]` attribute selectors.
- `ChatWindow.css`, `Sidebar.css`, `MessageBubble.css`, `ConfirmationPanel.css`, `AdvancedSettings.css` — Copied from CSimple.Webapp.

**Page:**
- `pages/Simple/Net/Net.jsx` — Replaced `<NNetChatView />` with `<CSimpleChat />`. Wraps in `Header` + `Footer`. Uses Redux `useSelector` to get `user`, `data`, `dataIsLoading`, `dataIsSuccess`, `operation`, `llmProviders`. Dispatches `compressData` for portfolio LLM, `getLLMProviders` on mount. Passes `handlePortfolioChat` callback and response state to CSimpleChat.

**Dependencies added:** `react-markdown@9.0.1`, `moment` (transitive fix for chartjs-adapter-moment)

### How the Three LLM Providers Work Right Now

1. **Portfolio (cloud)** — Works without addon. User types message → CSimpleChat calls `onPortfolioChat(text, history)` → Net.jsx dispatches `compressData({ data: { data: JSON.stringify({ text: "Net:" + combinedData }) }, options: { provider: 'openai', model: 'o1-mini' } })` → Redux thunk calls `POST /api/data/compress` on the Render backend → OpenAI API → response arrives via `dataIsSuccess` + `data.data[0]` → set as `portfolioChatResponse` prop → CSimpleChat displays it.

2. **Local (HuggingFace)** — Requires addon running at localhost:3001. CSimpleChat calls `sendChatMessage()` from csimpleApi → `POST /api/chat` on addon → addon's Express server runs `LlmService.generate()` → spawns `python run_hf_model.py` → returns response JSON with `{ response, modelId, generationTime }`.

3. **GitHub Models** — Requires addon for the GitHub token storage. CSimpleChat calls `sendChatMessage()` with the github model name → addon routes to `GitHubModelsService` → hits `https://models.inference.ai.azure.com` with OpenAI-compatible API.

---

## Phase 2: Electron Addon

### Goal

Package the CSimple.Webapp Express server as an installable Electron app that runs in the system tray. When the portfolio frontend visits `/net`, it detects the addon and unlocks local AI features.

### What the Addon Must Do

The addon IS the CSimple.Webapp server side. It needs to run the same Express server from `C-Simple/src/CSimple.Webapp/server/index.js` but packaged as a desktop app. It does NOT need the React client (that's now in portfolio-app).

Specifically, the addon must:

1. **Run the Express server** on ports 3001 (HTTP) and 3444 (HTTPS, self-signed) with open CORS
2. **Spawn Python** for HuggingFace model inference via `run_hf_model.py`
3. **Manage Python environment** — auto-create venv at `%LOCALAPPDATA%/CSimple/venv`, install `requirements.txt` dependencies (torch, transformers, accelerate, tokenizers, datasets, numpy, requests)
4. **Serve the action bridge** — queue actions via `POST /api/chat` → `actionService.queueAction()`, serve them at `GET /api/actions/pending` for the MAUI app or ActionBridge to poll
5. **Read/write settings** at `~/Documents/CSimple/Resources/settings.json`
6. **Read/write behavior files** at `~/Documents/CSimple/Resources/Behaviors/*.txt`
7. **Read personality files** at `~/Documents/CSimple/Resources/Personality/*.md`
8. **Store GitHub Models API token** in settings, used by `GitHubModelsService`
9. **Generate self-signed SSL certs** via OpenSSL for HTTPS/mic access

### Source Files to Include in Electron App

From `C-Simple/src/CSimple.Webapp/server/`:
| File | Size | Purpose |
|------|------|---------|
| `index.js` | ~1201 lines | Express server with all routes |
| `llm-service.js` | — | Spawns Python for HuggingFace models |
| `github-models-service.js` | — | OpenAI-compatible client to `models.inference.ai.azure.com` |
| `action-service.js` | ~1581 lines | NL→action plan parser, action queue, confirmations |
| `signal-bridge.js` | ~706 lines | Optional Signal messenger bridge |

From `C-Simple/src/CSimple/Scripts/`:
| File | Size | Purpose |
|------|------|---------|
| `run_hf_model.py` | ~131 KB | Main HuggingFace model runner |
| `setup_environment.py` | ~4 KB | Venv setup script |

From `C-Simple/`:
| File | Purpose |
|------|---------|
| `requirements.txt` | Python dependencies (torch, transformers, etc.) |

### Express Server Routes (what the addon must expose)

These are the routes the portfolio frontend calls via `csimpleApi.js`:

| Method | Route | Called By | Purpose |
|--------|-------|-----------|---------|
| GET | `/api/status` | `detectAddon()` | Health check. Returns `{ status: 'ok', uptime, pythonScript, timestamp }` |
| GET | `/api/models` | `getLocalModels()` | List available models (local HF + GitHub Models) |
| POST | `/api/chat` | `sendChatMessage()` | Main chat. Body: `{ message, model, conversationHistory, temperature, maxTokens, behaviorFile }`. Returns `{ response, modelId, generationTime }` or `{ confirmation: { id, question, options } }` |
| POST | `/api/chat/stop` | `stopGeneration()` | Kill current Python generation process |
| POST | `/api/chat/confirm` | `confirmAction()` | Confirm/cancel pending action. Body: `{ actionId, choice }` |
| GET | `/api/settings` | `getAddonSettings()` | Read webapp settings from `settings.json` |
| PUT | `/api/settings` | `saveAddonSettings()` | Write settings |
| GET | `/api/behaviors` | `getBehaviors()` | List behavior .txt files |
| GET | `/api/behaviors/:filename` | `getBehaviorContent()` | Read behavior file content |
| POST | `/api/behaviors` | AdvancedSettings | Create behavior file |
| PUT | `/api/behaviors/:filename` | AdvancedSettings | Update behavior file |
| DELETE | `/api/behaviors/:filename` | AdvancedSettings | Delete behavior file |
| GET | `/api/network` | `getNetworkInfo()` | Local network IPs |
| GET | `/api/actions/bridge-status` | `getActionBridgeStatus()` | Check if MAUI/ActionBridge is polling |
| GET | `/api/actions/pending` | ActionBridge polls | Drain + return queued actions |
| POST | `/api/actions/complete` | ActionBridge posts | Mark action done |
| POST | `/api/chat/stream` | `streamChatMessage()` | SSE streaming chat (not currently used in portfolio integration but available) |
| GET | `/api/memory` | AdvancedSettings | List memory files |
| GET | `/api/memory/:filename` | AdvancedSettings | Read memory file |
| POST/PUT/DELETE | `/api/memory/...` | AdvancedSettings | CRUD memory files |
| GET | `/api/personality` | Server internal | List personality .md files |
| GET/PUT | `/api/personality/:filename` | AdvancedSettings | Read/update personality |
| POST | `/api/agents/:agentId/avatar` | AdvancedSettings | Upload agent avatar (multer, 5MB) |
| GET | `/api/agents/:agentId/avatar` | Sidebar/chat | Serve agent avatar |

### Electron App Structure Plan

```
csimple-addon/
├── package.json
├── main.js                    # Electron main process
├── preload.js                 # Bridge for renderer (if needed for settings UI)
├── tray.js                    # System tray icon + menu
├── server/
│   ├── index.js               # Express server (modified: no static file serving, no SPA catch-all)
│   ├── llm-service.js         # (copied as-is)
│   ├── github-models-service.js # (copied as-is)
│   ├── action-service.js      # (copied as-is)
│   └── signal-bridge.js       # (optional, copied as-is)
├── scripts/
│   ├── run_hf_model.py        # (copied from C-Simple/src/CSimple/Scripts/)
│   ├── setup_environment.py   # (copied)
│   └── requirements.txt       # (copied)
├── resources/
│   └── icon.png               # Tray icon
├── installer/
│   └── ... (electron-builder config)
└── renderer/                  # Minimal settings window (optional)
    └── settings.html          # or a small React app
```

### Electron `main.js` — What It Does

1. Check/create `~/Documents/CSimple/Resources/` directory tree (Settings, Behaviors, Personality, Memory, Agents)
2. Check Python availability (`python`, `python3`, `py`)
3. Auto-setup venv if not exists: `python -m venv %LOCALAPPDATA%/CSimple/venv`, then `pip install -r requirements.txt`
4. Start the Express server (import `server/index.js` or spawn it as child process)
5. Create system tray icon with menu: Status, Open Settings, Restart Server, Quit
6. **Do NOT show a main window** — this is a tray-only app
7. On quit: kill Express server, kill any Python child processes

### Modifications to `server/index.js` for Electron

1. Remove `express.static(clientBuildPath)` — no client UI (it's in portfolio-app now)
2. Remove SPA catch-all route (`app.get('*', ...)`)
3. Add CORS headers to allow `https://sthopwood.com` (the portfolio frontend domain) specifically, in addition to `localhost`
4. The `SCRIPTS_PATH` resolution might need updating:
   - Original: `path.resolve(__dirname, '../../CSimple/Scripts/')` — relative to CSimple.Webapp's position in C-Simple repo
   - Electron: Should use `path.join(app.getAppPath(), 'scripts/')` or resolve from the packaged resources
5. Same for `PROJECT_ROOT` which is used for model scanning

### HTTPS / Self-Signed Certs

The original server generates certs via `child_process.execSync('openssl req -x509 ...')`. In Electron:
- Bundle OpenSSL or use Node's `crypto` module to generate self-signed certs
- Store in `%LOCALAPPDATA%/CSimple/certs/`
- User may need to trust the cert for mic access in the browser (this is why the original server uses HTTPS — browsers require HTTPS for `getUserMedia`)

### Installer Distribution

Use `electron-builder` with:
- Windows: NSIS installer (`.exe`) or portable (`.exe`)
- Auto-update: `electron-updater` pointing to GitHub Releases on `tnnrhpwd/C-Simple`
- File associations: None needed
- Startup: Optional "Launch on system startup" setting (registry `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`)

### Key Decisions for Phase 2

1. **Python bundling**: Do NOT bundle Python. Require it to be pre-installed. The venv/pip setup script handles the rest. Show a clear error + download link if Python is missing.
2. **Model downloads**: Models are not bundled. They download on first use via HuggingFace's transformers library (cached in `~/.cache/huggingface/hub/`). The addon should show download progress somehow (tray tooltip or notification).
3. **Port conflicts**: If 3001 is busy, try 3002, 3003... and update the status endpoint accordingly. The portfolio frontend already tries multiple ports during detection.
4. **Firewall**: The addon listens on `0.0.0.0` for LAN access. Consider a setting to restrict to `127.0.0.1` only.
5. **ActionBridge**: The original C-Simple runs a separate .NET project `CSimple.ActionBridge` that polls `GET /api/actions/pending`. For the Electron addon, either:
   - Bundle the ActionBridge .exe and spawn it
   - Or rewrite the Win32 input simulation in Node.js using `ffi-napi` / `koffi` / `node-ffi` to call `SendInput`, `FindWindow`, `SetForegroundWindow`
   - Recommend: Keep spawning ActionBridge for now. It's a small .NET console app.
6. **Signal Bridge**: Optional feature. Don't include in initial release.

---

## Phase 3: Backend Settings Sync

### Goal

When a user is logged into their portfolio account and has the CSimple addon running, their CSimple settings (theme, agents, behaviors, conversation history) sync to the cloud so they persist across devices.

### Architecture

```
Portfolio Frontend (sthopwood.com/net)
    ↓ Redux dispatch
Portfolio Backend (Render)
    ↓ DynamoDB
Cloud Storage (Simple table)
    ↑ Sync on login
Portfolio Frontend
    ↓ Props
CSimpleChat component
    ↓ csimpleApi
Local Addon (settings.json, behaviors/)
```

### What Syncs

| Data | Local Storage | Cloud Storage | Sync Direction |
|------|---------------|---------------|----------------|
| Settings (theme, fontSize, etc.) | `~/Documents/CSimple/Resources/settings.json` | DynamoDB `Simple` table | Bidirectional, last-write-wins |
| Conversation history | `localStorage('csimple_chats')` | DynamoDB `Simple` table | Up on save, down on login |
| Behavior files | `~/Documents/CSimple/Resources/Behaviors/*.txt` | DynamoDB `Simple` table | Bidirectional |
| Agent configs | Inside `settings.json` | DynamoDB `Simple` table | Part of settings sync |
| GitHub token | `settings.json` (local only) | **NEVER syncs** | Local only |
| Mic device, STT enabled | `localStorage('csimple_device_settings')` | **NEVER syncs** | Local only (device-specific) |

### Portfolio Backend Changes Needed

#### New Endpoints

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/data/csimple/settings` | JWT required | Get user's synced CSimple settings |
| PUT | `/api/data/csimple/settings` | JWT required | Save/update CSimple settings |
| GET | `/api/data/csimple/conversations` | JWT required | Get user's synced conversation list |
| PUT | `/api/data/csimple/conversations` | JWT required | Save conversations (compressed) |
| GET | `/api/data/csimple/behaviors` | JWT required | List synced behavior files |
| GET | `/api/data/csimple/behaviors/:name` | JWT required | Get behavior content |
| PUT | `/api/data/csimple/behaviors/:name` | JWT required | Save/update behavior |
| DELETE | `/api/data/csimple/behaviors/:name` | JWT required | Delete synced behavior |

#### DynamoDB Schema for Synced Data

Currently the portfolio uses a single `Simple` table with `id` as partition key. CSimple sync data would use the same table with a naming convention:

```
// Settings item
{
  id: "csimple_settings_{userId}",
  text: JSON.stringify(settingsObject),
  createdAt: "...",
  updatedAt: "..."
}

// Conversations item (may be large, consider compression)
{
  id: "csimple_convos_{userId}",
  text: JSON.stringify(conversationsArray),  // Could be big — consider gzip + base64
  createdAt: "...",
  updatedAt: "..."
}

// Behavior file item
{
  id: "csimple_behavior_{userId}_{filename}",
  text: behaviorContentString,
  createdAt: "...",
  updatedAt: "..."
}
```

DynamoDB item size limit is 400KB. Conversations could exceed this. Options:
- Compress with pako/zlib before storing
- Split into multiple items (pagination by conversation ID)
- Store only metadata + last N messages per conversation
- Use S3 for large conversation blobs (presigned URLs)

Recommend: Compress conversations with zlib, store as base64 in the `text` field. If still >400KB, split by conversation ID into separate items.

### Frontend Changes Needed

#### `csimpleApi.js` — New Cloud Sync Methods

Add these exports:

```javascript
export async function getCloudSettings(token) {
  const res = await fetch(`${getPortfolioApiUrl()}/csimple/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function saveCloudSettings(token, settings) {
  await fetch(`${getPortfolioApiUrl()}/csimple/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(settings),
  });
}

export async function getCloudConversations(token) { ... }
export async function saveCloudConversations(token, conversations) { ... }
export async function getCloudBehaviors(token) { ... }
export async function saveCloudBehavior(token, name, content) { ... }
export async function deleteCloudBehavior(token, name) { ... }
```

#### `CSimpleChat.jsx` — Sync Logic

Add a `useEffect` that runs when `user` prop changes (login/logout):

1. On login: Fetch cloud settings → merge with local (cloud wins for conflicts, keep device-local keys local) → apply merged settings
2. On settings change: If `settings.cloudSync` is enabled AND user is logged in, debounce-save to cloud (500ms)
3. On conversation change: If cloud sync enabled, debounce-save conversations to cloud (2s delay to batch rapid changes)
4. On behavior file change: Sync immediately (these change rarely)

Add a `cloudSync` toggle to AdvancedSettings:
- Default: `false` (local-only)
- When enabled: shows sync status indicator (⟳ syncing, ✓ synced, ✗ sync failed)
- Requires login — if not logged in, show "Log in to enable cloud sync" message

#### Conflict Resolution

Use "last-write-wins" with timestamps:
- Each settings save includes `updatedAt` timestamp
- On merge: compare `updatedAt` — newer wins per-field
- Conversations: merge by conversation ID. If same conversation exists locally and in cloud, keep the one with more messages (or newer `updatedAt`)

### Sync Flow Diagram

```
User visits /net → CSimpleChat mounts
  ├─ user prop exists (logged in)?
  │   ├─ YES → fetch cloud settings
  │   │     ├─ cloud has settings → merge with local, apply
  │   │     └─ cloud empty → push local settings to cloud
  │   └─ NO → use local settings only
  │
  ├─ user changes a setting
  │   ├─ save to local (always)
  │   ├─ cloudSync enabled? → debounce save to cloud
  │   └─ addon connected? → save to addon (settings.json)
  │
  └─ user sends/receives a message
      ├─ save to localStorage (always)
      └─ cloudSync enabled? → debounce save conversations to cloud
```

### Security Considerations

- **GitHub token** — NEVER syncs to cloud. Stored only in local addon's `settings.json`. The `CSimpleChat.jsx` already separates device-local settings via `DEVICE_LOCAL_KEYS` constant. Add `'githubToken'` to this list.
- **Behavior files** — May contain personal data. Sync is opt-in (requires explicit cloud sync toggle).
- **Conversations** — May contain sensitive prompts. Same opt-in sync.
- **Token validation** — Always validate JWT on backend before any sync operation. Use the existing `protect` middleware.
- **Rate limiting** — Add rate limiting to sync endpoints (max 10 saves/minute) to prevent abuse.

---

## Key Reference: Portfolio Backend Patterns

### Auth Token Access

```javascript
// In frontend Redux state:
const { user } = useSelector(state => state.data);
const token = user?.token;  // JWT string, 7-day expiry, stored in localStorage as JSON under key 'user'
```

### Existing `compressData` Thunk Pattern

This is how the portfolio currently calls its cloud LLM. The Phase 3 sync endpoints should follow the same pattern:

```javascript
// thunks/dataThunks.js
export const compressData = createAsyncThunk('data/compress', async ({ data, options }, thunkAPI) => {
  const token = thunkAPI.getState().data.user.token;
  return await dataService.compressData(data, token, options);
});

// dataService.js
const compressData = async (dataData, token, options = {}) => {
  const config = { headers: { Authorization: `Bearer ${token}` } };
  const requestData = { ...dataData, provider: options.provider || 'openai', model: options.model || 'o1-mini' };
  const response = await axios.post(API_URL + 'compress', requestData, config);
  return response.data;
};

// Redux reducer
.addCase(compressData.fulfilled, (state, action) => {
  state.dataIsLoading = false;
  state.dataIsSuccess = true;
  state.data = action.payload;
  state.operation = 'compress';
})
```

For Phase 3, add new thunks like `syncCSimpleSettings`, `syncCSimpleConversations` with their own `operation` values so they don't collide with `'compress'`.

### DynamoDB Access Pattern

```javascript
// Backend uses AWS SDK v3
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

// Table name: "Simple"
// Partition key: "id" (String)
// No sort key

// Write:
await dynamodb.send(new PutCommand({ TableName: "Simple", Item: { id: "...", text: "...", createdAt: "..." } }));

// Read:
const { Item } = await dynamodb.send(new GetCommand({ TableName: "Simple", Key: { id: "..." } }));

// Update:
await dynamodb.send(new UpdateCommand({
  TableName: "Simple",
  Key: { id: "..." },
  UpdateExpression: "SET #text = :text, updatedAt = :now",
  ExpressionAttributeNames: { "#text": "text" },
  ExpressionAttributeValues: { ":text": "...", ":now": new Date().toISOString() },
}));
```

### Backend Route Registration

Routes are registered in `backend/routes/dataRoutes.js`:
```javascript
router.route('/compress').post(protect, compressData);
router.route('/llm-providers').get(getLLMProviders);
// Add new routes here:
// router.route('/csimple/settings').get(protect, getCSimpleSettings).put(protect, updateCSimpleSettings);
```

---

## Implementation Priority Order

### Phase 2 (Electron Addon)
1. Scaffold Electron app with `electron-builder`
2. Copy server files from CSimple.Webapp (minus client serving)
3. Add CORS for `sthopwood.com`
4. Fix `SCRIPTS_PATH` resolution for packaged app
5. Add system tray with status/quit menu
6. Add Python detection + venv auto-setup
7. Test: start addon → visit sthopwood.com/net → verify addon detected → send local chat
8. Configure electron-builder for Windows NSIS installer
9. Set up GitHub Actions to build + publish to GitHub Releases
10. Update `AddonInstallPrompt.jsx` download link to point to actual release URL

### Phase 3 (Settings Sync)
1. Add backend endpoints (settings CRUD, conversation CRUD, behavior CRUD)
2. Add Redux thunks for sync operations
3. Add cloud sync toggle to AdvancedSettings
4. Add sync logic to CSimpleChat (merge on login, debounce-save on change)
5. Add sync status indicator
6. Handle DynamoDB size limits for conversations
7. Test: login → change setting → logout → login on different browser → verify setting persisted

---

## CSimple.Webapp Server Internals (Deep Reference)

### `/api/chat` Full Flow (from `server/index.js` lines 146-287)

1. Parse body: `message`, `modelId` (default 'gpt2'), `systemPrompt`, `temperature` (0.7), `topP` (0.9), `maxLength` (500), `conversationHistory[]`
2. Action detection: `actionService.detectAction(message)` — regex-based NL→action plan
3. Multi-step override: If `looksLikeMultiStep()`, LLM parses via GPT-4o-mini
4. If action detected:
   - LLM decides if confirmation needed (destructive → yes, simple → no)
   - If yes → store confirmation, return `{ confirmation: { id, question, options } }`
   - If no → `actionService.queueAction()`, log `[ACTION_EXECUTE]{json}` to stdout, return action plan
5. If not action: Route to GitHubModelsService or LlmService based on model ID
6. Personality context loaded from `~/Documents/CSimple/Resources/Personality/{identity.md, soul.md, user.md}`
7. Response: `{ response, modelId, generationTime, timestamp }`

### Action Bridge Polling (how MAUI/ActionBridge consumes actions)

- `GET /api/actions/pending` — returns and DRAINS the `pendingActions[]` array
- `POST /api/actions/complete` — body `{ actionId, success, error }`, logs to `actionHistory`
- `GET /api/actions/bridge-status` — `{ connected: true }` if last poll was <5 seconds ago
- `lastBridgePoll` timestamp updated on every `GET /api/actions/pending` request

### LlmService (Python spawning)

- Finds Python: tries `python`, `python3`, `py` — picks first one that runs
- Script path: `PROJECT_ROOT/Scripts/run_hf_model.py` (131 KB)
- Venv: `%LOCALAPPDATA%/CSimple/venv` — auto-created with `setup_environment.py`
- Model scan: checks `PROJECT_ROOT/Resources/HFModels/` and `~/.cache/huggingface/hub/` for local model files (`.bin`, `.safetensors`, `config.json`)
- Prompt format: ChatML (`<|im_start|>system\n...<|im_end|>`)
- Process management: SIGTERM → wait 3s → SIGKILL. `stopCurrentGeneration()` kills the Python process.
- Default models: GPT-2, Qwen 2.5 0.5B/1.5B, DialoGPT Medium, TinyLlama 1.1B, DeepSeek R1 1.5B

### GitHubModelsService

- Endpoint: `https://models.inference.ai.azure.com`
- Auth: GitHub PAT token from settings
- Client: OpenAI SDK with custom baseURL
- Models: Azure-hosted inference models (GPT-4o, GPT-4o-mini, etc.)

### File I/O Paths (all under `~/Documents/CSimple/Resources/`)

| Path | Contents |
|------|----------|
| `settings.json` | `{ webapp: { theme, fontSize, agents, ... } }` |
| `Behaviors/*.txt` | Behavior/system prompt files. `default.txt` cannot be deleted. |
| `Personality/identity.md` | Agent identity context |
| `Personality/soul.md` | Core personality traits |
| `Personality/user.md` | User preferences/context |
| `Memory/*` | Memory/context files |
| `Agents/avatars/{agentId}.*` | Agent avatar images |

### Node Dependencies for Addon Server

```json
{
  "cors": "^2.8.5",
  "dotenv": "^16.3.1",
  "express": "^4.18.2",
  "multer": "^2.0.2"
}
```

That's it — 4 production dependencies. Very lightweight.

### Python Dependencies

```
torch>=2.0.0
transformers>=4.20.0
accelerate>=0.20.0
tokenizers>=0.13.0
datasets>=2.0.0
numpy>=1.21.0
requests>=2.25.0
```

Note: `torch` is ~2GB. First-time setup will take a while. Consider showing a progress notification in the Electron tray.
