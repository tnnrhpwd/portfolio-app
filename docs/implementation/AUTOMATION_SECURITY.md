# Simple Automation — Threat Model & Security Notes

This document captures the security model for the Simple automation layer
(the local addon's tool registry, permission gate, and cloud-relay bridge).
It is meant as a living reference for any change that touches a tool, the
permission store, the bind host, or the audit pipeline.

Last review: 2026-09-10 security review — fixed symlink escape, `cmd /c`
injection, path-boundary checks, avatar upload traversal, shell deny-list
hardening, the preview stored-XSS bridge, and marketplace-skill nested-tool
approval; documented the cloud-relay remote-control chain and the marketplace
malicious-skill surface below.

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
   │  ┌───────────────────┐    HTTPS (Render)        └─────┬──────┘ │
   │  │ portfolio-backend │◄────── relay/audit ────────────┘        │
   │  │  (Express, DDB)   │                                         │
   │  └───────────────────┘                                         │
   └────────────────────────────────────────────────────────────────┘
```

| Boundary | Direction | Crossing rule |
|---|---|---|
| Frontend ↔ Addon | both | `fetch('http://127.0.0.1:3001/...')` — local-only by default. CORS allowlists `localhost`/`127.0.0.1`. |
| Frontend ↔ Backend | both | JWT bearer auth, HTTPS only in prod. |
| Addon ↔ Backend | both | JWT forwarded from the frontend via `/api/cloud/auth`; kept in memory AND persisted DPAPI-encrypted to `settings.json` (`data.cloudAuth.token`), restored on launch. |
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
| Env override | `SIMPLE_BIND_HOST` | Lets advanced users pin a specific interface. |

**Mitigations in place:**
- Default binding is loopback (changed from `0.0.0.0` in Phase 1).
- LAN mode logs a console warning on startup.
- Permission Center surfaces the binding setting with a confirmation prompt
  before switching to LAN.

**Open risks / TODO (Phase 4):**
- Add a per-addon shared-secret header check (e.g. `X-Simple-Token`) so even
  loopback callers must prove they are the paired frontend.
- Pin a self-signed cert with TOFU for the HTTPS port and require it on LAN.
- Auto-revert to loopback after N idle minutes if no LAN client connects.

---

## 3. Secret storage

| Secret | Lives where | Protection |
|---|---|---|
| User JWT (cloud relay) | Process memory + `settings.json` (`data.cloudAuth.token`) | DPAPI-wrapped (`dpapi:v1:`) at rest; restored on launch; cleared on 401. **Treat as the master key for the PC** (§7). |
| Backend-issued API tokens (OpenAI, etc.) | Backend DynamoDB | AES-256-GCM via `backend/utils/secretCrypto.js`, prefix `enc:v1:`. |
| `githubToken` (local settings) | n/a — retired | GitHub Models support removed; `SENSITIVE_WEBAPP_KEYS` is now empty. Generic DPAPI helpers remain for future secrets. |
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
  tools it dispatches under the hood. For skills the user recorded themselves,
  nested steps inherit `userInitiated` and fast-track `ask` → `allow`. For
  **marketplace** skills (third-party, unmoderated), nested steps do NOT
  inherit `userInitiated` (FIXED 2026-09-10), so `shell_run`/`fs_write`/
  destructive/`browser_eval` steps still prompt per step.
- `click_at` (raw screen coordinates) is categorized as `system` and exists
  primarily for skill replay. Prefer `uia_invoke` (semantic) over `click_at`
  (positional) whenever possible — `click_at` will silently land on the wrong
  control if the UI layout shifts.

**Marketplace skills — malicious-skill risk (investigated 2026-09-10):**
- The marketplace has **no manual moderation queue**. Any authenticated user
  can publish any skill (`POST /api/data/market/skills`); ranking/flags
  deprioritize but never block (`backend/controllers/marketplaceController.js`).
- Server-side `marketplaceScrub.js` only redacts PII/secrets (paths, tokens,
  screenshots) — it does **not** validate that steps are safe.
  `marketplaceCapabilities.js` only *discloses* declared-vs-actual category
  mismatches; it does not block publishing.
- The real safety floor is therefore execution-time and addon-side:
  1. `marketplace-gate.js` — a capability summary must be confirmed once per
     version before the first real run.
  2. Low-trust skills (few installs / young) get a mandatory dry-run-first pass.
  3. **FIXED 2026-09-10**: marketplace skills no longer inherit
     `userInitiated` for nested steps, so `shell_run` / `fs_write` /
     destructive / `browser_eval` steps prompt for approval at run time.
- Residual: `safe-read` tools (e.g. `fs_read`) run without prompting, so a
  malicious skill can still *read* files; exfiltration requires an approved
  outbound step (shell/browser). The capability summary is the user's chance
  to catch this — treat it as a real security prompt, not boilerplate.
- Backend `/market` endpoints (investigated 2026-09-10): all JWT-`protect` +
  per-user rate limits + `sanitizeInput` (strips all HTML). No IDOR (publish
  author-check; install/rate/flag keyed by `req.user.id`). **FIXED**: flag-spam
  — flags are deduped (one per user per skill) so one user can't tank a
  competitor's trust score. OPEN: the "must run before rating" gate is
  effectively disabled (`canRate` is called with `attemptedRun:true`), and
  search does a full-table DynamoDB scan (DoS surface).

**Shell-specific hardening:**
- `shellAllowPatterns` — regexes that, if matched, auto-approve `shell_run`
  even when category is `ask`.
- `shellDenyPatterns` — regexes that always block. **FIXED 2026-09-10**: now
  also blocks `Invoke-Expression`/`iex`, `Net.WebClient`, `DownloadString`/
  `DownloadFile`, `[Convert]::FromBase64String`, `-enc` encoded commands,
  `Set-MpPreference -Disable`, `netsh advfirewall`, `Stop-Service WinDefend/
  MpSvc/…`, `reg add hklm`, `bcdedit`, `diskpart`. `load()` unions the built-in
  list with saved config so an old permissions file cannot silently drop it.
- Working directory is forced inside `fsRoots` (default = `$HOME`).

**Filesystem sandbox:**
- `fsRoots` is the allow-list of absolute path roots for `fs_read|write|list`.
- Empty list ⇒ user's home directory only.
- Symlink/junction traversal **FIXED 2026-09-10**: `resolveInsideSandbox`
  resolves the full real path (existing targets) or the nearest existing
  ancestor (writes) before containment, so a symlink inside the sandbox cannot
  redirect reads/writes/deletes outside `fsRoots`.

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
- Kept in `cloudRelay._token` in memory AND persisted DPAPI-encrypted to
  `settings.json` (`data.cloudAuth.token`) so the relay re-authenticates on
  launch without re-opening the web app. Cleared on a 401.
- Used for: workspace read/write, telemetry append, future MCP fan-out.
- Rate-limited at the backend per Phase 1 limiters
  (read 120/min, write 60/min, action 180/min).

### 7.1 Remote command execution (validated 2026-09-10)

The relay is a **designed phone → backend → desktop RCE channel**. Validated
chain: `POST /api/data/addon/command` (backend — JWT `protect`, scoped to
`req.user.id`, no IDOR) → addon `cloud-relay.js` polls `/addon/pending` →
executes `chat` / `agent_run` / `confirm`, each of which can drive tools /
PowerShell. The addon performs no independent validation of the command, so
the backend and the JWT are the entire boundary. **Whoever holds the user's
JWT can run commands on the PC.**

### 7.2 Approval-model caveat (OPEN)

`/api/chat` executes LLM-selected automation tools with `userInitiated: true`
("the user typed it"), which upgrades `ask` to `allow`. Remote `chat` commands
arrive through the same endpoint, so remote chat executes tools — including
`shell_run` — **without a local approval prompt**. The permission gate is not
applied to remote-originated chat. Recommend marking relay-originated chat as
non-user-initiated, or gating remote control behind an explicit consent.

---

## 8. Eval harness security

The eval harness (`server/automation/eval/`) executes real tool calls with
`userInitiated: true` (bypasses approvals) AND suppresses cloud audit. This is
intentional for regression testing but means:

- **Never** run untrusted scenarios — they can shell out as the current user.
- Scenarios live in version control and should be reviewed like code.
- Set `--dry` to force `dryRunMode` and execute no-op paths only.

---

## 9. Known gaps / hardening backlog

**FIXED in the 2026-09-10 review** (previously on this list or found during it):
- Symlink/junction containment in `fs_*` (§4).
- Shell deny-list expansion (§4).
- `cmd /c` injection for `.bat`/`.cmd` script args/filenames
  (`action-service.executeScript`).
- `safePath` / `_safePath` boundary-aware containment (`index.js`,
  `action-service.js`).
- Avatar upload path traversal (`/api/agents/:agentId/avatar`).
- Stored-XSS bridge via `/api/workspace/preview/:filename` — now served with
  `Content-Security-Policy: default-src 'none'; sandbox` + `X-Content-Type-Options: nosniff`.
- Marketplace-skill nested-tool approval — marketplace skills no longer inherit
  `userInitiated`, so their risky nested steps prompt (see §4).
- Marketplace flag-spam — flags deduped per user per skill
  (`marketplaceController.js`).

**Still open**, in rough priority order:

1. **Local auth header** — require `X-Simple-Token` (per-install secret) from
   the paired frontend so even loopback callers must authenticate. Also closes
   the residual `Origin: null` / missing-Origin gap for simple requests.
2. **Remote vs local chat approval** — don't treat cloud-relay `chat` commands
   as `userInitiated` (§7.2), or gate remote control behind an explicit
   consent toggle.
3. **Args redaction** — strip secret-shaped values before logging/telemetry.
4. **Auto-updater supply chain** — `autoDownload` + `autoInstallOnAppQuit` from
   GitHub releases with no code-sign verification; a compromised GitHub account
   = RCE on next quit. Sign Windows builds and enable signature checks.
5. **Shell timeout & resource cap** — hard ceiling on CPU/memory + max stdout.
6. **HTTPS cert TOFU** — pin the local cert when binding to LAN, reject MITM.
7. **Permission audit trail** — separate file for permission *changes* (who
   added a deny pattern, when) signed by the user JWT.
8. **Tamper-evident logs** — periodic hash-chain checkpoint pushed to cloud.
9. **`screen-relay.js` token/URL source** — it reads legacy top-level
   `settings.json` `token`/`jwt`/`backendBaseUrl` instead of the shared
   `workspace-client.getToken()` + `BACKEND_URL`; unify so a stray
   `backendBaseUrl` field can't redirect uploads (potential SSRF/credential
   leak). `/api/open-file` accepts arbitrary paths (Explorer select only —
   low risk, not code execution).
10. **Marketplace moderation** — publish is unmoderated and category
    declarations are disclosure-only. Consider blocking (or flagging) publishes
    whose steps include `shell_run`/`browser_eval`, and show a stronger warning
    when `safe-read` steps would read files off-device. Residual
    social-engineering risk remains (the capability summary is the last gate).
11. **Marketplace rating/ranking integrity** — enforce the run-before-rate gate
    (currently `attemptedRun` is hardcoded `true` in `rateMarketSkill`) and
    avoid the full-table scan on `/market/skills` search (index it or cache).

---

## 10. Backend web-app findings (portfolio, 2026-09-10)

Beyond the automation layer: auth, data CRUD, admin, payments, guest login,
password reset, and LLM proxy routes were reviewed.

**Solid (validated):**
- JWT: HS256, 7-day expiry, `alg` allowlist + `maxAge` in `protect`; secret from
  env / AWS Secrets Manager (no hardcoded fallback).
- Data CRUD is user-scoped (`Creator:<id>` / `id` ownership checks in
  get/put/delete). Admin routes behind `requireAdmin` (`ADMIN_USER_ID` compare).
- Workspace + csimple sync + per-user resources (pets/memory/music) are
  user-scoped: every DynamoDB key embeds `req.user.id` (e.g.
  `csimple_ws_${userId}_${kind}_${slug}`, `${MUSIC_PREFIX}${userId}_${songId}`),
  and `memoryService.requireOwnership` re-checks the creator. No cross-user IDOR.
- S3 uploads: per-user key prefix, extension/type allowlist, presigned PUT.
- Stripe webhook verifies the signature (`constructWebhookEvent`).
- LLM proxy routes (`agent-chat`, `agent-vision`, `compile-natural`,
  `edit-natural`, `goal-agent/start`, `uimapper/automap`) are `protect` +
  `llmLimiter` (cost-abuse limited).
- Global `apiLimiter` + CSRF header check; helmet + strict CORS in production.

**Fixed (2026-09-10):**
- Stripe payment IDOR — `updateCustomer`, `putPaymentMethod`, `deleteCustomer`,
  `deletePaymentMethod` accepted arbitrary Stripe customer/payment-method IDs
  with no ownership check. Now verified against the caller's own `|stripeid:`
  (and the payment method's `customer`). Also restored the missing Stripe client
  in `deleteHashData.js` (those two endpoints were silently broken/500).
- **Goal Agent repo tools are now admin-only** — `write_repo_file` (and the
  read-only `list_repo_tree`/`read_repo_file`) previously ran for ANY
  authenticated user, committing LLM-generated code directly to the production
  default branch via the server's `GITHUB_TOKEN`. Any user (or a stolen user
  JWT) could have deployed arbitrary code to the live site. Now gated by
  `ctx.user.id === ADMIN_USER_ID` (`goalAgentService.js`).

**Remaining (documented, not fixed — product decisions):**
- Guest demo account (`guest@gmail.com` / `guest`) is permanently shared with a
  known password; the login flow self-resets it to `guest` on any attempt.
  Anyone can authenticate as guest and burn shared LLM credits / workspace data.
- Reset tokens + bcrypt hashes live in a pipe-delimited `text` blob that is
  scanned/served in full by several endpoints. Tokens are random 256-bit with a
  1-hour expiry (OK), but the shared-text design is fragile.
- Many endpoints full-table-scan the `Simple` table (DoS/performance surface).
- `getIPLocationInfo` reads `x-forwarded-for` manually (informational only).
- Email flows: SES sends are structured JSON (no header injection); email prefs
  re-fetch the raw record and only mutate boolean toggles. Admin endpoints are
  double-gated (`requireAdmin` route + `isAdmin` controller). Two notes:
  - `getAdminPaginatedData` returns raw `text` including bcrypt password hashes
    (admin-only raw-data browser — consider redacting the hash even for admin).
  - `enlistAgentForBug` (admin) embeds attacker-controlled bug-report text
    (Description/Steps/Expected/Actual) into an autonomous coding agent that
    commits to the default branch — a prompt-injection → code-commit vector if
    an admin enlists the agent on a maliciously crafted report. Sanitize/draft-
    branch before enlisting.
  - `testEmailSend` (admin) accepts an arbitrary recipient and surfaces the raw
    SES error stack (spam/info-leak if an admin token is compromised — low).
- Public/unauthenticated routes: auth (register/login/forgot/reset) is behind
  `authLimiter` (500/15min/IP) with strict `express-validator` rules (password
  must contain lower+upper+digit, 8-128). `/hype/quote` is a public Bedrock
  call, IP-limited to 30/15min (bounded cost abuse, intentional marketing page).
  `/analytics/pageview` is a public DynamoDB write with no feature limiter (only
  the global `apiLimiter`); **FIXED 2026-09-10** a 500-char cap on the stored
  path to stop storage bloat. Polls are public but IP rate-limited.
- Frontend: the JWT is held in `localStorage` (`dataService.js`), so any XSS in
  the SPA = full account + cloud-relay PC control. The SPA avoids
  `dangerouslySetInnerHTML`/raw `innerHTML` in the audited paths, but this is the
  single highest-leverage frontend risk — consider an httpOnly cookie for the
  JWT. Error responses: `errorHandler` masks 5xx in prod, but many controllers
  return raw `err.message` (DynamoDB/Stripe detail) directly — info disclosure,
  low severity.

## 11. References

- [`simple-addon/server/automation/permissions.js`](../../simple-addon/server/automation/permissions.js) — central gate
- [`simple-addon/server/automation/tool-registry.js`](../../simple-addon/server/automation/tool-registry.js) — dispatch + audit hook
- [`simple-addon/server/automation/eval/`](../../simple-addon/server/automation/eval/) — regression scenarios
- [`backend/utils/secretCrypto.js`](../../backend/utils/secretCrypto.js) — backend secret format
- [`simple-addon/server/secret-storage.js`](../../simple-addon/server/secret-storage.js) — DPAPI wrapper
- [`backend/middleware/rateLimiter.js`](../../backend/middleware/rateLimiter.js) — workspace limiters
- [`docs/implementation/simple-agent-prompt.md`](simple-agent-prompt.md) — roadmap & backlog (§10)
