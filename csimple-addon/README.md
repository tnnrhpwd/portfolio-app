# CSimple Addon

System tray application that runs the CSimple AI server locally. When the portfolio frontend at `sthopwood.com/net` detects this addon running, it unlocks local AI features (HuggingFace models, GitHub Models, PC action execution).

## Architecture

```
Electron Main Process (main.js)
  ├── System Tray (tray.js) — icon + status menu
  ├── Python Manager (python-manager.js) — venv + pip setup
  └── Express Server (server/index.js) — API on port 3001
       ├── LLM Service — spawns Python for HuggingFace inference
       ├── GitHub Models Service — OpenAI-compatible cloud API
       └── Action Service — NL→action plan parser + queue
```

## Prerequisites

- **Node.js** 18+
- **Python** 3.8+ (for local HuggingFace models)
- **Git** (Git for Windows includes OpenSSL, needed for HTTPS certs)

## Development

```bash
cd csimple-addon
npm install
npm run dev
```

## Building

```bash
npm run build:win    # NSIS installer
npm run build:portable  # Portable .exe
```

Output goes to `dist/`.

## How It Works

1. On launch, the addon starts an Express server on port 3001 (HTTP) and 3444 (HTTPS)
2. It creates a system tray icon with status information
3. Python 3 is detected and a virtual environment is auto-created at `%LOCALAPPDATA%/CSimple/venv`
4. Python dependencies (PyTorch, Transformers, etc.) are installed on first run
5. The portfolio frontend at `sthopwood.com/net` polls `localhost:3001/api/status` to detect the addon
6. When connected, users can chat with local AI models or use GitHub Models API

## API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/status` | Health check |
| GET | `/api/models` | List available models |
| POST | `/api/chat` | Send chat message |
| POST | `/api/chat/stream` | SSE streaming chat |
| POST | `/api/chat/stop` | Stop generation |
| POST | `/api/chat/confirm` | Confirm/cancel action |
| GET/PUT | `/api/settings` | Read/write settings |
| GET/POST/PUT/DELETE | `/api/behaviors/*` | Behavior files CRUD |
| GET/POST/PUT/DELETE | `/api/memory/*` | Memory files CRUD |
| GET/PUT | `/api/personality/*` | Personality files |
| POST/GET | `/api/agents/*/avatar` | Agent avatars |
| GET | `/api/actions/pending` | Poll pending actions |
| POST | `/api/actions/complete` | Mark action done |
| GET | `/api/actions/bridge-status` | Check bridge connection |
| GET | `/api/network` | Local network info |

## File Locations

| Data | Path |
|------|------|
| Settings | `~/Documents/CSimple/Resources/settings.json` |
| Behaviors | `~/Documents/CSimple/Resources/Behaviors/*.txt` |
| Personality | `~/Documents/CSimple/Resources/Personality/*.md` |
| Memory | `~/Documents/CSimple/Resources/Memory/*` |
| Avatars | `~/Documents/CSimple/Resources/Agents/avatars/*` |
| Venv | `%LOCALAPPDATA%/CSimple/venv/` |
| SSL Certs | `%LOCALAPPDATA%/CSimple/certs/` |
| HF Models | `~/.cache/huggingface/hub/` |
