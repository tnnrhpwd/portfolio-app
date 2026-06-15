/**
 * Trigger engine — schedules goals to fire automatically.
 *
 * Supports three trigger kinds (v1):
 *   - `cron`  : 5-field POSIX cron expression. Runs in the addon process; the
 *               minimum effective resolution is 1 minute.
 *   - `file`  : fires when any file in a watched directory matches a glob and
 *               changes (created, modified). Uses fs.watch under the hood
 *               (chokidar would be nicer but it's a heavy dep — fs.watch is
 *               good enough for a desktop addon).
 *   - `hotkey`: fires on a global keyboard shortcut. Hotkeys are owned by the
 *               Electron `globalShortcut` API which lives in main.js, so this
 *               engine only stores the desired binding and emits a registration
 *               event; main.js performs the actual `globalShortcut.register`.
 *
 * Each trigger, when fired, calls a user-supplied `dispatch(trigger)` function
 * (wired from main.js / automation/index.js — typically it enqueues the
 * trigger's `goalSlug` into the agent loop).
 *
 * Triggers are persisted as workspace items with kind='project' under the slug
 * `triggers` (a single JSON document with an array). They survive addon
 * restarts because main.js calls `loadFromDisk(dir)` on startup with the
 * effective JSON.
 *
 * Persistence shape (one workspace item):
 *   {
 *     triggers: [
 *       { id, kind: 'cron',   cron: '0 9 * * *',         goalSlug: 'daily-standup', enabled: true },
 *       { id, kind: 'file',   path: 'C:/Downloads',      glob: '*.pdf', goalSlug: 'process-pdfs', enabled: true },
 *       { id, kind: 'hotkey', accelerator: 'Ctrl+Alt+G', goalSlug: 'quick-goal', enabled: true },
 *     ]
 *   }
 */

const fs = require('fs');
const path = require('path');

const _triggers = new Map(); // id → trigger
const _watchers = new Map(); // id → { type:'cron'|'file'|'hotkey', stop: () => void }
let _dispatchFn = null;
let _configPath = null;
let _onHotkeyChange = () => {};

function configure({ configPath, dispatch, onHotkeyChange }) {
    if (typeof dispatch !== 'function') throw new TypeError('configure() requires dispatch fn');
    _dispatchFn = dispatch;
    _configPath = configPath;
    if (typeof onHotkeyChange === 'function') _onHotkeyChange = onHotkeyChange;
}

function _requireConfigured() {
    if (!_dispatchFn) throw new Error('triggers not configured — call configure() first');
}

// ─── Cron ───────────────────────────────────────────────────────────────────

/**
 * Minimal 5-field cron parser. Supports:
 *   - * (any)
 *   - N (single value)
 *   - N-M (range)
 *   - * /N (step)
 *   - N,N,N (list)
 *
 * Fields (in order): minute hour dayOfMonth month dayOfWeek
 * Ranges: 0-59 0-23 1-31 1-12 0-6 (Sun=0)
 */
function _parseCronField(expr, min, max) {
    const result = new Set();
    for (const part of String(expr).split(',')) {
        const [base, stepStr] = part.split('/');
        const step = stepStr ? parseInt(stepStr, 10) : 1;
        if (!Number.isFinite(step) || step <= 0) throw new Error(`invalid step in "${part}"`);
        let start, end;
        if (base === '*') { start = min; end = max; }
        else if (base.includes('-')) {
            const [a, b] = base.split('-').map(s => parseInt(s, 10));
            start = a; end = b;
        } else {
            const v = parseInt(base, 10);
            start = end = v;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end) {
            throw new Error(`out-of-range cron field "${part}" (allowed ${min}-${max})`);
        }
        for (let v = start; v <= end; v += step) result.add(v);
    }
    return result;
}

function parseCron(expr) {
    const parts = String(expr).trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`cron needs 5 fields, got ${parts.length}`);
    const [m, h, dom, mo, dow] = parts;
    return {
        minute:    _parseCronField(m,   0, 59),
        hour:      _parseCronField(h,   0, 23),
        dayOfMonth:_parseCronField(dom, 1, 31),
        month:     _parseCronField(mo,  1, 12),
        dayOfWeek: _parseCronField(dow, 0, 6),
    };
}

function _matchesNow(cron, date = new Date()) {
    return cron.minute.has(date.getMinutes())
        && cron.hour.has(date.getHours())
        && cron.dayOfMonth.has(date.getDate())
        && cron.month.has(date.getMonth() + 1)
        && cron.dayOfWeek.has(date.getDay());
}

function _startCronWatcher(trigger) {
    let parsed;
    try { parsed = parseCron(trigger.cron); }
    catch (e) {
        return { type: 'cron', stop: () => {}, error: e.message };
    }
    let lastFiredMinute = -1;
    const timer = setInterval(() => {
        if (!trigger.enabled) return;
        const now = new Date();
        const minuteKey = now.getMinutes() + now.getHours() * 60 + now.getDate() * 24 * 60;
        if (minuteKey === lastFiredMinute) return; // already fired this minute
        if (_matchesNow(parsed, now)) {
            lastFiredMinute = minuteKey;
            _dispatchFn(trigger).catch(e => console.warn('[triggers] cron dispatch failed:', e.message));
        }
    }, 10_000); // poll every 10s — fine resolution against minute granularity
    return { type: 'cron', stop: () => clearInterval(timer) };
}

// ─── File watcher ───────────────────────────────────────────────────────────

function _globToRegex(glob) {
    // Tiny glob: * matches anything but a slash; ? matches a single char.
    if (!glob) return /^.*$/;
    const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^\\/\\\\]*').replace(/\?/g, '.');
    return new RegExp('^' + esc + '$', 'i');
}

function _startFileWatcher(trigger) {
    if (!trigger.path || !fs.existsSync(trigger.path)) {
        return { type: 'file', stop: () => {}, error: `path not found: ${trigger.path}` };
    }
    const re = _globToRegex(trigger.glob || '*');
    const seen = new Map(); // filename → last mtime to debounce
    let watcher;
    try {
        watcher = fs.watch(trigger.path, { persistent: true }, (eventType, filename) => {
            if (!trigger.enabled || !filename) return;
            if (!re.test(filename)) return;
            const full = path.join(trigger.path, filename);
            try {
                const stat = fs.statSync(full);
                const prev = seen.get(filename) || 0;
                if (stat.mtimeMs - prev < 1500) return; // debounce burst writes
                seen.set(filename, stat.mtimeMs);
                _dispatchFn({ ...trigger, _firedBy: { file: filename, eventType } })
                    .catch(e => console.warn('[triggers] file dispatch failed:', e.message));
            } catch {
                // The file may be transient (renamed during write). Ignore.
            }
        });
    } catch (e) {
        return { type: 'file', stop: () => {}, error: e.message };
    }
    return { type: 'file', stop: () => { try { watcher.close(); } catch {} } };
}

// ─── Hotkey (delegated to main.js) ──────────────────────────────────────────

function _startHotkeyWatcher(trigger) {
    // We can't register a global shortcut from server code (the API is in
    // Electron's main process). Emit a hotkey-change event so main.js can do
    // the actual registration. Stopping just emits another event.
    _onHotkeyChange({ action: 'register', trigger });
    return {
        type: 'hotkey',
        stop: () => _onHotkeyChange({ action: 'unregister', trigger }),
    };
}

// ─── Public API ─────────────────────────────────────────────────────────────

function list() {
    return Array.from(_triggers.values()).map(t => ({ ...t }));
}

function add(trigger) {
    _requireConfigured();
    if (!trigger || !trigger.kind) throw new Error('trigger must have a kind');
    const id = trigger.id || `trg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const full = { enabled: true, ...trigger, id, createdAt: trigger.createdAt || Date.now() };
    // Validation per kind.
    if (full.kind === 'cron') parseCron(full.cron);              // throws if invalid
    if (full.kind === 'file' && !full.path) throw new Error('file trigger needs `path`');
    if (full.kind === 'hotkey' && !full.accelerator) throw new Error('hotkey trigger needs `accelerator`');
    if (!full.goalSlug) throw new Error('trigger needs `goalSlug`');

    _triggers.set(id, full);
    if (full.enabled) _start(full);
    _persist();
    return full;
}

function remove(id) {
    const t = _triggers.get(id);
    if (!t) return false;
    _stop(id);
    _triggers.delete(id);
    _persist();
    return true;
}

function update(id, patch) {
    const t = _triggers.get(id);
    if (!t) throw new Error(`trigger not found: ${id}`);
    const next = { ...t, ...patch, id };
    if (next.kind === 'cron') parseCron(next.cron);
    _stop(id);
    _triggers.set(id, next);
    if (next.enabled) _start(next);
    _persist();
    return next;
}

function _start(trigger) {
    let handle;
    switch (trigger.kind) {
        case 'cron':   handle = _startCronWatcher(trigger);   break;
        case 'file':   handle = _startFileWatcher(trigger);   break;
        case 'hotkey': handle = _startHotkeyWatcher(trigger); break;
        default: throw new Error(`unknown trigger kind: ${trigger.kind}`);
    }
    _watchers.set(trigger.id, handle);
    if (handle.error) console.warn(`[triggers] ${trigger.id} (${trigger.kind}) error: ${handle.error}`);
}

function _stop(id) {
    const h = _watchers.get(id);
    if (!h) return;
    try { h.stop(); } catch {}
    _watchers.delete(id);
}

function startAll() {
    for (const t of _triggers.values()) if (t.enabled) _start(t);
}

function stopAll() {
    for (const id of Array.from(_watchers.keys())) _stop(id);
}

function _persist() {
    if (!_configPath) return;
    try {
        fs.mkdirSync(path.dirname(_configPath), { recursive: true });
        fs.writeFileSync(_configPath, JSON.stringify({ triggers: Array.from(_triggers.values()) }, null, 2));
    } catch (e) {
        console.warn('[triggers] persist failed:', e.message);
    }
}

function loadFromDisk() {
    if (!_configPath || !fs.existsSync(_configPath)) return;
    try {
        const json = JSON.parse(fs.readFileSync(_configPath, 'utf-8'));
        const list = Array.isArray(json?.triggers) ? json.triggers : [];
        for (const t of list) _triggers.set(t.id, t);
        console.log(`[triggers] loaded ${_triggers.size} from disk`);
    } catch (e) {
        console.warn('[triggers] load failed:', e.message);
    }
}

module.exports = {
    configure, list, add, remove, update,
    startAll, stopAll, loadFromDisk,
    // exposed for unit tests
    parseCron, _matchesNow, _globToRegex,
};
