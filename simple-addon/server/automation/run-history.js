/**
 * run-history.js — local, append-only log of skill runs.
 *
 * Every /api/skill/run (manual, hotkey, or trigger-fired) appends one entry so
 * the dashboard can answer "did my 9am trigger actually run, and did it
 * succeed?" after the fact. The live run console only covers a run while it's
 * in flight, and the event ring buffer (events.js) doesn't survive a restart —
 * this is the durable, on-device record.
 *
 * Storage: <userData>/run-history.jsonl (one JSON object per line, oldest
 * first), capped at RUN_HISTORY_MAX entries. userData follows the same
 * convention as permissions.js (%APPDATA%/simple-addon, fallback ~/.simple-addon).
 *
 * The write path is deliberately best-effort: a failed history write must
 * never block or fail the underlying skill run.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const RUN_HISTORY_MAX = 200;

let _cache = null; // null = not loaded yet; [] = loaded-empty; [...] = loaded (newest first)

function _filePath() {
    const userData = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'simple-addon')
        : path.join(os.homedir(), '.simple-addon');
    return path.join(userData, 'run-history.jsonl');
}

function _load() {
    if (_cache !== null) return _cache;
    const file = _filePath();
    const entries = [];
    try {
        const raw = fs.readFileSync(file, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try { entries.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
        }
    } catch { /* no history yet, or unreadable — treat as empty */ }
    entries.reverse(); // newest first
    _cache = entries.slice(0, RUN_HISTORY_MAX);
    return _cache;
}

function _persist(list) {
    // list is newest-first; write oldest-first for a natural log order.
    const lines = list.length
        ? [...list].reverse().map(r => JSON.stringify(r)).join('\n') + '\n'
        : '';
    try {
        fs.mkdirSync(path.dirname(_filePath()), { recursive: true });
        fs.writeFileSync(_filePath(), lines, 'utf8');
    } catch { /* best-effort — never throw on a history write */ }
}

/**
 * Append one run record. Returns the normalized record (with sensible
 * defaults filled in), which also doubles as the stored shape.
 */
function append(entry = {}) {
    const list = _load();
    const startedAt = entry.startedAt || Date.now();
    const finishedAt = entry.finishedAt || startedAt;
    const record = {
        runId: entry.runId || null,
        slug: String(entry.slug || ''),
        startedAt,
        finishedAt,
        durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : (finishedAt - startedAt),
        stepsRun: entry.stepsRun ?? null,
        stepsTotal: entry.stepsTotal ?? null,
        failed: !!entry.failed,
        outcome: entry.outcome || (entry.failed ? 'failed' : 'done'),
        error: entry.error || null,
        triggerId: entry.triggerId || null,
        source: entry.source || 'manual', // manual | hotkey | trigger
    };
    list.unshift(record);
    if (list.length > RUN_HISTORY_MAX) list.length = RUN_HISTORY_MAX;
    _persist(list);
    return record;
}

/** Newest-first list of the most recent runs (capped at RUN_HISTORY_MAX). */
function list({ limit = 50 } = {}) {
    return _load().slice(0, Math.min(Number(limit) || 50, RUN_HISTORY_MAX));
}

/** Clear all recorded history (and the backing file). */
function clear() {
    _cache = [];
    try { fs.unlinkSync(_filePath()); } catch { /* already gone */ }
    return { ok: true };
}

/** Test hook: bust the in-memory cache so the next list/append re-reads disk. */
function _reset() { _cache = null; }

module.exports = { append, list, clear, _reset, RUN_HISTORY_MAX, _filePath };
