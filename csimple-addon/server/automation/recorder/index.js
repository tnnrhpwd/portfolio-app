/**
 * Process-wide singleton wrapper around RecorderSession. Only one recording
 * may be active at a time — recording is a foreground, user-driven operation
 * and concurrent recordings would conflict on the global cursor poll.
 *
 * Also provides list/read helpers for previously saved recordings, used by
 * both the renderer UI and the skill compiler.
 */

const fs = require('fs/promises');
const path = require('path');
const { RecorderSession } = require('./session');

let _current = null;          // active RecorderSession or null
let _recordingsDir = null;    // resolved on first use

function configure({ recordingsDir }) {
    if (!recordingsDir) throw new Error('configure() requires recordingsDir');
    _recordingsDir = recordingsDir;
}

function _requireConfigured() {
    if (!_recordingsDir) {
        throw new Error('Recorder not configured (recordingsDir is null) — call configure() from main.js after app.whenReady');
    }
}

async function start({ name }) {
    _requireConfigured();
    if (_current) throw new Error('A recording is already active');
    const session = new RecorderSession({ name, recordingsDir: _recordingsDir });
    const info = await session.start();
    _current = session;
    return info;
}

async function stop() {
    if (!_current) throw new Error('No active recording');
    const result = await _current.stop();
    _current = null;
    return result;
}

function status() {
    if (!_current) return { active: false };
    return _current.status();
}

function appendMarker(label) {
    if (!_current) throw new Error('No active recording');
    _current.appendMarker(label);
    return { ok: true };
}

async function list() {
    _requireConfigured();
    try { await fs.mkdir(_recordingsDir, { recursive: true }); } catch {}
    const files = await fs.readdir(_recordingsDir).catch(() => []);
    const entries = [];
    for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(_recordingsDir, f);
        try {
            const stat = await fs.stat(full);
            entries.push({
                sessionId: f.replace(/\.jsonl$/, ''),
                file: f,
                path: full,
                bytes: stat.size,
                modifiedAt: stat.mtimeMs,
            });
        } catch {}
    }
    entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return entries;
}

async function read(sessionId) {
    _requireConfigured();
    if (!sessionId || /[\\/]/.test(sessionId)) throw new Error('Invalid sessionId');
    const full = path.join(_recordingsDir, `${sessionId}.jsonl`);
    const raw = await fs.readFile(full, 'utf-8');
    const events = [];
    let header = null, footer = null;
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try {
            const obj = JSON.parse(t);
            if (obj.type === 'header') header = obj;
            else if (obj.type === 'footer') footer = obj;
            else events.push(obj);
        } catch {}
    }
    return { sessionId, header, footer, events };
}

async function remove(sessionId) {
    _requireConfigured();
    if (!sessionId || /[\\/]/.test(sessionId)) throw new Error('Invalid sessionId');
    const full = path.join(_recordingsDir, `${sessionId}.jsonl`);
    await fs.unlink(full);
    return { ok: true, sessionId };
}

module.exports = {
    configure,
    start,
    stop,
    status,
    appendMarker,
    list,
    read,
    remove,
};
