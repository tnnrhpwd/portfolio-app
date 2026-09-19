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

### 7.1.1 One tool call per command — `tool` kind (added 2026-09-18)

The cloud harness (`/net`) dispatches single tool calls over this same queue via
`dispatchToolToAddon()` (`backend/controllers/addonRelayController.js`), which
picks the freshest **online** device from the existing registry and waits for the
result. Notes that matter for this section's threat model:

- **It adds no authority.** `agent_run` was already on this channel and reaches
  *every* registered tool with the addon's own approval path bypassed (see 7.2).
  One named tool is strictly narrower than "run this goal".
- **The addon's permission gate is not bypassed by the new path.** The `tool`
  branch calls an injected handler that `mountAutomation` wires to
  `registry.executeTool` — the same call a local agent step makes, so category
  modes, per-tool overrides, dry-run, the shell allow/deny list and the
  **kill switch** all apply. A refusal returns as the command's `error`, which the
  cloud loop feeds back to the model as that tool's result.
- **Timing is a security property here.** A timeout is reported as *"the PC did
  not answer"* and the dispatch is **never retried** — the command may already be
  running, and retrying a PC action is how the same keystrokes happen twice.
- The existing 7.2 caveat still applies to `chat`/`agent_run`, which remain the
  broader path. Nothing here closes it.

### 7.1.2 The cloud harness's PC tools — `pc_status` / `pc_do` (added 2026-09-18)

Two tools in `backend/services/pcTools.js` expose this channel to the `/net` tool
loop. What they do to the threat model:

- **They add no reach.** `pc_do` dispatches a single named tool over the relay
  command added in 7.1.1; `agent_run` was already on this channel and reaches
  every tool. The difference is granularity, not authority.
- **They do not bypass the gate.** The addon's `tool` branch runs the call
  through `registry.executeTool`, so `permissions.js` applies exactly as it does to
  a local step: category modes (defaults are `safe-read: allow`, everything else
  `ask`), per-tool overrides, `dryRunMode`, the shell allow/deny list, audit
  logging, and `globalKillSwitch`. The cloud can only ask.
- **The addon now PUBLISHES more about itself.** Its heartbeat carries the tool
  catalog (name + category, ≤60 entries) and the permission policy (category
  modes + the three flags). This is the user's own machine reporting to the
  user's own backend over TLS, and it is what stops the model guessing tool names
  or promising an action the machine is about to refuse. The backend treats it as
  **untrusted input**: fields are type-checked, clamped and allow-listed
  (`sanitizeCatalog`) before being stored on a heartbeat row and rendered into a
  prompt.
- **Two failure modes are worded differently to the model** — a refusal is "do not
  retry, ask the user", a timeout is "may still be waiting, do NOT repeat it". A
  timeout is never retried by the dispatch itself, because the command may already
  be running. Both results now carry a failure PREFIX (`Denied:` / `Error:`),
  because every consumer decides "did this work?" by prefix — the classifier
  (`harness/toolOutcome.js`), the journal's step status, and the client's `tools`
  event. While these two were unprefixed prose, a refusal on the PC was rendered
  as a ✓ and reported to the model as a success. Read this as a general rule for
  anything new on this surface: **a failure must announce itself.**
- **✅ A refusal now says WHY, and the cloud stopped guessing (2026-09-18).** The
  gate has six refusal branches, and the cloud classified them with
  `/denied|not approved|permission policy/i` over the reason text. Two matched
  nothing and were therefore reported as faults:
  - **the emergency kill switch** — a deliberate hard stop arrived as `Error:`;
  - **an expired prompt** — "no answer within 110s" fell through the failure
    taxonomy to **`FATAL`**, i.e. the model was literally told
    `HARNESS: FAILED — this is not retryable … do not repeat it`. A user who was
    away from their desk for two minutes got a step the model had been instructed
    to abandon, on a refusal that was merely unanswered.

  The gate now returns a `cause` (`kill-switch`, `policy-deny`, `user-declined`,
  `expired`, `no-requester`, `prompt-failed`), it travels to the cloud in an
  anchored token (`DENIED[<cause>]: …`, `simple-addon/server/automation/refusal-wire.js`
  → `backend/services/pcTools.js`), and the cloud maps it to a prefix and a next
  move. The distinction that matters is not cosmetic: **a refusal a PERSON made or
  missed can be re-asked; one a stored SETTING made cannot.** `deny` is documented
  as a hard stop, so offering a retry for one would be a lie — hence a
  `reaskable` flag, deliberately *not* named `retryable` because
  `toolOutcome.js` already uses that word for "the harness may auto-repeat this",
  and the two disagree on the same refusal.

  Two things this also fixed on the way: the deadline's `approved: false` covered
  both a human's "no" and nobody answering, so **an unanswered prompt was reported
  to the user as a decision they made** (it now carries `expired`), and a prompt
  that *threw* resolved the same way, which would have blamed the user for a
  wiring fault. Both are now separate causes. The old regex survives only as a
  fallback for addon builds already in the field.
- **The user can re-ask, and that does not move the gate (2026-09-18).** A refused
  step offers a quiet **Try again** — but only where the refusal was a *person's
  answer or absence* (`step.reaskable`, from `harness/refusalCause.js`; a policy
  denial and the kill switch never get one, because they would refuse identically).

  **The affordance asks; it does not approve.** It sends an ordinary chat turn
  (rationale in `NET_HARNESS_PLAN.md` §P6), the relay dispatches again, and
  `permissions.js` prompts again on the PC — where the user can decline again. No
  new authority appears anywhere: the cloud still cannot say yes, the decision is
  still made by the machine that owns the resource (ADR-4), and the approval
  deadline still bounds the new prompt. What changed is only that the user has a way
  to *ask* for a second attempt.

  One consequence worth stating, because it is where this could have gone wrong: the
  retry message carries an explicit **"I'm asking you to"**. Two instructions
  telling the model not to retry are already in its context (the refusal's own
  `HARNESS: REFUSED … do not retry`, and continuity's `Do not retry a refused step
  on your own`), so a bare "try again" invites the model to refuse on the harness's
  behalf. Continuity now names the exception in the same words.
- **✅ The unanswered-`ask` gap is CLOSED (2026-09-18).** This was the real hole in
  the surface: the cloud dispatch waited ~120 s, but the prompt on the PC had **no
  deadline of its own**, so an `ask` tool the user never answered left the prompt
  open indefinitely. The cloud then timed out reporting *"it may still be
  running"* — an unknown — and minutes later, with nobody in that conversation,
  clicking **Approve** would run the action. A late approval could execute
  something no live turn was waiting for.

  Now `permissions.requestApproval` accepts an `approvalTimeoutMs`, and the relay
  path sets it (`relayApprovalTimeoutMs()`, default **110 s**, `ADDON_APPROVAL_TIMEOUT_MS`).
  Slightly under the cloud's 120 s **on purpose**: the addon must answer first, so
  the harness receives a definite **refusal** — which its taxonomy classifies as
  `permission` ("do not retry it and do not rephrase it") — instead of an unknown
  it can only warn about. Expiry resolves as a refusal with a reason
  (`no answer within 110s — the request expired and nothing was run`), and an
  answer that arrives afterwards changes nothing, because the call it belonged to
  has already returned.

  Two details that are deliberate, both pinned by tests:
  - **The deadline is opt-in.** A LOCAL agent step passes no timeout, so a prompt
    in front of the user still waits for the human on the human's schedule —
    expiring that under them would be a regression, not a safety win.
  - **The timer is not `unref`'d.** An unref'd timer does not hold the event loop
    open, so when the deadline is the only pending work the process can exit
    *before* it fires — the deadline skipped exactly when it matters. (Found by the
    "never answered is refused" test, which hung rather than failing.)

  Still open, and separate: a way for the cloud to **cancel** a dispatched command
  whose turn has ended, rather than only refusing to wait for it. The command TTL
  (5 min) bounds it; the approval deadline is what stops an action running late.

#### Security pass over the exposed PC surface (2026-09-18)

A directed review of this surface, because Layer 3h made `pc_do` reachable from the
cloud on the relay-only path — i.e. the surface widened, so it was re-read.

| Question | Finding |
|---|---|
| Can one user's turn dispatch to another user's device? | **No.** The queue (`addon_queue_${userId}`) and the device registry (`addon_devices_${userId}`) are both keyed by the *caller's* id, and `dispatchToolToAddon({ userId })` resolves the device from that user's own registry. There is no path by which a `deviceId` from a request body reaches another tenant's queue. |
| Is the published catalog safe to render into a prompt? | **Now yes.** Tool names were already `[a-z0-9_]+`-filtered, but `category` was only *length*-bounded — 24 characters is room for an instruction, and it lands in a prompt. `sanitizeCatalog` now charset-filters it (and the policy's category keys), falling back to `unknown`. The addon's real vocabulary is `safe-read`, `sandboxed-write`, `shell`, `destructive`, `system`. |
| Does the cloud path bypass the PC's policy? | **No.** It reaches `registry.executeTool` → `permissions.js`, so the kill switch, per-tool overrides and dry-run all still decide. Notably `globalKillSwitch` wins over everything — including this path. |
| Is `pc_do` admin-gated? | **Deliberately not** (`toolScopes.js` has no entry ⇒ public). The resource is the user's *own* PC, registered under their own id, and the policy that governs it lives on that machine. Admin-gating it would add a second, weaker boundary that could drift from the real one. Stated here so it reads as a decision rather than an omission. |
| Are tool arguments bounded on this path? | Length-bounded per argument (`netTools.enforceArgLimits`) before the dispatch; the queue item itself is a DynamoDB row, so an oversized payload fails the write rather than landing. |

**The rules this surface keeps teaching.** Every consumer decides "did this work?"
by PREFIX. Anything new here must prefix its failures (`Error:` / `Denied:`) or it
will be counted as a success — which is how a PC refusal was rendered as a ✓ until
2026-09-18. And every consumer that needs to *act* on a failure needs its CAUSE,
not its wording: prose is the one thing that changes freely, so a classifier built
on it re-breaks silently each time someone improves a sentence. When a producer
knows why something was refused, it must say so as data — a closed vocabulary, not
a sentence — and a reader must treat an unrecognised value as "unknown", never as
a sensible default. `pc_do` guessed twice from prose and got the kill switch and
the unanswered prompt wrong in the same direction.

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
4. **Auto-updater supply chain** — `autoDownload` from GitHub releases with no
   code-sign verification; a compromised GitHub account = RCE when the user
   installs the update. Install is user-initiated (`autoInstallOnAppQuit` is
   off deliberately — see `auto-updater.js`; installing on quit also ran the
   NSIS installer while Windows was tearing the session down), so the exposure
   is now "downloads silently, runs when the user clicks", not "runs on quit".
   Sign Windows builds and enable signature checks.
5. **Prompt injection via captured content** — the loop's inputs include text it
   did not choose: a webpage, an email, a chat window, a document, and any text
   rendered *inside* a screenshot handed to a multimodal model. Nothing currently
   distinguishes "the user told me to do this" from "the screen told me to do
   this", while the same loop holds `shell_run`, `fs_write` and `input_*`. No
   remote caller is needed for this one — a hostile string on screen is
   sufficient. The reference implementation's answer is a classifier over tool
   returns plus a steer to confirm with the user before acting; the local
   equivalent is at minimum (a) a standing rule in `buildSystemPrompt` that screen
   text is DATA, never instruction, (b) treating a tool call whose justification
   exists only in captured text as requiring approval (`userInitiated` is already
   the seam), and (c) an audit marker on the step, so a driven run can be reviewed
   for it. Distinct from §7.2 (a `chat` command claiming to be user-initiated) and
   from the repo agent's injection → commit vector in §10.
6. **Shell timeout & resource cap** — hard ceiling on CPU/memory + max stdout.
7. **HTTPS cert TOFU** — pin the local cert when binding to LAN, reject MITM.
8. **Permission audit trail** — separate file for permission *changes* (who
   added a deny pattern, when) signed by the user JWT.
9. **Tamper-evident logs** — periodic hash-chain checkpoint pushed to cloud.
10. **`screen-relay.js` token/URL source** — it reads legacy top-level
   `settings.json` `token`/`jwt`/`backendBaseUrl` instead of the shared
   `workspace-client.getToken()` + `BACKEND_URL`; unify so a stray
   `backendBaseUrl` field can't redirect uploads (potential SSRF/credential
   leak). `/api/open-file` accepts arbitrary paths (Explorer select only —
   low risk, not code execution).
11. **Marketplace moderation** — publish is unmoderated and category
    declarations are disclosure-only. Consider blocking (or flagging) publishes
    whose steps include `shell_run`/`browser_eval`, and show a stronger warning
    when `safe-read` steps would read files off-device. Residual
    social-engineering risk remains (the capability summary is the last gate).
12. **Marketplace rating/ranking integrity** — enforce the run-before-rate gate
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

---

## 11. The admin "Special" tag — unlimited credits + four read-only admin views

The tag lets one trusted account help run the site without being handed the write
surfaces: it lifts the AI credit ceiling and opens four admin views read-only. The
boundary is `middleware/adminAccess.js` (`requireAdmin` vs `requireAdminOrSpecial`) and
the client mirrors it via `SPECIAL_ADMIN_PATHS`.

### What it is

- A `Special:true` field on a user's `text` record in DynamoDB.
- Read by `isSpecialUser()` in `backend/utils/apiUsageTracker.js` (regex
  `/(?:^|\|)Special:true/i`).
- When set, the user is treated as paid-equivalent for feature gates:
  - `canMakeApiCall()` and `trackApiUsage()` treat the user like an admin:
    unlimited access, no credit deduction — usage is still logged.
  - `getUserStorageUsage()` (via `storageTracker.js`) applies the Pro storage
    allowance (50 GB) and reports `membership: 'Pro'`, so both display and
    write-capacity enforcement use the Pro limit.
  - `validateModelTierAccess()` (`llmService.js`) skips model-tier gates.

### How to set / clear it

- Toggled from the Admin user-management table (frontend `Admin.jsx` →
  backend `adminController.js`). No direct DB edit is needed.
- It is a **rank-independent override**: a Free user with `Special:true` gets
  Pro-level AI credits and storage while their underlying `Rank` stays Free.
  It does not create a real Stripe subscription and does not grant admin
  page access.

### Why it must be documented

- It is invisible in the product itself — no tier, no pricing mention.
- The `41a31e6` credit-tracking bug was exactly this kind of quiet exception:
  a stale-cache write silently wiped a user's `Special` flag and, more
  seriously, briefly overwrote their password hash with a literal
  `'[redacted]'` string. The credit-write path in `apiUsageTracker.js` now
  rebuilds from the raw (unredacted) record via `getRawUserRecord` /
  `updateUserCredits` specifically to avoid that.

### Intended use

- Support, testing, and partner accounts.
- **Not** a documented tier. Do not reference it in pricing, Terms, or
  marketing copy.

---

### The Special tier as built

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

#### Special accounts get four admin views (2026-09-12)

The `Special` tag (`PUT /admin/users/:id/special`, stored as `|Special:true`) used to
grant one thing: unlimited API credits. It now also grants **read-only access to four
admin views** — Dashboard, Visitor map, Reviews and Page rankings — so a helper can
watch the funnel without being handed the write surfaces.

- **The boundary is `backend/middleware/adminAccess.js`** (`requireAdmin` vs
  `requireAdminOrSpecial`), and only three routes take the `OrSpecial` variant:
  `GET /all/admin` (the map + reviews payload), `GET /admin/dashboard` and
  `GET /analytics/page-rankings`. The users list, the purchase gate, the data explorer,
  the home-title editor, the email tests, `POST /admin/agent-fix` and Deep Storage stay
  admin-only. The per-handler checks in `adminController.getAdminDashboard`,
  `pageViewsController.getPageRankings` and `getHashData.getAllData` were widened to match
  — flipping only the route middleware would have 403'd inside the controller.
- **The client mirrors it** (`frontend/src/constants/admin.js`): `SPECIAL_ADMIN_PATHS`
  drives the tab row, the toolbar `<h1>` and a guard that bounces a Special account off
  any other `/admin/*` view instead of showing panels that would 403. `isSpecial` is
  attached to the login/register responses; there is no client-side fallback, so an
  account flagged *after* signing in must sign in again.
- ✅ **`GET /all/admin` was shipping every user's password hash.** It returns `item.text`
  verbatim, and a user row carries `|Password:<bcrypt hash>` inline. No client reads it;
  it is now `redactPassword()`-ed. Non-negotiable before widening access to the endpoint to
  anyone but the owner.
- ⚠️ **A Special account can still see what those four views show**: visitor IPs, cities,
  reviewer emails, signup emails and MRR. That is inherent to the views the owner asked
  for, but it is a lot for what is nominally a credits perk — worth a second look if the
  tag is ever granted more widely.
- ✅ **The purchase gate moved to `/admin/funnel-tester`.** It sat at the top of the
  Dashboard, which is exactly the view a Special account *can* open, so it either had to
  paint a 403 or be conditionally rendered. Moving it is the honest fix: it now lives on
  an admin-only view with the rest of the money plumbing, and the toolbar readout carries
  `Purchasing ON/PAUSED` there instead.
- ✅ **`Hide my visits` → `Hide admin visits` + `Hide special visits`** on `/admin/map`.
  The old toggle compared against *whoever was signed in*; the two new ones filter the
  `ADMIN_USER_ID` account and the set of `|Special:true` accounts, independently. The
  nickname/Special directory is now built from the `getAllData` payload the page already
  loads, which also fixed a silent cap: the previous lookup asked `/admin/users` for
  `limit: 200`, so any account past the first 200 had no nickname.
- ✅ **Top countries (and the map's Location column) spell the country out.** ipinfo
  returns `country: "CA"`, which is fine in a dump and useless in a report —
  `frontend/src/utils/countryName.js` maps it via `Intl.DisplayNames`, passes anything
  that isn't a bare two-letter code through untouched, and never invents a value.
- ✅ **The sales funnel showed three identical rectangles.** Each bar's label sat *inside*
  it with `min-width: 108px`, so a 0.3% step was padded to the same width as the 100%
  step. It is now a `label | track | count` grid: the widths are true proportions (1.5%
  floor so a small step is still a visible sliver), the conversion captions sit under the
  bar they convert from, and the overall rate moved into the panel head.
- ✅ **Two `VisitorMap` bugs found while polishing it**: the dark tile `invert()`
  filter ran in light mode too (navy map on a light page — now scoped to `.dark-theme`),
  and the popups/tooltips used `--bg-2`, a token that does not exist in `index.css`, so
  they rendered with no background at all (now `--bg-1` + a real shadow).


#### Making the Special tier actually reachable (2026-09-12)

Trying to *use* *Special accounts get four admin views* turned up three things, two of them real bugs and one of them the
reason it looked broken in the browser.

- ⚠️ **The dev backend was serving pre-change code.** The live `/login` response came back
  without `isSpecial` even though `postData.js` adds it (and logs the key list), so the
  Special plumbing added there — the middleware, the three widened routes, the login
  flag — was not in the running process at all. Symptom: a Special-bound account shows the
  four tabs (client-side, from a stored flag) but every request behind them 403s. Any test
  of this feature needs a **restarted** backend; nothing in the frontend can paper over it.
- ✅ **`PUT /admin/users/:id/special` refreshed only one of the two caches.** The flag lives
  *inside* the record's `text` blob (`|Special:true`), so every cache holding that record
  answers with the old value until its TTL runs out. The handler dropped the credits cache
  (`apiUsageTracker.refreshUserDataCache`) but not the auth one
  (`authMiddleware.invalidateUserCache`, 5-minute TTL) — and it is the auth cache that
  `isSpecialRequest` reads through `req.user.text`. Both directions were wrong: a freshly
  tagged account was refused for up to five minutes, and a **revoked** account kept its
  four views for up to five minutes. Now one call, `refreshAccessCaches(id, item)`, in
  `middleware/adminAccess.js`, which is also where the invariant is documented. Covered by
  three tests in `__tests__/unit/adminAccess.test.js`.
- ✅ **A tag applied mid-session needed a re-login, and no longer does.** `isSpecial` rode
  only on the login response, so an account flagged *after* it signed in had no way to
  learn about it on the client. `/usage` already reports the live flag, so
  `getUserUsage.fulfilled` now raises `state.user.isSpecial` (and `dataService.getUserUsage`
  persists it), and `AdminLayout` asks the server that one question before deciding "not
  Special" for a signed-in non-admin. It only ever *raises* the flag, from an explicit
  `isSpecial: true` in a successful response — the server stays the authority.
- 🐛 **The new gate had a bug the new tests caught.** Folding "is the check in flight?" into
  the same flag that told the gate to wait meant the gate stopped waiting the moment the
  request started, and bounced the account home before the answer arrived. The two are now
  separate (`awaitingSpecialCheck` for the wait, `shouldAskForSpecial` for the request).
  `frontend/src/pages/Admin/AdminLayout.test.jsx` pins all of it: 9 tabs for admin, exactly
  4 for Special, `/admin/users` bounced, a mid-session tag let through, a failed check
  settling the wait, and no check at all for a signed-out visitor.
- ✅ **The hidden views really are hidden.** The console's tab row is built from
  `allowedViews` (admin: all nine; Special: the four in `SPECIAL_ADMIN_PATHS`), verified in
  the browser as 4 tabs — and the only `/admin/*` link rendered *inside* a view is the
  Dashboard's referrer rows pointing at `/admin/map`, which a Special account may open.

---

## 12. Consumer-facing safety surfaces — 🟡 partially implemented

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.


Keep and extend the existing permission model (`server/automation/permissions.js`,
`security-guard.js`) — do not weaken it for consumer onboarding. Category-based
approval, shell allow/deny-list, protected-path blocking, and the
`globalKillSwitch`/dry-run mechanisms all stay.


### 12.1 Privacy / PII scrubbing — ✅ implemented


### 12.2 Inspect-before-run capability summary — ✅ implemented


### 12.3 Cloud-vision consent — ✅ implemented


### 12.4 Remaining safety checklist

- 🟡 Require cloud-vision consent before any multimodal upload path (`vision-fusion.js` + `screenshot_check` gated; future paths need wiring).

---

## 13. Backend, data-layer and script audit passes

> Moved out of the platform plan doc on 2026-09-16, when it became a pointer file for
> agents ([`agent.md`](agent.md)). Section names are the reference here — no chapter
> numbers.

### 13.1 Repo audit (2026-09-09)

Issues surfaced while auditing the repo beyond the original plan. Ordered by
impact; none are Simple-core blockers, but several are user-visible or DRY/security-adjacent.

- 🟡 **Plaintext secret fallback outside Electron** — `simple-addon/server/secret-storage.js` stores secrets in plaintext when `safeStorage` is unavailable (documented + one-shot warning; fine for CLI/Jest). Confirm the packaged addon always runs under Electron, and consider refusing to persist (instead of plaintext) in non-Electron contexts.
- 🟡 **Derive admin-ness server-side** — the backend now attaches an `isAdmin` flag to the register/login/guest responses (`postData.js`), and the frontend reads it via shared `isAdminUser()`/`isMuseVisitor()` helpers in `constants/admin.js` (`AdminLayout`/`HeaderDropper`/`DeepStorage`/`Home`/`Muse`). Remaining: the hardcoded ID + `'girlfriend'` gate still ship as a legacy fallback until every active session re-logs in — then the constants can be deleted.
- ⚠️ **Committed user PII still in git history** — `backend/reports/support-tickets-*.json` was deleted from the working tree and added to `.gitignore`, but the file is still in git history; full removal needs a history rewrite (e.g. `git filter-repo`/BFG) + force-push.


### 13.2 Second audit pass (2026-09-09)

- 🟡 **Experimental `signal-bridge` predates the Bedrock-only decision** — marked ⚠️ DEPRECATED/UNWIRED in its header. Actual deletion (or re-implementation via the Bedrock proxy) is still a product decision.
- 🟡 **Public guest account with a known password** — `backend/constants/guestAccount.js` hardcodes `guest@gmail.com` / `guest` for "Login as Guest" (and `createGuestUser.js` logs the password). A deliberate demo feature, but a shared account with a known credential should stay strictly read-only/rate-limited and excluded from paid/powerful paths.


### 13.3 Third audit pass (2026-09-09)

- 🟡 **S3 upload file-type validation trusts the client MIME type** — *post-upload
  content check added (2026-09-12).* `validateFile` rejects known-dangerous
  extensions (.html/.svg/.exe/…) and extension/content-type mismatches, but those
  only constrain what the client *claims* — the bytes travel client → S3 via the
  presigned URL, so the server never sees them. `confirmUpload` now reads the
  object's leading 512 bytes (a Range GET) and refuses content that contradicts
  its extension, deleting the object so a rejected upload is neither recorded nor
  billed. See `utils/fileSignature.js` + `__tests__/unit/uploadSignatureGate.test.js`.
  Two deliberate properties: the rule is **contradiction-only** (content that can't
  be identified is accepted, because failing a real user's file is worse than the
  marginal gain) and it **fails open** on an S3 read error, with
  `UPLOAD_SIGNATURE_CHECK=false` as the operator kill-switch. ⬜ Remaining: content
  with no known signature is still accepted, so this narrows the gap rather than
  closing it — closing it needs real scanning (AV/content-inspection service).
- 🟡 **JWT persisted in `localStorage`** — `frontend/src/features/data/dataSlice.js` stores the auth token in localStorage, so any XSS could exfiltrate it. Combined with the loose CSP above, prefer an `httpOnly` session cookie (or at least tighten CSP).


### 13.5 Fifth audit pass (2026-09-09)

- 🟡 **HIGH — the addon's local HTTP API is unauthenticated and CORS-allows the production site + LAN origins** — hardened: `simple-addon/server/index.js` now rejects requests whose `Host` header isn't loopback/private (anti DNS-rebinding) and 403s non-allowlisted cross-site `Origin`s before any handler runs, so a drive-by `fetch('http://127.0.0.1:3001/...')` from an arbitrary site no longer executes. Remaining: the production site is still allowlisted, so a per-install random secret on every request (and tightening CORS to the Electron app's own origin) is still needed to close the allowlisted-origin path.


### 13.7 Seventh audit pass (2026-09-09)

- ⬜ **Addon is distributed unsigned (no code-signing certificate)** — `simple-addon/` is built without `CSC_LINK`/`CSC_KEY`/`win.certificateSubjectName`, so (a) Windows SmartScreen flags the installer/portable exe, and (b) `electron-updater` can't verify update authenticity against a publisher certificate — update trust rests on TLS + the blockmap hash alone (a compromised GitHub repo could ship a malicious update that installs silently). Sign the build and set `publisherName` so updates are authenticated.
- ✅ **CI actions pinned by mutable tags** — *fixed for immutability (2026-09-12).* All
  21 `uses:` references across the three workflows are pinned to full 40-character commit
  SHAs (version kept in a trailing comment), each verified against its repo's real
  tag→commit mapping with `git ls-remote`. Two traps worth knowing for next time:
  `github/codeql-action@v4` is an **annotated** tag, so the pin must be the *dereferenced*
  commit (`b96794f0…`, i.e. `refs/tags/v4^{}`) — pinning the tag object's own SHA fails
  the job; and `trufflesecurity/trufflehog@main` was a **moving branch**, now frozen to
  the commit `main` pointed at on 2026-09-12 (latest release: v3.97.4). Pins won't rot
  silently: `dependabot.yml` already carries a weekly `github-actions` ecosystem.
  ⬜ **Still open: the mixed versions.** `actions/checkout` and `actions/setup-node` are
  `@v4` in the two *Windows* jobs (`build-addon.yml`, `ci.yml`'s `test-simple-addon`) and
  `@v6` in every other job. Each was pinned to the version it already used rather than
  bumped: a major bump inside the addon **release** pipeline is a behaviour change that
  can't be exercised locally, so it wants a deliberate, watched change.
- ⬜ **CI can't be run locally** — the workflow changes above were validated by parsing
  each file as YAML and asserting every `uses:` resolves to a pinned SHA (plus the
  `ls-remote` mapping check), not by executing the pipelines. Worth one watched run
  before relying on it.


### 13.8 Eighth audit pass (2026-09-10)

- 🟡 **Unbounded per-request access-log writes** — *addressed for growth (2026-09-12).*
  Both per-request writers (`checkIP` in `utils/accessData.js` and `recordPageView` in
  `controllers/pageViewsController.js`) now stamp an `expiresAt` DynamoDB **TTL**,
  derived from `ANALYTICS_RETENTION_DAYS` (default 90) in the new
  `utils/analyticsRetention.js`. TTL only deletes items that *carry* the attribute, so
  durable rows (users, workspace items, goals, tickets) are never expired by it.
  **Remaining: the attribute is inert until table TTL is turned on once** —
  `node backend/scripts/configure-analytics-ttl.js` (dry run by default, `--apply` to
  change it). The per-request *write* cost itself is unchanged; sampling or a separate
  analytics table would address that, at the cost of changing what the dashboard counts.
- ✅ **`checkIP` put a third-party HTTP call on every request's critical path**
  (found 2026-09-12 while fixing the above) — it called `ipinfo` directly, and its
  callers `await` it *before* responding, so each request paid an ipinfo round-trip and
  a slow/hung ipinfo could stall the response. It now goes through
  `utils/geoLookup.getGeoForIp`, which caches per IP (1 h, 5 min for a miss) and bounds
  every lookup with a timeout. That helper also had a latent bug: `logger` was declared
  *inside* `cleanupCache`, so its `catch` threw `ReferenceError` instead of resolving
  `null` on any lookup failure — fixed, with regression tests. `extractIp` now also
  takes `req.ip` (trust-proxy aware) over the spoofable leftmost `X-Forwarded-For`.


### 13.9 Ninth audit pass (2026-09-12)

- ✅ **The 1 MB scan-truncation family was not actually finished** — the repo had fixed
  the worst offenders (storage tracking, search, delete) but five *list* endpoints in
  `controllers/csimpleController.js` still ran a single `ScanCommand` with a
  `begins_with(id, :prefix)` FilterExpression. A filter is applied only **within** the
  scanned page, so once the table passed 1 MB those endpoints returned *some* of a
  user's files — or none — with no error. That includes `getSimpleUserContext`, which
  is what the LLM is handed as the user's memory (the assistant would quietly
  "forget"), plus the memory / personality / behavior lists behind the addon's file
  browsers. The same unpaginated read sat in `llmService.loadUserContextFromDB`
  (chat memory), `workspaceContext.fetchAllOfKind` (agent context), and
  `marketplaceController` (browse + author KPI totals).
  All of it now goes through **one** importable helper, `utils/paginatedScan.js`,
  which also replaces the six copy-pasted private copies of it (`getData`,
  `getHashData`, `postData`, `profileController`, `passwordReset` — each had its own
  paragraph explaining the same mistake, which is how a seventh copy got written).
  The helper is bounded by `SCAN_MAX_PAGES` (default 200) and **warns** when it stops
  early: a partial result must never look like a complete one.
  Tests: `paginatedScan.test.js`, `csimpleListPagination.test.js` (asserts items from
  the *second* page are returned). Not verified against live DynamoDB.
- ✅ **`getUserDataCached` fetched one user with a full-table Scan** (found in the same
  pass) — `FilterExpression: "id = :userId"` filters on the partition key *after*
  scanning a page, so a user whose row sat past the first page read back as **"no
  record"**. That call decides a user's plan and credit allowance, so the failure mode
  is a paying subscriber being metered as a brand-new free account; it also billed a
  whole-table scan to fetch one row. Now a partition-key `QueryCommand`, matching the
  `getRawUserRecord` precedent. Tests: `__tests__/unit/userDataLookup.test.js`.
- ✅ **The rest of the single-page scans** (same pass) — `musicService.listSongs`,
  `stripeService.updateUserRank` (a Stripe event whose customer row sat past page 1
  never updated that subscriber's rank), `refererAnalytics` ×2 (the dashboard
  under-reported), and `testFunnelController.findUserByEmail` now use
  `utils/paginatedScan`. `putHashData`'s bug-reporter lookup was an **id-filtered
  Scan** and is now a partition-key Query — the resolution email had no recipient when
  the reporter's row sat past page 1.
- ✅ **`ocrService.updateItemWithOCR` rejected the record's real owner** (found in the
  same pass). The ownership check sliced the creator id to a fixed 24 characters
  (`substring(i + 8, i + 32)`) and compared *that* to the caller's id; ids in this
  table are 32-char crypto hex, so the comparison always failed and the actual owner
  was told "User not authorized to update this item". It also skipped the check
  entirely when a record carried no `Creator:` tag, so an untagged record was writable
  by anyone who knew its id. It now reads by partition key, matches the id up to the
  next `|` (`/(?:^|\|)Creator:([^|]+)/`) and **denies by default**, mirroring
  `fileUploadController.creatorIdOf`. Tests: `__tests__/unit/ocrItemUpdate.test.js`.
- ⚠️ **Do NOT query `userEmail-index` for email lookups** — the table carries a GSI on
  `userEmail`, but nothing in the codebase ever *writes* that attribute: every email
  read parses it out of the pipe-delimited `text` field. The index is therefore empty,
  and "optimising" the login / password-reset email scans onto it would break sign-in
  for every user. Populate + backfill the attribute first if that's ever wanted.
- ⬜ **Still outstanding** (verified, not yet fixed): `utils/guestUserManager.js` (dev
  script — single-page lookup, and its delete uses `Key: { id }` alone, which throws
  against the composite key), `utils/createGuestUser.js` (near-duplicate of it), and
  `testFunnelController`'s `GetCommand({ Key: { id: testUserId } })` (~line 304, also
  missing the sort key — it is inside a try/catch, so the funnel status endpoint just
  always reports "no live user"). Everything under `backend/scripts/` is unaudited.


### 13.10 Tenth audit pass (2026-09-12)

First pass over `backend/scripts/` — the one area *the ninth audit pass* left unaudited. The
mutating scripts turned out to be mostly well-behaved (dry-run by default, and
`Key: { id, createdAt }` on every delete/update); two things were not.

- ✅ **`migrate-images-to-s3.js` defaulted to writing.** Its dry run was a
  hand-edited constant that shipped as `const DRY_RUN = false`, so
  `node backend/scripts/migrate-images-to-s3.js` uploaded inline base64 images to
  S3 and rewrote the DynamoDB `files` arrays on live data — no flag, no prompt, no
  dry-run pass, unlike every sibling script. It is now `--apply`-gated, and the dry
  run reports "Images that WOULD be migrated" separately instead of incrementing
  the `imagesMigrated` counter (a dry run could be read as "N images migrated").
  Verified by running it: the migration is already complete — 6 items with files,
  **0 images pending**. Tests: `__tests__/unit/migrateImagesDryRun.test.js`
  (pins "no arguments issues no writes").
- ✅ **`.gitignore` protected the wrong directory.** The rule was
  `backend/storage/migration-backups/*`, but `backup-dynamodb.js` writes next to
  itself — `path.join(__dirname, 'migration-backups')`, i.e.
  `backend/scripts/migration-backups/` — which nothing ignored, so its export of
  user records (text + file metadata) was committable. (`merge-duplicate-users.js`
  is fine: it writes under `backend/logs/`, already ignored.) Added the missing
  rule; `git check-ignore` now matches. Note the *existing* tracked dump at
  `backend/storage/migration-backups/dynamodb-backup-2025-10-12T*Z.json` — 2 items,
  no `Password:` (so no credential leak), but a data export that should not be in
  the repo; untracking it is a call for the repo owner, and it stays in history
  either way (see *the repo audit*).
- ✅ **`migrate-images-to-s3.js` could not run at all.** It built its clients at
  module load from `process.env`, but `backend/.env` holds only the access keys, so
  it died with the SDK's opaque "Region is missing" (and `S3 Bucket: undefined`)
  before doing anything. It now bootstraps through `loadAllSecrets()` — the same
  path `server.js` and the other scripts use — and, when config is still missing,
  fails with the names of the missing variables instead of the SDK's message.
- ⚠️ **Other scripts may share that missing bootstrap.** `migrate-images-to-s3.js`
  was found by running it; the rest of `backend/scripts/` was read, not executed, so
  any of them that builds AWS clients at module load has the same latent failure.
  Worth a run-through before the next time one of them is needed.

---

## 14. Repository runner — `repo_run` (added 2026-09-18)

The `/net` repo agent could search, read, edit, commit and push, but it could not
RUN anything — so "verified" meant "re-read the diff", which is an assertion
rather than a check. `backend/services/repoRunner.js` closes that gap, and it is
the most dangerous capability in the harness. This section is the threat model.

**What it can execute.** A frozen map of tasks; the argv is written in code, not
passed in:

| Task | Command (argv, no shell) |
|---|---|
| `test:file` | `node node_modules/jest/bin/jest.js --config package.json --ci <target>` (frontend), `node node_modules/jest/bin/jest.js --ci <relative>` (backend, cwd=backend), `node <target>` (addon) |
| `test:backend` | `node node_modules/jest/bin/jest.js --ci` in `backend/` |
| `typecheck` | `node node_modules/typescript/bin/tsc --noEmit` in `frontend/` |
| `lint` | `node node_modules/eslint/bin/eslint.js . --ext .js,.jsx,.ts,.tsx` |
| `build` | `node node_modules/vite/bin/vite.js build` in `frontend/` |

**⚠️ The honest statement: `repo_edit_file` + `repo_run test:file` is arbitrary
code execution by proxy.** The agent can write a file and then run it. That is
inherent to "let the agent verify its own work", and it is why the containment is
carried by everything *around* the tool rather than by the tool:

1. **No command parameter.** A task name that is not in the map runs nothing.
   There is no string that becomes a command.
2. **No shell.** `execFile` with an argv array: no interpolation, no globbing,
   no pipes. `node` itself is `process.execPath` (our own binary), so nothing
   depends on PATH resolution.
3. **A scrubbed environment — the mitigation that matters most.** The backend
   process holds `JWT_SECRET`, `AWS_*`, `GITHUB_TOKEN`, `MESSAGE_ENCRYPTION_KEY`
   and the Stripe keys. A child that inherits them can print them, and that
   output goes into the model's context *and* into the step journal, which a
   browser later renders. Only `SAFE_ENV_KEYS` is passed down, with `CI=1` forced
   so a runner never waits for input. Pinned by a test that sets those variables
   and asserts the child reports them absent.
4. **Bounded by construction.** Per-task timeouts (30s–10min), `SIGKILL` on
   overrun, a 4 MB buffer, and output shaped to head + tail (60 + 40 lines, 8 KB)
   with the omission counted — because a 40k-line Jest dump is worthless to a
   model and would cost more than the turn.
5. **Its own capability.** `repo:run` is separate from `repo:write`, admin-only,
   and filtered out of the offered schemas for everyone else — so a future
   read-only or write-only admin does not implicitly get execution.
6. **A kill switch.** `REPO_RUNNER_DISABLED=1` refuses every task without a
   deploy.

**Residual risk, stated rather than implied:**

- The exfiltration path is narrow but not zero: the agent could write secrets it
  can already READ (repo files) into the working tree. `.env` files are
  gitignored, and `repo_push` requires the user's own explicit confirmation
  message plus a one-time proposal code — so an unattended push cannot happen.
- Killing the child does not necessarily kill its grandchildren (Jest workers).
  Orphans are possible on a timeout; the turn reports the kill either way.
- `repo_run` is not an approval-gated tool by default. Prompting on every check
  would defeat the purpose (the agent verifying its own work), so the containment
  above is the control instead. `TOOL_POLICY` in `toolScopes.js` is where a
  prompt would go if that judgement changes.

---

## 15. References

- [`simple-addon/server/automation/permissions.js`](../../simple-addon/server/automation/permissions.js) — central gate
- [`simple-addon/server/automation/tool-registry.js`](../../simple-addon/server/automation/tool-registry.js) — dispatch + audit hook
- [`simple-addon/server/automation/eval/`](../../simple-addon/server/automation/eval/) — regression scenarios
- [`backend/utils/secretCrypto.js`](../../backend/utils/secretCrypto.js) — backend secret format
- [`simple-addon/server/secret-storage.js`](../../simple-addon/server/secret-storage.js) — DPAPI wrapper
- [`backend/middleware/rateLimiter.js`](../../backend/middleware/rateLimiter.js) — workspace limiters
- [`agent.md`](agent.md) — roadmap & backlog (§10)

