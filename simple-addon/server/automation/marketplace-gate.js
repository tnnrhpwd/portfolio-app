/**
 * marketplace-gate.js — per-skill confirmation state for marketplace installs.
 *
 * docs/implementation/simple-agent-prompt.md §4.3 / §10.3: a skill installed
 * from the marketplace must not execute for real until the user has (a)
 * reviewed and confirmed its capability summary, and (b) — for low-trust
 * skills — completed a mandatory dry-run-first pass. This module persists that
 * state on-device (keyed by slug + version), so the addon enforces the gate
 * itself rather than trusting a forgetful client.
 *
 * State file: %APPDATA%/simple-addon/marketplace-gate.json
 *   { "records": { "<slug>@<version>": { "capabilitiesConfirmedAt": ISO|null,
 *                                          "dryRunCompletedAt": ISO|null } } }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function _gateFile() {
    const base = process.env.APPDATA
        ? path.join(process.env.APPDATA, 'simple-addon')
        : path.join(os.homedir(), '.simple-addon');
    return path.join(base, 'marketplace-gate.json');
}

let _cache = null;

function _key(slug, version) {
    return `${slug}@${version || 'unknown'}`;
}

function load() {
    if (_cache !== null) return _cache;
    try {
        const p = _gateFile();
        if (fs.existsSync(p)) {
            _cache = JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
        } else {
            _cache = {};
        }
    } catch {
        _cache = {};
    }
    if (!_cache || typeof _cache !== 'object') _cache = {};
    if (!_cache.records || typeof _cache.records !== 'object') _cache.records = {};
    return _cache;
}

function save(state) {
    _cache = state;
    try {
        const p = _gateFile();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[marketplace-gate] save failed:', e.message);
    }
    return state;
}

function _record(slug, version) {
    return load().records[_key(slug, version)] || null;
}

function capabilitiesConfirmed(slug, version) {
    const rec = _record(slug, version);
    return !!(rec && rec.capabilitiesConfirmedAt);
}

function confirmCapabilities(slug, version) {
    const state = load();
    const key = _key(slug, version);
    const rec = state.records[key] || {};
    rec.capabilitiesConfirmedAt = rec.capabilitiesConfirmedAt || new Date().toISOString();
    state.records[key] = rec;
    return save(state);
}

function dryRunCompleted(slug, version) {
    const rec = _record(slug, version);
    return !!(rec && rec.dryRunCompletedAt);
}

function markDryRunCompleted(slug, version) {
    const state = load();
    const key = _key(slug, version);
    const rec = state.records[key] || {};
    rec.dryRunCompletedAt = rec.dryRunCompletedAt || new Date().toISOString();
    state.records[key] = rec;
    return save(state);
}

/** Test-only: drop the in-memory cache so the next load() re-reads from disk. */
function _resetForTest() {
    _cache = null;
}

module.exports = {
    capabilitiesConfirmed,
    confirmCapabilities,
    dryRunCompleted,
    markDryRunCompleted,
    _resetForTest,
};
