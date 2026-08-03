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
 * Restore strategy:
 *   1. Match every saved window entry against every currently-running
 *      window in one pass (see `_matchAll`): candidates must share a
 *      process name and a compatible exePath, then the best-scoring
 *      (title-similarity) pairs are committed first so each entry and each
 *      running window is used at most once — this avoids mis-assigning
 *      saved rects between multiple windows of the same app (e.g. two VS
 *      Code windows for different projects).
 *   2. If a saved entry has no match and it recorded an `exePath`, launch
 *      it via the existing `open_app` tool (which polls for the new
 *      window) and then apply the saved rect/state once it appears.
 *   3. Otherwise, report the window as skipped (nothing to restore it from).
 *
 * Every placement applied in step 1/2 is verified against what actually
 * landed (not just trusted from a fire-and-forget async Win32 call) and
 * retried once if it's off — see `_applyAndVerify`.
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
 * Start / widgets host), TextInputHost (touch keyboard / IME host),
 * BingWallpaper (Windows' built-in live-wallpaper widget), and
 * msedgewebview2 (a generic WebView2 host process — in practice either an
 * embedded control inside another app's real window, or one of these same
 * desktop/widget-engine hosts; never a top-level window worth restoring by
 * name). tools/system.js excludes these at capture time (via DWM cloak
 * checks and a full-virtual-screen-bounds heuristic for wallpaper/widget
 * engines), but filter here too — both so save() can never persist one even
 * if that check ever misses a case, and so restore() can neutralize any
 * that were already captured by an older build. Two real incidents traced
 * to this: forcing SetWindowPlacement on a shell/UWP host destabilizes the
 * shell itself (all open windows appear frozen); forcing it on a
 * full-screen desktop-parented widget host (e.g. the Bing Wallpaper
 * msedgewebview2 process) hung/crashed CSimple Addon's own window instead
 * (vanished from Alt-Tab, unrecoverable without a force-kill), even though
 * Explorer itself stayed up.
 */
const SHELL_HOST_DENYLIST = new Set([
    'ShellExperienceHost', 'ApplicationFrameHost', 'TextInputHost',
    'SearchHost', 'StartMenuExperienceHost', 'ShellHost', 'BingWallpaper',
    'msedgewebview2',
]);

/**
 * CSimple Addon's own process name (e.g. "CSimple Addon" in the packaged
 * build, "electron" in dev), derived from the running exe rather than
 * hardcoded so it stays correct if the product is ever renamed.
 *
 * tools/system.js already excludes our own pid at the source (it runs
 * inside the Electron main process, which owns every BrowserWindow's HWND),
 * but this JS-side check is a backstop for profiles saved by an older build
 * — e.g. one captured while the "Save New Workspace" prompt itself was on
 * screen. Applying SetWindowPlacement to our own window desyncs Electron's
 * internal show/focus state from the OS's: the window can go permanently
 * invisible (missing from Alt-Tab, un-recoverable via tray/show()) until the
 * whole app is force-killed and relaunched — the second crash reproduction,
 * where Explorer itself survived but CSimple Addon's own window vanished.
 */
const OWN_PROCESS_NAME = path.basename(process.execPath, path.extname(process.execPath));

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
            .filter(w => !SHELL_HOST_DENYLIST.has(w.processName) && w.processName !== OWN_PROCESS_NAME)
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
 * Split a window title into lowercase word-ish tokens for similarity
 * scoring — punctuation like the " - " separators Windows apps commonly use
 * between document/workspace name and app name is treated as whitespace.
 */
function _titleTokens(title) {
    return String(title || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/**
 * Jaccard similarity (0..1) between two window titles' token sets. Used to
 * pick the *closest* running window when a saved entry's title isn't an
 * exact match (e.g. it changed slightly since save — an unsaved-changes
 * dot, a different active file) rather than falling back to an arbitrary
 * "first" candidate that happens to share the same process name.
 */
function _titleSimilarity(a, b) {
    if (a === b) return 1;
    const ta = new Set(_titleTokens(a));
    const tb = new Set(_titleTokens(b));
    if (ta.size === 0 || tb.size === 0) return 0;
    let intersection = 0;
    for (const t of ta) if (tb.has(t)) intersection++;
    const union = new Set([...ta, ...tb]).size;
    return union === 0 ? 0 : intersection / union;
}

/**
 * False only when both sides recorded an exePath and they clearly disagree.
 * Distinct apps sometimes share a generic processName (many Electron apps
 * run as "electron" in dev, some run as their packaged name only in
 * production, PWA-style apps can share "msedge"/"chrome", etc.) — when both
 * exePaths are known, requiring them to match prevents matching a saved
 * entry from one app to a same-processName window that's actually a
 * *different* app. When either side lacks an exePath there's not enough
 * information to disqualify the pair, so it's left to title similarity.
 */
function _exePathsCompatible(entryExePath, candidateExePath) {
    if (!entryExePath || !candidateExePath) return true;
    return String(entryExePath).toLowerCase() === String(candidateExePath).toLowerCase();
}

/**
 * Match every saved window entry against the currently running windows in
 * one pass, instead of matching each entry independently in saved order.
 *
 * Matching entries one at a time (greedily claiming the first same-
 * processName candidate) is order-dependent and can easily assign the
 * wrong saved rect to the wrong window whenever two or more windows share a
 * processName — e.g. two VS Code windows for different projects: whichever
 * saved entry happens to be processed first grabs whichever running window
 * happens to be listed first, and if that isn't an exact title match, the
 * two windows can get their positions swapped (or worse, "similarly named"
 * unrelated windows get paired up).
 *
 * Instead, this scores every (entry, running window) pair that shares a
 * processName and has a compatible exePath, then greedily commits pairs
 * highest-score first — so the best-matching pair overall always wins a
 * conflict, and every entry gets assigned at most one distinct window (and
 * vice versa).
 *
 * Returns a Map from entry index -> matched running window (or undefined if
 * unmatched).
 */
function _matchAll(entries, running) {
    const pairs = [];
    entries.forEach((entry, entryIndex) => {
        running.forEach((win, winIndex) => {
            if (win.processName !== entry.processName) return;
            if (!_exePathsCompatible(entry.exePath, win.exePath)) return;
            const score = entry.title === win.title ? 1 : _titleSimilarity(entry.title, win.title);
            pairs.push({ entryIndex, winIndex, score });
        });
    });
    // Highest-confidence pairs first; ties broken by original order so
    // results stay deterministic.
    pairs.sort((a, b) => b.score - a.score || a.entryIndex - b.entryIndex || a.winIndex - b.winIndex);

    const matches = new Map();
    const claimedEntries = new Set();
    const claimedWindows = new Set();
    for (const { entryIndex, winIndex, score } of pairs) {
        if (claimedEntries.has(entryIndex) || claimedWindows.has(winIndex)) continue;
        matches.set(entryIndex, running[winIndex]);
        claimedEntries.add(entryIndex);
        claimedWindows.add(winIndex);
    }
    return matches;
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

// How many times to re-apply a placement that didn't land where requested
// before giving up and reporting it as inaccurate, instead of just trusting
// the first SetWindowPlacement call.
const MAX_PLACEMENT_ATTEMPTS = 2;

/**
 * Call window_set_rect for `pid` and verify the placement actually landed
 * where requested, retrying up to MAX_PLACEMENT_ATTEMPTS times.
 *
 * window_set_rect's underlying SetWindowPlacement call is deliberately
 * async (see tools/system.js for why a synchronous call risks wedging the
 * target/crashing explorer.exe), which means it can return before the
 * target thread has actually processed the request. Several real apps
 * (Electron/Chromium windows especially — VS Code, Slack, Discord, etc.)
 * also reassert THEIR OWN remembered window bounds shortly after being
 * shown or focused, silently overwriting whatever we just set. Either way,
 * trusting a single fire-and-forget call was producing restores that
 * "looked" successful but actually left the window at the wrong spot —
 * this re-reads the window's actual resulting placement (reported back by
 * window_set_rect) and, if it doesn't match the saved target within
 * tolerance, tries again rather than silently reporting success.
 *
 * Returns `{ accurate, result }` where `result` is the last window_set_rect
 * response and `accurate` is true only if the final attempt's reported
 * placement matches the target within PLACEMENT_TOLERANCE_PX.
 */
async function _applyAndVerify(entry, pid) {
    let result = null;
    for (let attempt = 1; attempt <= MAX_PLACEMENT_ATTEMPTS; attempt++) {
        result = await windowSetRect.run({
            pid, x: entry.x, y: entry.y, width: entry.width, height: entry.height, state: entry.state,
        });
        await _sleep(RESTORE_THROTTLE_MS);
        // Older/stubbed window_set_rect implementations may not report back
        // actual* fields (e.g. the test double) — treat that as unverifiable
        // rather than a mismatch, so behavior for those stays unchanged.
        if (!result || result.actualX === undefined) return { accurate: true, result };
        const accurate = _placementMatches(entry, {
            x: result.actualX, y: result.actualY, width: result.actualWidth, height: result.actualHeight, state: result.actualState,
        });
        if (accurate) return { accurate: true, result };
    }
    return { accurate: false, result };
}

/**
 * Restore a saved profile: reposition already-running windows, launch and
 * then reposition missing ones (when an exePath was recorded), and report
 * anything that couldn't be handled.
 */
async function restore(name) {
    const profile = await get(name);
    const { windows: running } = await windowSnapshot.run();
    // Resolve all entry-to-window matches up front (see _matchAll) so the
    // best-fitting pair always wins, rather than matching one entry at a
    // time in saved order.
    const matches = _matchAll(profile.windows, running);
    const restored = [];
    const alreadyInPlace = [];
    const launched = [];
    const skipped = [];
    const errors = [];
    const inaccurate = [];

    for (let i = 0; i < profile.windows.length; i++) {
        const entry = profile.windows[i];
        try {
            if (SHELL_HOST_DENYLIST.has(entry.processName)) {
                skipped.push({ processName: entry.processName, title: entry.title, reason: 'shell/system host window — not a restorable app window' });
                continue;
            }
            if (entry.processName === OWN_PROCESS_NAME) {
                skipped.push({ processName: entry.processName, title: entry.title, reason: 'CSimple Addon\'s own window — never repositioned to avoid desyncing Electron\'s window state' });
                continue;
            }
            const match = matches.get(i);
            if (match) {
                if (_placementMatches(entry, match)) {
                    // Nothing to do — see _placementMatches for why we
                    // deliberately avoid calling SetWindowPlacement here.
                    alreadyInPlace.push({ processName: entry.processName, title: entry.title });
                    continue;
                }
                const { accurate } = await _applyAndVerify(entry, match.pid);
                if (accurate) {
                    restored.push({ processName: entry.processName, title: entry.title });
                } else {
                    inaccurate.push({ processName: entry.processName, title: entry.title, reason: `did not land within ${PLACEMENT_TOLERANCE_PX}px of the saved position after ${MAX_PLACEMENT_ATTEMPTS} attempts — the app may be reasserting its own remembered window bounds` });
                }
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
                const { accurate } = await _applyAndVerify(entry, launchResult.pid);
                if (accurate) {
                    launched.push({ processName: entry.processName, title: entry.title });
                } else {
                    inaccurate.push({ processName: entry.processName, title: entry.title, reason: `launched, but did not land within ${PLACEMENT_TOLERANCE_PX}px of the saved position after ${MAX_PLACEMENT_ATTEMPTS} attempts — the app may apply its own remembered window bounds on startup` });
                }
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
        inaccurateCount: inaccurate.length,
        errorCount: errors.length,
        restored, alreadyInPlace, launched, skipped, inaccurate, errors,
    };
}

module.exports = { configure, slugify, list, get, save, remove, update, restore };
