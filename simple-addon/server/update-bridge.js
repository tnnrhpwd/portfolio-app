/**
 * update-bridge.js — HTTP-reachable bridge to the Electron-side auto-updater
 * (auto-updater.js / electron-updater), so the web frontend can drive a
 * single-click "Update" flow instead of sending the user to the GitHub
 * releases page.
 *
 * main.js calls `configure({ updateManager })` once it constructs the
 * `UpdateManager` singleton (before the Express server starts routing
 * requests). server/index.js requires this module and exposes it over
 * `/api/update/*` — kept as a thin module (rather than passing the manager
 * directly into server/index.js) so route registration doesn't depend on
 * initialization order between main.js and the lazily-required server.
 */

const { readBuildInfo } = require('../build-info');
const { getRev } = require('../scripts/rev-version');

let _updateManager = null;

function configure({ updateManager }) {
    _updateManager = updateManager || null;
}

/**
 * What this build is: its rev, and where it came from.
 *
 * channel:
 *   'local'   — built by scripts/build-local.js; published to nobody yet
 *   'release' — built by the release workflow (or an older build predating the stamp)
 *   'dev'     — running from source, so there is no packaged build to describe
 */
function localBuild() {
    const version = require('../package.json').version;
    // The manager caches its own copy at construction; fall back to the file when
    // there is no manager (unsupported/headless) so the rev is still reported.
    const info = _updateManager?.ownBuildInfo || readBuildInfo();
    return {
        version,
        rev: getRev(version),
        channel: info?.channel || 'dev',
        builtAt: info?.builtAt || null,
    };
}

/** Human-readable state derived from the UpdateManager's internal flags. */
function getStatus() {
    const local = localBuild();

    // The newest PUBLISHED release, as last reported by an update check — whether
    // or not it is newer than this build. This is what lets the dashboard put
    // "this build" above "published online" and say which way the gap runs.
    const published = _updateManager?.publishedInfo || null;

    const shared = {
        currentVersion: local.version, // kept: the existing UI reads this name
        rev: local.rev,
        channel: local.channel,
        builtAt: local.builtAt,
        publishedVersion: published?.version || null,
        publishedRev: published?.version ? getRev(published.version) : null,
        publishedAt: published?.releaseDate || null,
    };

    if (!_updateManager) {
        return { supported: false, state: 'unsupported', ...shared };
    }

    return {
        supported: true,
        // idle | checking | downloading | ready | up-to-date | error
        state: _updateManager.status || 'idle',
        updateAvailable: !!_updateManager.updateAvailable,
        updateDownloaded: !!_updateManager.updateDownloaded,
        downloadProgress: _updateManager.downloadProgress || 0,
        latestVersion: _updateManager.updateInfo?.version || null,
        // Secondary safety net (see auto-updater.js's _checkForStaleVersion):
        // true if a release with this same version number was published
        // *after* this build was actually compiled — a sign the version
        // bump was skipped when that release went out, so "up to date"
        // above may not actually be true.
        possibleStaleVersion: !!_updateManager.possibleStaleVersion,
        ...shared,
    };
}

/** Kick off a check (download starts automatically if a newer build exists). */
function checkForUpdates() {
    if (!_updateManager) throw new Error('updater not initialized yet — try again in a moment');
    _updateManager.checkForUpdates();
}

/** Quit and install the already-downloaded update, relaunching the app. */
function installUpdate() {
    if (!_updateManager) throw new Error('updater not initialized yet — try again in a moment');
    if (!_updateManager.updateDownloaded) throw new Error('update has not finished downloading yet');
    _updateManager.quitAndInstall();
}

module.exports = { configure, getStatus, checkForUpdates, installUpdate };
