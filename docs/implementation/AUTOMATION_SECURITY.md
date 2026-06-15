# CSimple Automation — Threat Model & Security Notes

This document captures the security model for the CSimple automation layer
(the local addon's tool registry, permission gate, and cloud-relay bridge).
It is meant as a living reference for any change that touches a tool, the
permission store, the bind host, or the audit pipeline.

Last review: Phase 1 of the [Automation Roadmap](AUTOMATION_ROADMAP.md).

---

## 1. Trust boundaries

```
   ┌────────────────────────────────────────────────────────────────┐
   │                       USER'S WINDOWS BOX                       │
   │                                                                │
   │  ┌────────────────┐    HTTP(S) on 127.0.0.1     ┌────────────┐ │
   │  │  Frontend SPA  │ ──────────────────────────► │  ADDON     │ │
   │  │ (Vite, browser)│                             │ (Electron) │ │
   │  └────────────────┘                             │            │ │
   │           │                                     │  ┌──────┐  │ │
   │           │ HTTPS                               │  │Tools │  │ │
   │           ▼                                     │  └──────┘  │ │
   │  ┌────────────────┐    HTTPS (Render)           └─────┬──────┘ │
   │  │ portfolio-backend │◄────── relay/audit ───────────┘        │
   │  │  (Express, DDB) │                                          │
   │  └────────────────┘                                           │
   └────────────────────────────────────────────────────────────────┘
```

| Boundary | Direction | Crossing rule |
|---|---|---|
| Frontend ↔ Addon | both | `fetch('http://127.0.0.1:3001/...')` — local-only by default. CORS allowlists `localhost`/`127.0.0.1`. |
| Frontend ↔ Backend | both | JWT bearer auth, HTTPS only in prod. |
| Addon ↔ Backend | both | JWT forwarded from the frontend via `/api/cloud/auth`; addon stores it **in memory only**. |
| Addon ↔ OS | tools | Mediated by the permission gate — every shell/fs/UI call must pass `requestApproval()` first. |
| LAN device ↔ Addon | optional | Disabled by default; user must flip `hostBinding` to `lan` in the Permission Center and accept the warning. |

### Where the LLM lives
LLM prompts are sent from the **backend** to OpenAI/Anthropic, never from the
addon directly. The addon's automation layer talks to its own loop (`agent-loop.js`)
which in turn calls back into the backend's `llmService` over HTTPS. No third-party
LLM provider ever sees raw `safeStorage`-decrypted secrets — those stay on disk
under DPAPI and in process memory only when actively used.

---

## 2. Local network exposure

| Setting | Default | Risk |
|---|---|---|
| Bind host | `127.0.0.1` (loopback) | Only same-machine processes can reach the addon. |
| LAN mode | `0.0.0.0` opt-in | Any device on the same Wi-Fi can hit `/api/automation/execute`. **No** authentication is currently enforced on local endpoints, so LAN mode effectively trusts every device on the network. |
| Env override | `CSIMPLE_BIND_HOST` | Lets advanced users pin a specific interface. |

**Mitigations in place:**
- Default binding is loopback (changed from `0.0.0.0` in Phase 1).
- LAN mode logs a console warning on startup.
- Permission Center surfaces the binding setting with a confirmation prompt
  before switching to LAN.

**Open risks / TODO (Phase 4):**
- Add a per-addon shared-secret header check (e.g. `X-CSimple-Token`) so even
  loopback callers must prove they are the paired frontend.
- Pin a self-signed cert with TOFU for the HTTPS port and require it on LAN.
- Auto-revert to loopback after N idle minutes if no LAN client connects.

---

## 3. Secret storage

| Secret | Lives where | Protection |
|---|---|---|
| User JWT (cloud relay) | Process memory only | Cleared on app exit; re-injected each session via `/api/cloud/auth`. |
| Backend-issued API tokens (OpenAI, etc.) | Backend DynamoDB | AES-256-GCM via `backend/utils/secretCrypto.js`, prefix `enc:v1:`. |
| `githubToken` (local settings) | Addon `userData/settings.json` | Wrapped via Electron `safeStorage` (Windows DPAPI), prefix `dpapi:v1:`. |
| Permission config | Addon `userData/automation-permissions.json` | Plaintext — contains no secrets, only enums/patterns. |
| Audit log (local) | Addon `userData/logs/` | Plaintext JSONL. Treat as sensitive. |
| Audit log (cloud) | Backend workspace `action` kind | JWT-scoped; only readable by the issuing user. |

**Mitigations in place:**
- DPAPI wrapping is symmetric to disk only; in-memory plaintext is unavoidable.
- Decrypt failures return empty string rather than partial garbage (avoids
  sending malformed values to APIs and triggering noisy auth failures).
- Outside of Electron (eval CLI, tests), DPAPI gracefully degrades to plaintext
  with a one-shot stderr warning.

**Open risks:**
- DPAPI ciphertext is bound to the user account on the machine. A backup
  containing both `settings.json` and the user profile would round-trip
  decryptable on the same Windows account — back-up scope policy still TODO.
- No periodic key rotation. `enc:v1:` and `dpapi:v1:` prefixes leave room for
  a future v2.

---

## 4. Tool permission gate

Every tool call passes through `permissions.requestApproval(tool, args, opts)`,
which combines:

1. **Kill switch** — `globalKillSwitch=true` returns `deny` for everything.
2. **Dry-run flag** — `dryRunMode=true` forces every tool to its no-op path.
3. **Per-tool override** — exact `tools[name]` mode (`allow|ask|dry-run|deny`).
4. **Category default** — fall through to `categories[category]`.
5. **User-initiated bypass** — when a request originated from a chat message
   the user typed, `userInitiated=true` upgrades `ask` to `allow` (asking the
   same user to "are you sure you typed that?" is theatre).

**Categories and defaults:**

| Category | Default | Examples |
|---|---|---|
| `safe-read` | `allow` | `fs_read`, `fs_list`, `process_list`, `screen_capture`, `screen_ocr`, `screen_set_of_marks`, `uia_find`, `uia_get_text`, `uia_snapshot`, `perception_recent`, `browser_text`, `browser_screenshot`, `browser_status` |
| `sandboxed-write` | `ask` | `fs_write`, `clipboard_write`, `browser_open`, `browser_goto`, `browser_click`, `browser_fill`, `browser_close` |
| `system` | `ask` | `window_focus`, `uia_invoke`, `input_*` |
| `destructive` | `ask` | `process_kill` |
| `shell` | `ask` | `shell_run` (PowerShell), `browser_eval` (arbitrary JS in page) |

**Browser-specific notes:**
- `browser_eval` is intentionally categorized as `shell` — it executes arbitrary
  JavaScript in the page context, which can read DOM, cookies, and storage.
- Browser sessions persist cookies/localStorage to
  `<userData>/playwright-profiles/<profile>/`. Treat that directory like any
  other site-credential store; back-up policy applies.
- The browser launches without `--no-sandbox`, with `acceptDownloads=false`
  and `ignoreHTTPSErrors=false` — same defaults as a paranoid Edge user.
- We use `playwright-core` only and bind to the user's existing Edge/Chrome
  binary, so the addon does NOT ship a bundled Chromium with its own update
  cycle (one less attack surface to keep patched).

**Recorder & skills notes:**
- The demonstration recorder is exposed ONLY via `/api/recorder/*` HTTP routes,
  never as an LLM-callable tool. Recording must always be the user's deliberate
  choice (tray menu or renderer UI) — the agent cannot start a recording on
  its own.
- Recordings (`<userData>/recordings/*.jsonl`) capture mouse coordinates,
  button events, and foreground-window titles. They DO NOT capture keystrokes
  or clipboard contents in v1. If/when a native keyboard hook is added, the
  recorder MUST gain an explicit per-recording "capture keystrokes" toggle —
  defaulting OFF — and a redaction pass that strips known password fields
  (UIA `IsPasswordControl=true`).
- Compiled skills (`kind=skill` workspace items) are user content stored
  alongside other workspace data. They obey the same per-user JWT scoping —
  no cross-user skill visibility.
- `skill_run` is categorized as `system` — same as `uia_invoke` and the input
  tools it dispatches under the hood. Each underlying tool still goes through
  the permission gate, so a skill that tries to invoke `shell_run` will still
  prompt for approval at run time even though `skill_run` itself was allowed.
- `click_at` (raw screen coordinates) is categorized as `system` and exists
  primarily for skill replay. Prefer `uia_invoke` (semantic) over `click_at`
  (positional) whenever possible — `click_at` will silently land on the wrong
  control if the UI layout shifts.

**Shell-specific hardening:**
- `shellAllowPatterns` — regexes that, if matched, auto-approve `shell_run`
  even when category is `ask`.
- `shellDenyPatterns` — regexes that always block (e.g. `Remove-Item.*-Recurse`,
  `Format-`, `shutdown`).
- Working directory is forced inside `fsRoots` (default = `$HOME`).

**Filesystem sandbox:**
- `fsRoots` is the allow-list of absolute path roots for `fs_read|write|list`.
- Empty list ⇒ user's home directory only.
- Symlink/junction traversal still needs verification (TODO Phase 4).

---

## 5. Approval pathway

```
User types in chat ──► backend ──► agent-loop ──► registry.executeTool
                                                            │
                                                            ▼
                                            permissions.requestApproval
                                                            │
                          ┌─────────────────────────────────┴───────────────┐
                          │                                                 │
                  category=allow                                  category=ask
                          │                                                 │
                          ▼                                                 ▼
                   run immediately                       Renderer (permissions.html)
                                                          shows queue, user picks
                                                          approve/deny → resolves
                                                          waiting Promise.
```

- Pending requests timeout to `deny` after 60 s (`defaultApprovalRequester`).
- All approvals (approved or denied) are written to the local audit log AND
  appended to the user's cloud workspace `action` log (best-effort, async).

---

## 6. Audit logging

| Surface | What's logged | Where | Retention |
|---|---|---|---|
| Local rolling log | Per-tool call with args, mode, durationMs, ok, error, approvedBy | Addon `userData/logs/automation-YYYYMMDD.log` | User-managed. |
| Cloud audit | Same payload minus large blobs | `csimple_ws_{userId}_action_{YYYYMMDD}` JSONL in DynamoDB | Workspace TTL. |
| Telemetry summary | Aggregate `count/ok/fail/p50/p95/maxLatency/recentErrors` per tool, last N days (≤30) | `GET /api/data/csimple/workspace/telemetry/summary` | Computed on demand. |

**Mitigations in place:**
- `args` are JSON-stringified and truncated to 2000 chars before logging
  (prevents accidental secret leakage in long stdout/stderr blobs).
- `recentErrors[]` in telemetry truncates each entry to 200 chars.
- Cloud audit is rate-limited (`workspaceActionLimiter`: 180/min/user).

**Open risks:**
- Tool args may contain user-typed secrets (e.g. a paste of a token). Need a
  redaction filter pass before logging (TODO Phase 4).
- No log signing — a compromised addon process could rewrite local history.
  Cloud audit acts as a tamper-evident counterpart.

---

## 7. Cloud relay

The cloud relay (`cloudRelayService` in the addon) is a thin HTTPS client to
the portfolio backend. It is the **only** outbound network surface other than
direct LLM calls made from the backend itself.

- JWT is acquired by the frontend (Auth: backend) and pushed to the addon via
  `POST http://127.0.0.1:3001/api/cloud/auth`.
- Stored in `cloudRelay._token` — never persisted.
- Used for: workspace read/write, telemetry append, future MCP fan-out.
- Rate-limited at the backend per Phase 1 limiters
  (read 120/min, write 60/min, action 180/min).

---

## 8. Eval harness security

The eval harness (`server/automation/eval/`) executes real tool calls with
`userInitiated: true` (bypasses approvals) AND suppresses cloud audit. This is
intentional for regression testing but means:

- **Never** run untrusted scenarios — they can shell out as the current user.
- Scenarios live in version control and should be reviewed like code.
- Set `--dry` to force `dryRunMode` and execute no-op paths only.

---

## 9. Known gaps / Phase 4 hardening backlog

In rough priority order:

1. **Local auth header** — require `X-CSimple-Token` from the paired frontend.
2. **Args redaction** — strip patterns matching common secret shapes before
   logging or appending to telemetry.
3. **Symlink/junction containment** — resolve real paths in `fs_*` and reject
   traversal that escapes `fsRoots`.
4. **Shell timeout & resource cap** — hard ceiling on CPU/memory + max stdout.
5. **HTTPS cert TOFU** — pin the local cert when binding to LAN, reject MITM.
6. **Permission audit trail** — separate file for permission *changes* (who
   added a deny pattern, when) signed by the user JWT.
7. **Tamper-evident logs** — periodic hash-chain checkpoint pushed to cloud.

---

## 10. References

- [`csimple-addon/server/automation/permissions.js`](../../csimple-addon/server/automation/permissions.js) — central gate
- [`csimple-addon/server/automation/tool-registry.js`](../../csimple-addon/server/automation/tool-registry.js) — dispatch + audit hook
- [`csimple-addon/server/automation/eval/`](../../csimple-addon/server/automation/eval/) — regression scenarios
- [`backend/utils/secretCrypto.js`](../../backend/utils/secretCrypto.js) — backend secret format
- [`csimple-addon/server/secret-storage.js`](../../csimple-addon/server/secret-storage.js) — DPAPI wrapper
- [`backend/middleware/rateLimiter.js`](../../backend/middleware/rateLimiter.js) — workspace limiters
- [`docs/implementation/AUTOMATION_ROADMAP.md`](AUTOMATION_ROADMAP.md) — phased plan
