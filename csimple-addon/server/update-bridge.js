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

let _updateManager = null;

function configure({ updateManager }) {
    _updateManager = updateManager || null;
}

/** Human-readable state derived from the UpdateManager's internal flags. */
function getStatus() {
    if (!_updateManager) {
        return { supported: false, state: 'unsupported', currentVersion: require('../package.json').version };
    }
    return {
        supported: true,
        // idle | checking | downloading | ready | up-to-date | error
        state: _updateManager.status || 'idle',
        updateAvailable: !!_updateManager.updateAvailable,
        updateDownloaded: !!_updateManager.updateDownloaded,
        downloadProgress: _updateManager.downloadProgress || 0,
        latestVersion: _updateManager.updateInfo?.version || null,
        currentVersion: require('../package.json').version,
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
