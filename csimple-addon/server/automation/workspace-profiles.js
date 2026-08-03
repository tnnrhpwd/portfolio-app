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
 * Windows shell/system host processes that can appear in Get-Process's
 * window list (non-zero MainWindowHandle + non-empty title) despite not
 * being real, user-visible app windows — e.g. the UWP "ApplicationFrameHost"
 * proxy frame and its hosted pane, ShellExperienceHost (Action Center /
 * Start / widgets host), and TextInputHost (touch keyboard / IME host).
 * tools/system.js excludes these at capture time (via DWM cloak checks),
 * but filter here too — both so save() can never persist one even if that
 * check ever misses a case, and so restore() can neutralize any that were
 * already captured by an older build (the actual cause of a restore
 * appearing to "crash" every open program: forcing SetWindowPlacement on a
 * window the shell intentionally hides desyncs the shell/UWP frame and
 * destabilizes everything on screen).
 */
const SHELL_HOST_DENYLIST = new Set([
    'ShellExperienceHost', 'ApplicationFrameHost', 'TextInputHost',
    'SearchHost', 'StartMenuExperienceHost', 'ShellHost',
]);

/**
 * Capture the current window layout and save it under `name`, overwriting
 * any existing profile with the same slug.
 */
async function save(name) {
    const slug = slugify(name);
    const { windows } = await windowSnapshot.run();
    // Drop windows with no exePath AND a title that looks like our own tray
    // helper windows — keep everything else; restore already tolerates
    // windows it can't relaunch by just skipping them. Also drop shell/
    // system host windows (see SHELL_HOST_DENYLIST) — tools/system.js
    // already excludes these via DWM cloak checks, but filter here too so
    // save() can never persist one even if that check ever misses a case.
    const profile = {
        name: String(name).trim(),
        savedAt: new Date().toISOString(),
        windows: windows
            .filter(w => !SHELL_HOST_DENYLIST.has(w.processName))
            .map(w => ({
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

// Pixel tolerance for treating a running window's current placement as
// "already matching" the saved entry, so restore() can skip calling
// SetWindowPlacement on it entirely.
const PLACEMENT_TOLERANCE_PX = 8;

/**
 * True when `match` (a currently-running window, as returned by
 * windowSnapshot) is already close enough to `entry` (the saved target)
 * that repositioning it would be a visible no-op.
 *
 * This exists because repeatedly calling SetWindowPlacement — even with
 * coordinates identical to the window's current placement — has been
 * observed to destabilize explorer.exe (Windows Event Log: "The shell
 * stopped unexpectedly and userinit.exe was restarted", logged at the exact
 * moment of a restore). When Explorer dies mid-restore every open window
 * appears frozen/unresponsive (while their processes, and any audio they're
 * playing, keep running underneath) until Explorer respawns and/or the user
 * force-kills the confused apps — this is what "restore crashed everything"
 * actually was. The most common restore case is a no-op (the user's saved
 * layout is still current), so skipping the call whenever nothing would
 * actually change eliminates the crash in exactly that scenario and cuts
 * total SetWindowPlacement calls (and therefore risk) on every other run.
 */
function _placementMatches(entry, match) {
    if (String(entry.state || 'normal') !== String(match.state || 'normal')) return false;
    const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= PLACEMENT_TOLERANCE_PX;
    return near(entry.x, match.x) && near(entry.y, match.y)
        && near(entry.width, match.width) && near(entry.height, match.height);
}

// Small pause between successive SetWindowPlacement calls within one
// restore pass — a defensive throttle against hammering the shell's window
// placement notifications back-to-back (see _placementMatches for why that
// matters).
const RESTORE_THROTTLE_MS = 200;
const _sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    const alreadyInPlace = [];
    const launched = [];
    const skipped = [];
    const errors = [];

    for (const entry of profile.windows) {
        try {
            if (SHELL_HOST_DENYLIST.has(entry.processName)) {
                skipped.push({ processName: entry.processName, title: entry.title, reason: 'shell/system host window — not a restorable app window' });
                continue;
            }
            const match = _findMatch(entry, running, claimed);
            if (match) {
                claimed.add(match.pid);
                if (_placementMatches(entry, match)) {
                    // Nothing to do — see _placementMatches for why we
                    // deliberately avoid calling SetWindowPlacement here.
                    alreadyInPlace.push({ processName: entry.processName, title: entry.title });
                    continue;
                }
                await windowSetRect.run({
                    pid: match.pid,
                    x: entry.x, y: entry.y, width: entry.width, height: entry.height,
                    state: entry.state,
                });
                await _sleep(RESTORE_THROTTLE_MS);
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
                await _sleep(RESTORE_THROTTLE_MS);
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
        alreadyInPlaceCount: alreadyInPlace.length,
        launchedCount: launched.length,
        skippedCount: skipped.length,
        errorCount: errors.length,
        restored, alreadyInPlace, launched, skipped, errors,
    };
}

module.exports = { configure, slugify, list, get, save, remove, update, restore };
