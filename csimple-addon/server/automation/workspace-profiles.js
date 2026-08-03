/**
 * Workspace Profiles — capture the current arrangement of visible windows
 * (which apps are open, where each window sits, its size, and its show
 * state) as a named, on-disk profile, then restore that exact arrangement
 * later on demand.
 *
 * Storage: one JSON file per profile under `configure({ storageDir })`,
 * named `<slug>.json`, mirroring the pattern used by
 * server/automation/recorder/index.js for on-disk, user-data storage.
 *
 * Restore strategy per saved window:
 *   1. Try to find a currently-running window that matches (same process
 *      name, preferring an exact title match) and hasn't already been
 *      claimed by an earlier entry in this restore pass.
 *   2. If none is running and the profile recorded an `exePath`, launch it
 *      via the existing `open_app` tool (which polls for the new window)
 *      and then apply the saved rect/state once it appears.
 *   3. Otherwise, report the window as skipped (nothing to restore it from).
 */

const fs = require('fs/promises');
const path = require('path');

const { windowSnapshot, windowSetRect } = require('./tools/system');
const { openApp } = require('./tools/open-app');

let _storageDir = null;

function configure({ storageDir }) {
    if (!storageDir) throw new Error('configure() requires storageDir');
    _storageDir = storageDir;
}

function _requireConfigured() {
    if (!_storageDir) {
        throw new Error('Workspace profiles not configured (storageDir is null) — call configure() from main.js after app.whenReady');
    }
}

/**
 * Turn a user-supplied name into a filesystem-safe slug while keeping the
 * original name for display (stored inside the JSON, not just the filename).
 */
function slugify(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Workspace name is required');
    const slug = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    if (!slug) throw new Error('Workspace name must contain at least one letter or number');
    return slug;
}

async function _filePath(name) {
    _requireConfigured();
    await fs.mkdir(_storageDir, { recursive: true });
    return path.join(_storageDir, `${slugify(name)}.json`);
}

/**
 * List saved profiles (metadata only — no window details) sorted by most
 * recently saved first.
 */
async function list() {
    _requireConfigured();
    await fs.mkdir(_storageDir, { recursive: true }).catch(() => {});
    const files = await fs.readdir(_storageDir).catch(() => []);
    const entries = [];
    for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
            const raw = await fs.readFile(path.join(_storageDir, f), 'utf-8');
            const data = JSON.parse(raw);
            entries.push({
                slug: f.replace(/\.json$/, ''),
                name: data.name || f.replace(/\.json$/, ''),
                savedAt: data.savedAt,
                windowCount: Array.isArray(data.windows) ? data.windows.length : 0,
            });
        } catch { /* skip unreadable/corrupt files */ }
    }
    entries.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    return entries;
}

async function get(name) {
    const full = await _filePath(name);
    const raw = await fs.readFile(full, 'utf-8');
    return JSON.parse(raw);
}

/**
 * Capture the current window layout and save it under `name`, overwriting
 * any existing profile with the same slug.
 */
async function save(name) {
    const slug = slugify(name);
    const { windows } = await windowSnapshot.run();
    // Drop windows with no exePath AND a title that looks like our own tray
    // helper windows — keep everything else; restore already tolerates
    // windows it can't relaunch by just skipping them.
    const profile = {
        name: String(name).trim(),
        savedAt: new Date().toISOString(),
        windows: windows.map(w => ({
            processName: w.processName,
            exePath: w.exePath || null,
            title: w.title,
            x: w.x, y: w.y, width: w.width, height: w.height,
            state: w.state,
        })),
    };
    const full = path.join(_storageDir, `${slug}.json`);
    await fs.mkdir(_storageDir, { recursive: true });
    await fs.writeFile(full, JSON.stringify(profile, null, 2), 'utf-8');
    return { slug, ...profile };
}

async function remove(name) {
    const full = await _filePath(name);
    await fs.unlink(full);
    return { ok: true, slug: slugify(name) };
}

/**
 * Re-capture the current window arrangement and overwrite an EXISTING saved
 * profile with it, keeping its original display name. Distinct from
 * `save()` (which the tray only exposes as "Save New…" for a fresh name) so
 * the user can refresh a profile in place without retyping its name.
 */
async function update(name) {
    const existing = await get(name); // throws if the profile doesn't exist
    return save(existing.name);
}

/**
 * Best-effort match of a saved window entry against the list of currently
 * running windows, excluding pids already claimed in this restore pass.
 */
function _findMatch(entry, running, claimed) {
    const candidates = running.filter(w => !claimed.has(w.pid) && w.processName === entry.processName);
    if (candidates.length === 0) return null;
    const exact = candidates.find(w => w.title === entry.title);
    return exact || candidates[0];
}

/**
 * Restore a saved profile: reposition already-running windows, launch and
 * then reposition missing ones (when an exePath was recorded), and report
 * anything that couldn't be handled.
 */
async function restore(name) {
    const profile = await get(name);
    const { windows: running } = await windowSnapshot.run();
    const claimed = new Set();
    const restored = [];
    const launched = [];
    const skipped = [];
    const errors = [];

    for (const entry of profile.windows) {
        try {
            const match = _findMatch(entry, running, claimed);
            if (match) {
                claimed.add(match.pid);
                await windowSetRect.run({
                    pid: match.pid,
                    x: entry.x, y: entry.y, width: entry.width, height: entry.height,
                    state: entry.state,
                });
                restored.push({ processName: entry.processName, title: entry.title });
                continue;
            }

            if (!entry.exePath) {
                skipped.push({ processName: entry.processName, title: entry.title, reason: 'not running and no launch path saved' });
                continue;
            }

            const launchResult = await openApp.run({
                name: entry.exePath,
                windowTitleContains: entry.title,
                focus: false,
            });
            if (launchResult && launchResult.windowFound && launchResult.pid) {
                claimed.add(launchResult.pid);
                await windowSetRect.run({
                    pid: launchResult.pid,
                    x: entry.x, y: entry.y, width: entry.width, height: entry.height,
                    state: entry.state,
                });
                launched.push({ processName: entry.processName, title: entry.title });
            } else {
                skipped.push({ processName: entry.processName, title: entry.title, reason: 'launched but window did not appear in time' });
            }
        } catch (e) {
            errors.push({ processName: entry.processName, title: entry.title, error: e.message });
        }
    }

    return {
        name: profile.name,
        restoredCount: restored.length,
        launchedCount: launched.length,
        skippedCount: skipped.length,
        errorCount: errors.length,
        restored, launched, skipped, errors,
    };
}

module.exports = { configure, slugify, list, get, save, remove, update, restore };
