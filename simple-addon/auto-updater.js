/**
 * Auto-Updater — Seamless background updates via GitHub Releases.
 *
 * Flow:
 *   1. Check for updates periodically (and shortly after startup)
 *   2. If available, download silently in the background
 *   3. Once downloaded, show a single quiet notification
 *   4. Install **only when the user asks** — "Restart & Update" in the tray, or
 *      the Dashboard's Updates tab. Never on quit: see the note on
 *      autoInstallOnAppQuit below.
 *
 * Uses electron-updater with the "publish" config in package.json
 * (provider: "github", owner: "tnnrhpwd", repo: "Simple").
 */

const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { readBuildInfo } = require('./build-info');

// ─── Configure electron-updater ─────────────────────────────────────────────────

// Route updater logs to electron-log (written to ~/AppData/Roaming/Simple Addon/logs/)
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Download in the background; install only on an explicit user action.
//
// ⚠️ Why `autoInstallOnAppQuit` is OFF: Windows shuts an app down by *killing*
// it, and it does that to the whole session at once. With install-on-quit on, a
// downloaded update started the NSIS installer during that teardown — the
// installer (and anything it launched) then can't initialise while win32k is
// going away, so the install can be cut off half-applied and the shutdown is
// left showing process-start errors. The downloaded package survives on disk
// either way, so the user installs it when they choose: tray → "Restart &
// Update" (tray.js) or the Dashboard's Updates tab → server/update-bridge.js.
//
// Seamless half of the deal: download in the background, no prompts.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

// Don't require admin elevation for per-user installs
autoUpdater.allowDowngrade = false;

// See _checkForStaleVersion() below for why this grace period exists: it
// absorbs the normal few-minutes gap between write-build-info.js's prebuild
// timestamp and electron-builder's own releaseDate stamp within the *same*
// CI run, so the "possibly stale" warning only fires for genuine same-version
// republishes (which happen well after the original build, e.g. a manual
// re-upload), not on every ordinary up-to-date check.
const STALE_VERSION_GRACE_MS = 60 * 60 * 1000; // 1 hour

// Retry policy for *transient* update-check failures (see _isTransientError).
// The classic case: a new GitHub release is created the moment CI starts
// publishing, but latest.yml is only uploaded at the very end — so for the
// several minutes the build is still running, `releases/latest` already points
// at the new version while its latest.yml 404s (ERR_UPDATER_CHANNEL_FILE_NOT_FOUND).
// These are retried with backoff and NOT surfaced to the user as errors; only
// after the attempts below are exhausted (or on a genuinely fatal error) does
// the status become "error".
const TRANSIENT_RETRY_BASE_MS = 20 * 1000;      // first retry after 20s
const TRANSIENT_RETRY_MAX_MS = 2 * 60 * 1000;   // cap each retry at 2 min
const MAX_TRANSIENT_RETRIES = 6;                // ~8 min of retries, covers a full CI build

/**
 * This build's own identity — see ./build-info.js. Returns null in
 * dev/unpackaged runs, or if an older build predates that file existing.
 */
function readOwnBuildInfo() {
  return readBuildInfo();
}

class UpdateManager {
  constructor() {
    this.trayManager = null;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.updateInfo = null;
    this.downloadProgress = 0;
    this.checkInterval = null;
    this._initialCheckTimer = null;
    this._retryTimer = null;
    this._retryDelay = TRANSIENT_RETRY_BASE_MS;
    this._transientFailures = 0;
    // The last *good* state reached (up-to-date / ready), restored while a
    // transient failure is being retried so the UI doesn't flash an error.
    this._lastKnownStatus = 'idle';
    // Explicit state machine mirrored to the HTTP bridge (server/update-bridge.js)
    // so the web UI can distinguish "haven't checked yet" from "checked, no
    // update found" — updateAvailable/updateDownloaded alone can't tell them apart.
    this.status = 'idle'; // idle | checking | downloading | ready | up-to-date | error
    // Secondary safety net alongside the semver check (see readOwnBuildInfo
    // above): set when a release's own releaseDate is newer than this
    // build's own builtAt despite electron-updater reporting "up to date" —
    // a strong sign a release was published without bumping the version.
    this.possibleStaleVersion = false;
    this.ownBuildInfo = readOwnBuildInfo();

    // The newest PUBLISHED release this updater has seen, whether or not it is
    // newer than the running build — electron-updater only emits
    // `update-available` when it is, but it still hands the latest release info
    // to `update-not-available`. The dashboard shows it as "published online"
    // beneath this build's rev, which is the whole point: a local build that is
    // AHEAD of everyone else can still say what everyone else is running.
    this.publishedInfo = null;
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
   * Compare a release's own releaseDate (from electron-updater's UpdateInfo)
   * against this build's own builtAt. Only meaningful when both are present
   * (i.e. this build has build-info.json, and the release's latest.yml
   * included a releaseDate) — silently skipped otherwise.
   *
   * A grace period is required here: `builtAt` is stamped by
   * write-build-info.js as a *prebuild* step (before electron-builder runs),
   * while a release's `releaseDate` is stamped by electron-builder itself
   * *during* packaging (later in the very same CI run that produced this
   * exact build). That means `releaseDate` is unavoidably a few minutes
   * after `builtAt` for every normal, correctly-versioned release — without
   * a grace period this check would report "possibly stale" on every single
   * up-to-date build, not just genuine same-version republishes. A gap
   * bigger than a full CI build (well beyond that normal packaging delay)
   * is what actually indicates someone re-published a release under the
   * same version number after this build was originally compiled.
   */
  _checkForStaleVersion(info) {
    if (!this.ownBuildInfo?.builtAt || !info?.releaseDate) return;
    const released = new Date(info.releaseDate).getTime();
    const built = new Date(this.ownBuildInfo.builtAt).getTime();
    if (
      Number.isFinite(released) && Number.isFinite(built) &&
      released - built > STALE_VERSION_GRACE_MS
    ) {
      this.possibleStaleVersion = true;
      log.warn(
        `[Updater] Release v${info.version} (published ${info.releaseDate}) is newer than this build ` +
        `(v${this.ownBuildInfo.version}, built ${this.ownBuildInfo.builtAt}) by more than the ` +
        `${STALE_VERSION_GRACE_MS / 60000}-minute grace period despite matching version numbers — ` +
        `the version bump was likely skipped when that release was published.`
      );
    } else {
      this.possibleStaleVersion = false;
    }
  }

  /**
   * Whether a check/download failure is a *transient* condition worth retrying
   * silently (vs. a fatal config/version error that should surface).
   */
  _isTransientError(err) {
    if (!err) return true;
    const code = err.code;
    // latest.yml not uploaded yet — the new release is still being built/published
    if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') return true;
    // No published release yet (e.g. the very first release is still mid-build)
    if (code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') return true;
    if (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') return true;

    // 5xx / 429 (rate limit) are transient; 4xx (auth/not found) are not.
    if (typeof err.statusCode === 'number') {
      return err.statusCode === 429 || err.statusCode >= 500;
    }

    const msg = String(err.message || err).toLowerCase();
    return /etimedout|econnreset|econnrefused|enotfound|eai_again|enetunreach|ehostunreach|network|socket hang up|temporary|timeout|proxy/i.test(msg);
  }

  /**
   * Schedule the next automatic re-check, doubling the delay each time up to
   * TRANSIENT_RETRY_MAX_MS.
   */
  _scheduleRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    const delay = Math.min(this._retryDelay, TRANSIENT_RETRY_MAX_MS);
    this._retryDelay = Math.min(this._retryDelay * 2, TRANSIENT_RETRY_MAX_MS);
    log.info(`[Updater] Retrying update check in ${Math.round(delay / 1000)}s...`);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.checkForUpdates();
    }, delay);
  }

  /**
   * Reset the transient-failure counters after any successful outcome.
   */
  _resetTransientFailures() {
    this._transientFailures = 0;
    this._retryDelay = TRANSIENT_RETRY_BASE_MS;
  }

  /**
   * Register autoUpdater event listeners.
   */
  _registerEvents() {
    autoUpdater.on('checking-for-update', () => {
      log.info('[Updater] Checking for updates...');
      this.status = 'checking';
    });

    autoUpdater.on('update-available', (info) => {
      const build = info.version.split('.').pop();
      log.info(`[Updater] Update available: Build #${build} (v${info.version})`);
      this.updateAvailable = true;
      this.updateInfo = info;
      this.publishedInfo = info;
      this.status = 'downloading';
      this.possibleStaleVersion = false; // a genuinely newer version was found
      this._resetTransientFailures();

      // Silently update tray — no notification yet (download is automatic)
      this.trayManager?.setUpdateStatus('downloading', info.version, 0);
    });

    autoUpdater.on('update-not-available', (info) => {
      log.info('[Updater] App is up to date.');
      this.updateAvailable = false;
      this.updateInfo = null;
      // `info` here is the latest RELEASE (that is what the stale-version check
      // below compares against). Keep the previous value when an older
      // electron-updater build emits this event without it.
      this.publishedInfo = info || this.publishedInfo;
      this.status = 'up-to-date';
      this._lastKnownStatus = 'up-to-date';
      this._resetTransientFailures();
      this._checkForStaleVersion(info);
      this.trayManager?.setUpdateStatus('up-to-date');
    });

    autoUpdater.on('download-progress', (progress) => {
      this.downloadProgress = Math.round(progress.percent);
      this.status = 'downloading';
      // Update tray silently (no notification spam during download)
      this.trayManager?.setUpdateStatus('downloading', null, this.downloadProgress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      const build = info.version.split('.').pop();
      log.info(`[Updater] Update downloaded: Build #${build} (v${info.version})`);
      this.updateDownloaded = true;
      this.status = 'ready';
      this._lastKnownStatus = 'ready';
      this._resetTransientFailures();

      // Single, non-intrusive notification — the only one the user sees.
      // It has to name the action now: nothing installs on its own.
      this.trayManager?.notify(
        'Simple Addon Update Ready',
        `Build #${build} is ready to install — tray → "Restart & Update".`,
        'updates'
      );

      this.trayManager?.setUpdateStatus('ready', info.version);
    });

    autoUpdater.on('error', (err) => {
      const message = err?.message || String(err);

      if (this._isTransientError(err)) {
        this._transientFailures += 1;
        log.warn(
          `[Updater] Transient update failure (${this._transientFailures}/${MAX_TRANSIENT_RETRIES}): ${message} — ` +
          'will retry in the background.'
        );

        // Keep showing the last good state instead of flashing an error while
        // a new release is still uploading its assets.
        this.status = this._lastKnownStatus;

        if (this._transientFailures < MAX_TRANSIENT_RETRIES) {
          this._scheduleRetry();
        } else {
          log.error(`[Updater] Giving up after ${this._transientFailures} transient failures: ${message}`);
          this.status = 'error';
          this.trayManager?.setUpdateStatus('error');
        }
        return;
      }

      log.error('[Updater] Error:', message);
      this.status = 'error';
      // Fatal errors surface in the tray/dashboard (transient ones are retried silently)
      this.trayManager?.setUpdateStatus('error');
    });
  }

  /**
   * Check for updates once (download starts automatically if available).
   */
  checkForUpdates() {
    // A manual check supersedes any pending automatic retry.
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    autoUpdater.checkForUpdates().catch((err) => {
      // The 'error' event above handles classification/retry — this just
      // swallows the rejected promise so nothing escapes as unhandled.
      log.debug('[Updater] Check failed:', err?.message || err);
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
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
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

module.exports = { UpdateManager, readOwnBuildInfo };
