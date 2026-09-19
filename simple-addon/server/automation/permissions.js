/**
 * Permission store for the automation tool layer.
 *
 * Each tool declares its category and whether it `requiresApproval` by default.
 * The user can override via the Permission Center UI; settings are persisted
 * to a JSON file in the Electron userData / resources directory.
 *
 * Categories: 'safe-read' | 'sandboxed-write' | 'shell' | 'destructive' | 'system'
 *
 * Modes per category:
 *   - 'allow'      : run without prompting
 *   - 'ask'        : prompt the user every time (default for risky categories)
 *   - 'dry-run'    : run a simulated/no-op path (each tool must implement)
 *   - 'deny'       : refuse to run
 *
 * Cross-cutting flags:
 *   - globalKillSwitch: when true, every tool returns { denied: true, reason }
 *   - dryRunMode: when true, override every category to 'dry-run'
 *   - autoApproveAll: when true, any tool whose effective mode is 'ask' is
 *       auto-approved without prompting. 'deny', the kill switch, and the shell
 *       deny-list still block — those are hard safety stops, not prompts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
    globalKillSwitch: false,
    dryRunMode: false,
    // When true, 'ask' tool calls run without a prompt. Hard stops (deny, kill
    // switch, shell deny-list) are unaffected. Off by default — enabling this
    // lets the agent act unattended, so it's an explicit, user-set choice.
    autoApproveAll: false,
    // Continuous listener (O-O-G-P-A "continuous" autonomy level): when true,
    // the addon autonomously starts the loop on waiting goals and promotes
    // high-confidence, non-destructive suggestions into running goals. Off by
    // default — an explicit, user-set choice.
    continuousMode: false,
    categories: {
        'safe-read':       'allow',
        'sandboxed-write': 'ask',
        'shell':           'ask',
        'destructive':     'ask',
        'system':          'ask',
    },
    // Per-tool overrides win over category. Same enum.
    tools: {},
    // PowerShell command allow-list (regex strings). If a command matches one of
    // these, the shell tool runs without prompting EVEN when category=ask.
    shellAllowPatterns: [
        '^Get-',
        '^Test-Path',
        '^Resolve-Path',
        '^Select-String',
        '^Measure-Object',
    ],
    // PowerShell command deny-list (regex strings). Always blocked, no prompt.
    // Mirrors the strongest patterns from security-guard.js so the shell tool
    // cannot be used to bootstrap remote code execution even when a caller
    // bypasses the approval prompt (e.g. a cloud-relay chat command running
    // with userInitiated=true).
    shellDenyPatterns: [
        'Remove-Item\\s+.*-Recurse',
        'Format-Volume',
        'Format-',
        'reg\\s+delete',
        'reg\\s+add\\s+hklm',
        'shutdown\\b',
        'rd\\s+/s',
        'rmdir\\s+/s',
        'del\\s+/f',
        'Invoke-Expression',
        '\\biex\\b',
        'New-Object\\s+Net\\.WebClient',
        'DownloadString\\s*\\(',
        'DownloadFile\\s*\\(',
        '\\[Convert\\]::FromBase64String',
        '-enc(?:odedcommand)?\\s+[A-Za-z0-9+/=]{20,}',
        'Set-MpPreference\\s+.*-Disable',
        'netsh\\s+advfirewall',
        'Stop-Service\\s+.*(?:WinDefend|MpSvc|wscsvc|BFE|mpssvc)',
        '\\bbcdedit\\b',
        '\\bdiskpart\\b',
    ],
    // Filesystem write/read sandbox roots (absolute paths). Empty = home dir only.
    fsRoots: [],
    // How the local addon HTTP/HTTPS server binds:
    //   'loopback' (default) — 127.0.0.1 only; safest. Cloud relay (outbound) and
    //                          local frontend talking via http://127.0.0.1 still work.
    //   'lan'                — 0.0.0.0; lets phones on the same WiFi hit the addon
    //                          directly via the LAN IP shown in /api/network. Opt-in.
    hostBinding: 'loopback',
    // Sensitive capture consents (revocable via permissions save API).
    // `*UpdatedAt` is set on every grant AND revoke (unlike `*GrantedAt`,
    // which is cleared on revoke) so cloud sync can last-write-wins merge
    // across devices/addon reinstalls without losing "this was just revoked"
    // information.
    dataCapture: {
        keyboard: false,
        keyboardGrantedAt: null,
        keyboardUpdatedAt: null,
    },
    cloudVision: {
        granted: false,
        grantedAt: null,
        policyVersion: '2026-07',
        updatedAt: null,
    },
};

// Cloud sync (source of truth): consents are pushed to and pulled from the
// user's backend workspace (kind='settings', slug='automation-consents') so
// granting consent once (on any addon install, any device, signed into the
// same account) is honored everywhere — see workspace-client.js. All of this
// is strictly best-effort: no token, no network, or a backend error must
// never block a local consent grant/revoke or crash the caller.
const CONSENTS_SETTINGS_SLUG = 'automation-consents';
let _workspaceClient = null;
function _wc() {
    if (_workspaceClient === null) {
        try { _workspaceClient = require('./workspace-client'); }
        catch { _workspaceClient = false; }
    }
    return _workspaceClient || null;
}

function configPath() {
    const userData = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'simple-addon')
        : path.join(os.homedir(), '.simple-addon');
    return path.join(userData, 'automation-permissions.json');
}

let _cache = null;
let _approvalRequester = null; // (toolName, args) => Promise<{approved:boolean, reason?:string}>

function load() {
    if (_cache) return _cache;
    try {
        const p = configPath();
        if (fs.existsSync(p)) {
            const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
            // Security: always union the built-in shell deny-list with any
            // user-configured patterns, so hardening shipped in an update can
            // never be silently removed by an older saved permissions file.
            const shellDenyPatterns = Array.from(new Set([
                ...(DEFAULTS.shellDenyPatterns || []),
                ...(raw.shellDenyPatterns || []),
            ]));
            _cache = {
                ...DEFAULTS,
                ...raw,
                categories: { ...DEFAULTS.categories, ...(raw.categories || {}) },
                tools: { ...(raw.tools || {}) },
                shellDenyPatterns,
            };
        } else {
            _cache = { ...DEFAULTS };
        }
    } catch {
        _cache = { ...DEFAULTS };
    }
    return _cache;
}

function save(partial) {
    const cur = load();
    const next = {
        ...cur,
        ...partial,
        categories: { ...cur.categories, ...(partial.categories || {}) },
        tools: { ...cur.tools, ...(partial.tools || {}) },
        dataCapture: { ...(cur.dataCapture || {}), ...(partial.dataCapture || {}) },
        cloudVision: { ...(cur.cloudVision || {}), ...(partial.cloudVision || {}) },
    };
    _cache = next;
    try {
        const p = configPath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[permissions] save failed:', e.message);
    }
    return next;
}

function setApprovalRequester(fn) {
    _approvalRequester = fn;
}

/**
 * Bust the in-process config cache. Used by the eval harness after it
 * restores the original permission file on disk, so subsequent `load()`
 * calls re-read from disk instead of returning a stale snapshot.
 */
function _resetCache() {
    _cache = null;
}

/**
 * Resolve the effective mode for a tool invocation.
 * Returns one of 'allow' | 'ask' | 'dry-run' | 'deny'.
 */
function effectiveMode(tool) {
    const cfg = load();
    if (cfg.globalKillSwitch) return 'deny';
    if (cfg.dryRunMode) return 'dry-run';
    const perTool = cfg.tools[tool.name];
    if (perTool) return perTool;
    return cfg.categories[tool.category] || 'ask';
}

/**
 * WHY a call was refused.
 *
 * `reason` is prose for a human and stays the human-facing text; `cause` is the
 * machine-readable half, because the reason string cannot be classified reliably
 * — and the cloud learned that the hard way. `pcTools.pc_do` inferred "was this a
 * refusal?" from `/denied|not approved|permission policy/i` against the reason
 * text, which meant every new wording silently reclassified a refusal as a fault.
 * Two of the six branches below were already mis-read that way:
 *
 *   - the kill switch  ("Blocked by the emergency kill switch …") matched neither
 *     the denial regex nor the "did not answer" one, so it reached the model as
 *     `Error:` — a crash — with no "do not retry";
 *   - an expired prompt ("no answer within 110s …") matched nothing at all, so a
 *     user who was simply away from their desk for two minutes produced a
 *     `HARNESS: FAILED — not retryable` instruction telling the model to give up.
 *
 * The distinction the prose also destroyed is the important one for the user: a
 * refusal that a person made or missed can be re-asked, and one that a SETTING
 * made cannot. Those need opposite next moves, and only the addon knows which it
 * was — so it says so, and the cloud stops guessing.
 */
const CAUSES = Object.freeze({
  // The emergency stop. Nothing on this machine runs until the user clears it.
  KILL_SWITCH: 'kill-switch',
  // A persisted policy: per-tool override or category default set to 'deny'.
  POLICY_DENY: 'policy-deny',
  // A human was asked and said no.
  USER_DECLINED: 'user-declined',
  // A human was asked and the prompt expired unanswered. Nothing ran.
  EXPIRED: 'expired',
  // No approval UI is wired up — a plumbing fault, not a decision.
  NO_REQUESTER: 'no-requester',
  // The prompt itself threw — a fault, not a decision.
  PROMPT_FAILED: 'prompt-failed',
});

/**
 * Causes where asking again could legitimately succeed — because the block was a
 * person's momentary answer (or non-answer) rather than a stored setting.
 *
 * A policy denial and the kill switch are NOT here on purpose: retrying them is
 * not "worth a try", it is a guaranteed identical refusal. `deny` is a hard stop
 * by design (see the header), so a retry would only add noise.
 */
const RETRYABLE_CAUSES = new Set([CAUSES.USER_DECLINED, CAUSES.EXPIRED]);

/** True when a fresh attempt could plausibly be answered differently. */
function isRetryableCause(cause) {
  return RETRYABLE_CAUSES.has(cause);
}

/**
 * Decide + (if needed) ask the user whether a tool call may proceed.
 * Returns { ok: true, mode } or { ok: false, reason, cause, mode }.
 *
 * opts.userInitiated — when true, an 'ask' mode is treated as 'allow' because
 *   the user directly typed the request into the chat input (they can't be
 *   meaningfully "prompted again" — they just asked for it). The kill switch
 *   and explicit 'deny' overrides still block.
 *
 * opts.approvalTimeoutMs — how long the prompt may stay unanswered before it is
 *   treated as a REFUSAL. Unset means "wait for the human" (the local default: a
 *   prompt on screen in front of the user, who can answer or dismiss it). It is
 *   set by the cloud relay path, and that asymmetry is the point — see
 *   `approvalTimeoutMs()`.
 */
async function requestApproval(tool, args, opts = {}) {
    const mode = effectiveMode(tool);
    if (mode === 'allow' || mode === 'dry-run') return { ok: true, mode };
    if (mode === 'deny') {
        // `AUTOMATION_SECURITY.md`: every deny path must surface a user-visible reason that names
        // WHAT blocked it (kill switch vs a specific deny rule vs the category
        // default) — never a generic "denied by policy" that leaves the user
        // guessing which setting to flip.
        const cfg = load();
        if (cfg.globalKillSwitch) {
            return { ok: false, mode, cause: CAUSES.KILL_SWITCH, reason: 'Blocked by the emergency kill switch (turn it off in Settings → Permissions).' };
        }
        if (cfg.tools[tool.name] === 'deny') {
            return { ok: false, mode, cause: CAUSES.POLICY_DENY, reason: `Denied — "${tool.name}" is set to deny in your permission policy.` };
        }
        return { ok: false, mode, cause: CAUSES.POLICY_DENY, reason: `Denied by permission policy (category "${tool.category}").` };
    }
    // 'ask'
    if (opts.userInitiated) {
        return { ok: true, mode: 'allow', approvedBy: 'user-chat-request' };
    }
    // Unattended auto-approval. Hard stops (deny / kill switch) were already
    // handled above via effectiveMode, so this only fast-tracks 'ask' calls.
    if (load().autoApproveAll) {
        return { ok: true, mode: 'allow', approvedBy: 'auto-approve-all' };
    }
    if (!_approvalRequester) {
        return { ok: false, mode, cause: CAUSES.NO_REQUESTER, reason: 'No approval requester registered (UI not initialized)' };
    }
    try {
        const ans = await withApprovalDeadline(
            Promise.resolve().then(() => _approvalRequester(tool.name, args)),
            opts.approvalTimeoutMs,
        );
        if (ans?.approved) return { ok: true, mode: 'allow', approvedBy: ans.approvedBy || 'user' };
        // Three different non-answers come back with `approved: false`, and they
        // need opposite advice, so the marker set by `withApprovalDeadline` —
        // not the wording of the reason — decides the cause.
        // `failed` first: a prompt that THREW must not be reported as the user's
        // decision, and a `failed` answer never carries `expired`.
        const cause = ans?.failed
            ? CAUSES.PROMPT_FAILED
            : (ans?.expired ? CAUSES.EXPIRED : CAUSES.USER_DECLINED);
        return {
            ok: false,
            mode,
            cause,
            reason: ans?.reason || 'User denied',
        };
    } catch (e) {
        return { ok: false, mode, cause: CAUSES.PROMPT_FAILED, reason: 'Approval prompt failed: ' + e.message };
    }
}

/**
 * Race an approval prompt against its deadline.
 *
 * **Why this exists.** The cloud `/net` harness dispatches a PC action over the
 * relay and waits ~120 s for the answer (`pcTools.PC_TOOL_TIMEOUT_MS`). Before
 * this, the prompt on the PC had NO deadline of its own, so an `ask` tool the
 * user never answered left the prompt open indefinitely: the cloud turn gave up
 * and told the model "it may still be running", and then — minutes later, with
 * nobody in that conversation — clicking Approve would RUN the action. A late
 * approval must not be able to execute anything.
 *
 * So an expired prompt resolves as a REFUSAL, and with a reason that says why.
 * The prompt widget is not dismissed by this (the UI owns its own lifecycle) —
 * what matters is that answering it afterwards changes nothing, because the tool
 * call it belonged to has already returned.
 *
 * `timeoutMs <= 0` / unset keeps the old behaviour exactly, which is what a
 * LOCAL agent step gets: there a human is looking at the prompt, and expiring it
 * under them would be a regression, not a safety win.
 *
 * ⚠️ The timer is deliberately NOT `unref`'d, and that is a tested decision, not
 * an oversight: an unref'd timer does not keep the event loop alive, so when the
 * deadline is the only pending work the process can exit BEFORE it fires — the
 * deadline would be skipped exactly when it matters. A `setTimeout` that has to
 * run must be ref'd. (Found by the "never answered is REFUSED" case below, which
 * hung rather than failing when the timer was unref'd.)
 */
function withApprovalDeadline(promise, timeoutMs) {
    const ms = Number(timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) return promise;
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve({
                approved: false,
                // Says WHICH non-answer this was, so `requestApproval` can label
                // the refusal without reading the reason text back. Without it
                // "nobody answered" was indistinguishable from "the user said no",
                // and the two need opposite advice: one is worth re-asking.
                expired: true,
                reason: `no answer within ${Math.round(ms / 1000)}s — the request expired and nothing was run.`,
            });
        }, ms);
        const settle = (value) => { clearTimeout(timer); resolve(value); };
        // A prompt that THREW is a fault, not a decision — and it resolves rather
        // than rejects, so without this marker it would be reported to the user as
        // "you declined", blaming them for a wiring failure.
        promise.then(settle, (err) => settle({ approved: false, failed: true, reason: `Approval prompt failed: ${err.message}` }));
    });
}

/**
 * How long a RELAY-dispatched tool call may wait for an approval.
 * Slightly under the cloud's dispatch window on purpose: the addon must answer
 * BEFORE the cloud gives up, so the harness receives a definite refusal (which
 * its taxonomy classifies as `permission` — "do not retry, tell the user")
 * instead of "it may still be running" (an unknown it can only warn about).
 */
function relayApprovalTimeoutMs() {
    const raw = Number(process.env.ADDON_APPROVAL_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw > 0) return raw;
    return 110_000;
}

/**
 * Ask the human to approve a SPECIFIC action, and BLOCK until they answer.
 *
 * **Why this is not `goal_ask_user`.** That tool writes the question into the goal
 * and marks it `blocked`, then returns immediately — the run carries on without an
 * answer, so it can never gate anything. A user asked for exactly this and could
 * not get it: *"please google message my girlfriend that I love her … please verify
 * before sending the message."* Nothing in the toolset could stop before an
 * irreversible action, show the content, and continue only on a yes.
 *
 * It reuses the approval channel that already exists (`setApprovalRequester` →
 * the permission-center prompt), so the question appears in the same place the user
 * already answers tool permissions, and the relay path bounds it with the same
 * deadline (`approvalTimeoutMs`, 110 s under the cloud's 120 s).
 *
 * ⚠️ **`autoApproveAll` does NOT satisfy a confirmation, and that is deliberate.**
 * A blanket "stop asking me" is a preference about *tool permissions*; this call
 * exists because the agent was told to verify a specific piece of content with a
 * specific person. Silently auto-approving it would defeat the only thing it is
 * for. (`requestApproval` honours the flag because there it means "do not prompt
 * me for tool calls", which is a different promise.)
 *
 * @param {object} args
 * @param {string} args.what        one line naming the action, shown to the user
 * @param {string} [args.details]   the exact content — recipient and body text
 * @param {number} [args.approvalTimeoutMs] deadline; unset = wait for the human
 * @returns {Promise<{approved: boolean, reason?: string, unavailable?: boolean}>}
 */
async function requestConfirmation({ what, details = '', approvalTimeoutMs } = {}) {
    const action = String(what || '').trim();
    if (!action) return { approved: false, reason: 'nothing was described to confirm' };

    if (!_approvalRequester) {
        // Unattended (no UI wired up). This MUST fail rather than pass: the caller
        // is about to do something irreversible, and "nobody could be asked" is not
        // a yes. It is a distinct flag so the caller can say which happened.
        return { approved: false, unavailable: true, reason: 'no approval UI is connected, so the user could not be asked' };
    }

    try {
        const ans = await withApprovalDeadline(
            // The prompt shows the raw args (the permission center reads the queue,
            // not the SSE event — see `defaultApprovalRequester`), so the content
            // being verified is exactly what the user is shown.
            Promise.resolve().then(() => _approvalRequester('user_confirm', {
                action,
                ...(details ? { details: String(details) } : {}),
            })),
            approvalTimeoutMs,
        );
        if (ans?.approved) return { approved: true, approvedBy: ans.approvedBy || 'user' };
        return {
            approved: false,
            reason: ans?.failed
                ? 'the confirmation prompt failed to appear'
                : (ans?.expired ? 'the confirmation was not answered in time' : (ans?.reason || 'the user declined')),
        };
    } catch (e) {
        return { approved: false, reason: `the confirmation prompt failed: ${e.message}` };
    }
}

/**
 * Resolve the configured bind host for the addon HTTP server.
 * Returns '127.0.0.1' for loopback (default) or '0.0.0.0' for LAN.
 * Honors override via env SIMPLE_BIND_HOST.
 */
function resolveBindHost() {
    const override = process.env.SIMPLE_BIND_HOST;
    if (override) return override;
    const cfg = load();
    return cfg.hostBinding === 'lan' ? '0.0.0.0' : '127.0.0.1';
}

function hasKeyboardCaptureConsent() {
    return !!load().dataCapture?.keyboard;
}

function grantKeyboardCaptureConsent() {
    const now = Date.now();
    const next = save({
        dataCapture: {
            keyboard: true,
            keyboardGrantedAt: now,
            keyboardUpdatedAt: now,
        },
    });
    _pushConsentsToCloud(next);
    return next;
}

function revokeKeyboardCaptureConsent() {
    const next = save({
        dataCapture: {
            keyboard: false,
            keyboardGrantedAt: null,
            keyboardUpdatedAt: Date.now(),
        },
    });
    _pushConsentsToCloud(next);
    return next;
}

function hasCloudVisionConsent() {
    return !!load().cloudVision?.granted;
}

function grantCloudVisionConsent(policyVersion = '2026-07') {
    const next = save({
        cloudVision: {
            granted: true,
            grantedAt: Date.now(),
            policyVersion: String(policyVersion || '2026-07'),
            updatedAt: Date.now(),
        },
    });
    _pushConsentsToCloud(next);
    return next;
}

function revokeCloudVisionConsent() {
    const current = load().cloudVision || {};
    const next = save({
        cloudVision: {
            granted: false,
            grantedAt: null,
            policyVersion: current.policyVersion || '2026-07',
            updatedAt: Date.now(),
        },
    });
    _pushConsentsToCloud(next);
    return next;
}

function updateConsents({ keyboardCapture, cloudVision, cloudVisionPolicyVersion } = {}) {
    const cur = load();
    const patch = {};
    const changes = [];
    const now = Date.now();

    if (typeof keyboardCapture === 'boolean') {
        const before = !!cur.dataCapture?.keyboard;
        if (before !== keyboardCapture) {
            patch.dataCapture = {
                keyboard: keyboardCapture,
                keyboardGrantedAt: keyboardCapture ? now : null,
                keyboardUpdatedAt: now,
            };
            changes.push({
                key: 'dataCapture.keyboard',
                from: before,
                to: keyboardCapture,
                action: keyboardCapture ? 'granted' : 'revoked',
            });
        }
    }

    if (typeof cloudVision === 'boolean') {
        const before = !!cur.cloudVision?.granted;
        const currentPolicy = cur.cloudVision?.policyVersion || '2026-07';
        const nextPolicy = String(cloudVisionPolicyVersion || currentPolicy);
        if (before !== cloudVision || nextPolicy !== currentPolicy) {
            patch.cloudVision = {
                granted: cloudVision,
                grantedAt: cloudVision ? now : null,
                policyVersion: nextPolicy,
                updatedAt: now,
            };
            changes.push({
                key: 'cloudVision.granted',
                from: before,
                to: cloudVision,
                action: cloudVision ? 'granted' : 'revoked',
                policyVersion: nextPolicy,
            });
        }
    }

    if (!changes.length) return { config: cur, changes: [] };
    const config = save(patch);
    _pushConsentsToCloud(config);
    return { config, changes };
}

/**
 * Fire-and-forget push of the current consent state to the user's backend
 * workspace. Never throws, never awaited by callers — a slow/offline/
 * unauthenticated backend must never delay a local grant/revoke.
 */
function _pushConsentsToCloud(cfg) {
    const wc = _wc();
    if (!wc) return;
    const payload = {
        dataCapture: cfg.dataCapture || DEFAULTS.dataCapture,
        cloudVision: cfg.cloudVision || DEFAULTS.cloudVision,
    };
    Promise.resolve()
        .then(() => wc.upsertSettings(CONSENTS_SETTINGS_SLUG, {
            name: 'Automation consents',
            content: JSON.stringify(payload),
        }))
        .catch((e) => console.warn('[permissions] cloud consent push skipped:', e.message));
}

/**
 * Pull the cloud consent snapshot and merge it into the local config,
 * last-write-wins per field (compares `keyboardUpdatedAt` / cloudVision's
 * `updatedAt`). Called once at addon startup so granting consent on one
 * device/addon-install is honored on every other one signed into the same
 * account — without ever overwriting a MORE recent local change.
 * Best-effort: swallows all errors (offline, signed out, new user w/ no
 * saved settings yet, etc).
 */
async function pullAndMergeConsentsFromCloud() {
    const wc = _wc();
    if (!wc) return null;
    let remote;
    try {
        const item = await wc.getSettings(CONSENTS_SETTINGS_SLUG);
        remote = item?.content ? JSON.parse(item.content) : null;
    } catch {
        return null; // not found / offline / signed out — nothing to merge
    }
    if (!remote) return null;

    const cur = load();
    const patch = {};
    let changed = false;

    const localKbUpdated = cur.dataCapture?.keyboardUpdatedAt || 0;
    const remoteKbUpdated = remote.dataCapture?.keyboardUpdatedAt || 0;
    if (remoteKbUpdated > localKbUpdated) {
        patch.dataCapture = {
            keyboard: !!remote.dataCapture?.keyboard,
            keyboardGrantedAt: remote.dataCapture?.keyboardGrantedAt || null,
            keyboardUpdatedAt: remoteKbUpdated,
        };
        changed = true;
    }

    const localCvUpdated = cur.cloudVision?.updatedAt || 0;
    const remoteCvUpdated = remote.cloudVision?.updatedAt || 0;
    if (remoteCvUpdated > localCvUpdated) {
        patch.cloudVision = {
            granted: !!remote.cloudVision?.granted,
            grantedAt: remote.cloudVision?.grantedAt || null,
            policyVersion: remote.cloudVision?.policyVersion || cur.cloudVision?.policyVersion || '2026-07',
            updatedAt: remoteCvUpdated,
        };
        changed = true;
    }

    if (!changed) {
        // Local is at least as fresh — push it up so cloud never regresses
        // (covers the case where cloud never had a snapshot, or is stale).
        _pushConsentsToCloud(cur);
        return null;
    }

    return save(patch);
}

module.exports = {
    load,
    save,
    setApprovalRequester,
    resolveBindHost,
    effectiveMode,
    requestApproval,
    requestConfirmation,
    relayApprovalTimeoutMs,
    // The refusal vocabulary: `cause` is what the cloud classifies on, so it has
    // to be shared rather than string-matched. See CAUSES above.
    CAUSES,
    RETRYABLE_CAUSES,
    isRetryableCause,
    hasKeyboardCaptureConsent,
    grantKeyboardCaptureConsent,
    revokeKeyboardCaptureConsent,
    hasCloudVisionConsent,
    grantCloudVisionConsent,
    revokeCloudVisionConsent,
    updateConsents,
    pullAndMergeConsentsFromCloud,
    DEFAULTS,
    _reset: _resetCache,
};
