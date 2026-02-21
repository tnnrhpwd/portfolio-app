/**
 * Auto-Updater — Seamless background updates via GitHub Releases.
 *
 * Flow:
 *   1. Check for updates periodically (and shortly after startup)
 *   2. If available, download silently in the background
 *   3. Once downloaded, show a single quiet notification
 *   4. Install automatically the next time the user quits the app
 *      (or let them click "Restart & Update" from the tray if they want it now)
 *
 * Uses electron-updater with the "publish" config in package.json
 * (provider: "github", owner: "tnnrhpwd", repo: "C-Simple").
 */

const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// ─── Configure electron-updater ─────────────────────────────────────────────────

// Route updater logs to electron-log (written to ~/AppData/Roaming/CSimple Addon/logs/)
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Seamless: download in background automatically, install on next quit
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Don't require admin elevation for per-user installs
autoUpdater.allowDowngrade = false;

class UpdateManager {
  constructor() {
    this.trayManager = null;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.updateInfo = null;
    this.downloadProgress = 0;
    this.checkInterval = null;
    this._initialCheckTimer = null;
  }

  /**
   * Initialize the updater with a reference to the TrayManager.
   * @param {import('./tray').TrayManager} trayManager
   */
  init(trayManager) {
    this.trayManager = trayManager;
    this._registerEvents();
  }

  /**
   * Register autoUpdater event listeners.
   */
  _registerEvents() {
    autoUpdater.on('checking-for-update', () => {
      log.info('[Updater] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      const build = info.version.split('.').pop();
      log.info(`[Updater] Update available: Build #${build} (v${info.version})`);
      this.updateAvailable = true;
      this.updateInfo = info;

      // Silently update tray — no notification yet (download is automatic)
      this.trayManager?.setUpdateStatus('downloading', info.version, 0);
    });

    autoUpdater.on('update-not-available', () => {
      log.info('[Updater] App is up to date.');
      this.updateAvailable = false;
      this.updateInfo = null;
      this.trayManager?.setUpdateStatus('up-to-date');
    });

    autoUpdater.on('download-progress', (progress) => {
      this.downloadProgress = Math.round(progress.percent);
      // Update tray silently (no notification spam during download)
      this.trayManager?.setUpdateStatus('downloading', null, this.downloadProgress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      const build = info.version.split('.').pop();
      log.info(`[Updater] Update downloaded: Build #${build} (v${info.version})`);
      this.updateDownloaded = true;

      // Single, non-intrusive notification — the only one the user sees
      this.trayManager?.notify(
        'CSimple Addon Update Ready',
        `Build #${build} will install automatically when you close the app.`
      );

      this.trayManager?.setUpdateStatus('ready', info.version);
    });

    autoUpdater.on('error', (err) => {
      log.error('[Updater] Error:', err?.message || err);
      // Don't bother the user with update errors — just log and show in tray menu
      this.trayManager?.setUpdateStatus('error');
    });
  }

  /**
   * Check for updates once (download starts automatically if available).
   */
  checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[Updater] Check failed:', err?.message || err);
    });
  }

  /**
   * Start periodic update checks.
   * @param {number} intervalMs — default every 4 hours
   */
  startPeriodicChecks(intervalMs = 4 * 60 * 60 * 1000) {
    // Initial check after a short delay so startup isn't blocked
    this._initialCheckTimer = setTimeout(() => this.checkForUpdates(), 30 * 1000);

    // Recurring checks
    this.checkInterval = setInterval(() => this.checkForUpdates(), intervalMs);
  }

  /**
   * Stop all periodic and pending checks.
   */
  stopPeriodicChecks() {
    if (this._initialCheckTimer) {
      clearTimeout(this._initialCheckTimer);
      this._initialCheckTimer = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Immediately quit and install the downloaded update.
   * Called when the user explicitly clicks "Restart & Update" in the tray.
   */
  quitAndInstall() {
    if (!this.updateDownloaded) return;
    // isSilent = true  → no installer UI shown
    // isForceRunAfter = true → relaunch the app after install
    autoUpdater.quitAndInstall(true, true);
  }
}

module.exports = { UpdateManager };
