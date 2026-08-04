/**
 * Skill hotkey registry — maps global keyboard accelerators to recorded skills
 * (a.k.a. "macros"). When the user binds a hotkey to a macro in the web app,
 * the frontend pushes the full binding map to the addon via
 * `POST /api/skill/hotkeys`; this module owns the desired state, persists it to
 * disk so it survives addon restarts, and delegates the actual OS-level
 * `globalShortcut.register()` / `unregister()` to main.js through the
 * `onHotkeyChange` callback (the Electron API is only available in main).
 *
 * Persistence shape (single JSON document on disk):
 *   {
 *     hotkeys: [
 *       { slug: 'open-invoices', accelerator: 'CommandOrControl+Alt+1' },
 *       ...
 *     ]
 *   }
 *
 * The registry is the single source of truth for what is *currently registered*
 * in-process. `setAll()` performs a diff so unchanged bindings are never
 * churned (re-registering a live accelerator can briefly drop it).
 */

const fs = require('fs');
const path = require('path');

// Electron accelerator grammar is permissive; we constrain it to a safe subset:
// zero or more modifiers joined by '+', followed by exactly one key token.
const MODIFIERS = new Set([
    'command', 'cmd', 'control', 'ctrl', 'commandorcontrol', 'cmdorctrl',
    'alt', 'option', 'altgr', 'shift', 'super', 'meta',
]);
// Allowed final key tokens: single alphanumerics, F1–F24, and a set of named keys.
const KEY_RE = /^(?:[a-z0-9]|f[1-9]|f1[0-9]|f2[0-4]|space|tab|backspace|delete|insert|return|enter|up|down|left|right|home|end|pageup|pagedown|escape|esc|plus|numadd|numsub|nummult|numdiv|numdec|num0|num1|num2|num3|num4|num5|num6|num7|num8|num9)$/;

const _current = new Map(); // slug → accelerator (currently registered)
let _configPath = null;
let _onHotkeyChange = () => {};
let _configured = false;

/**
 * Validate and canonicalise an Electron accelerator string. Returns the
 * normalised accelerator or throws on invalid input. Requires at least one
 * modifier so bindings can't hijack a bare printable key globally.
 */
function normalizeAccelerator(accelerator) {
    if (typeof accelerator !== 'string' || !accelerator.trim()) {
        throw new Error('accelerator must be a non-empty string');
    }
    const parts = accelerator.split('+').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) {
        throw new Error(`accelerator "${accelerator}" must include at least one modifier and a key`);
    }
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    if (!KEY_RE.test(key.toLowerCase())) {
        throw new Error(`accelerator "${accelerator}" has an unsupported key "${key}"`);
    }
    const seen = new Set();
    for (const m of mods) {
        const lower = m.toLowerCase();
        if (!MODIFIERS.has(lower)) throw new Error(`accelerator "${accelerator}" has an unknown modifier "${m}"`);
        if (seen.has(lower)) throw new Error(`accelerator "${accelerator}" repeats modifier "${m}"`);
        seen.add(lower);
    }
    if (!mods.some(m => m.toLowerCase() !== 'shift')) {
        throw new Error(`accelerator "${accelerator}" needs a non-shift modifier`);
    }
    // Canonicalise casing: Title-case modifiers (with known special spellings),
    // upper-case single-letter keys, F-keys upper, named keys Title-case.
    const canonMod = (m) => {
        const l = m.toLowerCase();
        const map = {
            commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl',
            command: 'Command', cmd: 'Command', control: 'Control', ctrl: 'Control',
            alt: 'Alt', option: 'Option', altgr: 'AltGr', shift: 'Shift',
            super: 'Super', meta: 'Meta',
        };
        return map[l] || m;
    };
    const canonKey = (k) => {
        const l = k.toLowerCase();
        if (/^f[0-9]{1,2}$/.test(l)) return l.toUpperCase();
        if (l.length === 1) return l.toUpperCase();
        return l.charAt(0).toUpperCase() + l.slice(1);
    };
    return [...mods.map(canonMod), canonKey(key)].join('+');
}

function _slugOk(slug) {
    return typeof slug === 'string' && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(slug);
}

function configure({ configPath, onHotkeyChange } = {}) {
    _configPath = configPath || null;
    if (typeof onHotkeyChange === 'function') _onHotkeyChange = onHotkeyChange;
    _configured = true;
}

function _requireConfigured() {
    if (!_configured) throw new Error('skill-hotkeys not configured — call configure() first');
}

function _emit(action, slug, accelerator) {
    try { _onHotkeyChange({ action, slug, accelerator }); }
    catch (e) { /* main.js logs; never let a registration error corrupt state */ }
}

function _persist() {
    if (!_configPath) return;
    try {
        fs.mkdirSync(path.dirname(_configPath), { recursive: true });
        const hotkeys = [..._current.entries()].map(([slug, accelerator]) => ({ slug, accelerator }));
        fs.writeFileSync(_configPath, JSON.stringify({ hotkeys }, null, 2), 'utf-8');
    } catch (e) {
        // Non-fatal: registration still works in-memory for this session.
    }
}

/**
 * Replace the entire binding set. `mappings` is an array of
 * { slug, accelerator }. Invalid entries are skipped and reported. Performs a
 * minimal diff: only newly added / changed accelerators are (re)registered and
 * only removed ones are unregistered.
 *
 * @returns {{ registered: Array, skipped: Array }}
 */
function setAll(mappings) {
    _requireConfigured();
    if (!Array.isArray(mappings)) throw new TypeError('setAll expects an array');

    const desired = new Map();   // slug → normalised accelerator
    const skipped = [];
    const seenAccel = new Map(); // accelerator → slug (detect collisions)

    for (const m of mappings) {
        const slug = m && m.slug;
        if (!_slugOk(slug)) { skipped.push({ slug, reason: 'invalid slug' }); continue; }
        let accel;
        try { accel = normalizeAccelerator(m.accelerator); }
        catch (e) { skipped.push({ slug, reason: e.message }); continue; }
        if (seenAccel.has(accel)) {
            skipped.push({ slug, reason: `accelerator ${accel} already bound to "${seenAccel.get(accel)}"` });
            continue;
        }
        seenAccel.set(accel, slug);
        desired.set(slug, accel);
    }

    // Unregister anything not in desired, or whose accelerator changed.
    for (const [slug, accel] of [..._current.entries()]) {
        if (!desired.has(slug) || desired.get(slug) !== accel) {
            _emit('unregister', slug, accel);
            _current.delete(slug);
        }
    }
    // Register new / changed bindings.
    for (const [slug, accel] of desired.entries()) {
        if (_current.get(slug) === accel) continue; // unchanged
        _emit('register', slug, accel);
        _current.set(slug, accel);
    }

    _persist();
    return {
        registered: [..._current.entries()].map(([slug, accelerator]) => ({ slug, accelerator })),
        skipped,
    };
}

function list() {
    return [..._current.entries()].map(([slug, accelerator]) => ({ slug, accelerator }));
}

/**
 * Load persisted bindings from disk and register them. Called once from main.js
 * on startup. Silently no-ops if the config file is missing or malformed.
 */
function loadFromDisk() {
    _requireConfigured();
    if (!_configPath) return { registered: [], skipped: [] };
    let raw;
    try { raw = fs.readFileSync(_configPath, 'utf-8'); }
    catch { return { registered: [], skipped: [] }; }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return { registered: [], skipped: [] }; }
    const hotkeys = Array.isArray(parsed?.hotkeys) ? parsed.hotkeys : [];
    return setAll(hotkeys);
}

/** Test/reset hook: clears in-memory state WITHOUT emitting unregister events. */
function _reset() {
    _current.clear();
    _configPath = null;
    _onHotkeyChange = () => {};
    _configured = false;
}

module.exports = {
    configure,
    setAll,
    list,
    loadFromDisk,
    normalizeAccelerator,
    _reset,
};
