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
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
    globalKillSwitch: false,
    dryRunMode: false,
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

module.exports = {
    load,
    save,
    setApprovalRequester,
    effectiveMode,
    requestApproval,
    DEFAULTS,
};
