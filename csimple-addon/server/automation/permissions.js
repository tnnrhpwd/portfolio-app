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
    shellDenyPatterns: [
        'Remove-Item\\s+.*-Recurse',
        'Format-Volume',
        'Format-',
        'reg\\s+delete',
        'shutdown\\b',
        'rd\\s+/s',
        'rmdir\\s+/s',
        'del\\s+/f',
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
    dataCapture: {
        keyboard: false,
        keyboardGrantedAt: null,
    },
    cloudVision: {
        granted: false,
        grantedAt: null,
        policyVersion: '2026-07',
    },
};

function configPath() {
    const userData = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'csimple-addon')
        : path.join(os.homedir(), '.csimple-addon');
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
            _cache = { ...DEFAULTS, ...raw, categories: { ...DEFAULTS.categories, ...(raw.categories || {}) }, tools: { ...(raw.tools || {}) } };
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
 * Decide + (if needed) ask the user whether a tool call may proceed.
 * Returns { ok: true, mode } or { ok: false, reason, mode }.
 *
 * opts.userInitiated — when true, an 'ask' mode is treated as 'allow' because
 *   the user directly typed the request into the chat input (they can't be
 *   meaningfully "prompted again" — they just asked for it). The kill switch
 *   and explicit 'deny' overrides still block.
 */
async function requestApproval(tool, args, opts = {}) {
    const mode = effectiveMode(tool);
    if (mode === 'allow' || mode === 'dry-run') return { ok: true, mode };
    if (mode === 'deny') return { ok: false, mode, reason: 'Denied by permission policy' };
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
        return { ok: false, mode, reason: 'No approval requester registered (UI not initialized)' };
    }
    try {
        const ans = await _approvalRequester(tool.name, args);
        if (ans?.approved) return { ok: true, mode: 'allow', approvedBy: ans.approvedBy || 'user' };
        return { ok: false, mode, reason: ans?.reason || 'User denied' };
    } catch (e) {
        return { ok: false, mode, reason: 'Approval prompt failed: ' + e.message };
    }
}

/**
 * Resolve the configured bind host for the addon HTTP server.
 * Returns '127.0.0.1' for loopback (default) or '0.0.0.0' for LAN.
 * Honors override via env CSIMPLE_BIND_HOST.
 */
function resolveBindHost() {
    const override = process.env.CSIMPLE_BIND_HOST;
    if (override) return override;
    const cfg = load();
    return cfg.hostBinding === 'lan' ? '0.0.0.0' : '127.0.0.1';
}

function hasKeyboardCaptureConsent() {
    return !!load().dataCapture?.keyboard;
}

function grantKeyboardCaptureConsent() {
    return save({
        dataCapture: {
            keyboard: true,
            keyboardGrantedAt: Date.now(),
        },
    });
}

function revokeKeyboardCaptureConsent() {
    return save({
        dataCapture: {
            keyboard: false,
            keyboardGrantedAt: null,
        },
    });
}

function hasCloudVisionConsent() {
    return !!load().cloudVision?.granted;
}

function grantCloudVisionConsent(policyVersion = '2026-07') {
    return save({
        cloudVision: {
            granted: true,
            grantedAt: Date.now(),
            policyVersion: String(policyVersion || '2026-07'),
        },
    });
}

function revokeCloudVisionConsent() {
    const current = load().cloudVision || {};
    return save({
        cloudVision: {
            granted: false,
            grantedAt: null,
            policyVersion: current.policyVersion || '2026-07',
        },
    });
}

function updateConsents({ keyboardCapture, cloudVision, cloudVisionPolicyVersion } = {}) {
    const cur = load();
    const patch = {};
    const changes = [];

    if (typeof keyboardCapture === 'boolean') {
        const before = !!cur.dataCapture?.keyboard;
        if (before !== keyboardCapture) {
            patch.dataCapture = {
                keyboard: keyboardCapture,
                keyboardGrantedAt: keyboardCapture ? Date.now() : null,
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
                grantedAt: cloudVision ? Date.now() : null,
                policyVersion: nextPolicy,
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
    return { config: save(patch), changes };
}

module.exports = {
    load,
    save,
    setApprovalRequester,
    resolveBindHost,
    effectiveMode,
    requestApproval,
    hasKeyboardCaptureConsent,
    grantKeyboardCaptureConsent,
    revokeKeyboardCaptureConsent,
    hasCloudVisionConsent,
    grantCloudVisionConsent,
    revokeCloudVisionConsent,
    updateConsents,
    DEFAULTS,
    _reset: _resetCache,
};
