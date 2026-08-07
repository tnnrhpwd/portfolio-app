/**
 * System Tray — Creates and manages the tray icon + context menu.
 *
 * Most addon functionality lives in the unified Dashboard window (see
 * renderer/dashboard.html + main.js's openDashboard()) — this menu is
 * intentionally kept small: quick launchers, passive status glances the
 * dashboard IPC handlers read directly (serverPort/httpsPort/pythonStatus/
 * eyeTrackingState/eyeOverlayActive), and a couple of one-click safety
 * actions that must keep working even if the dashboard window itself fails
 * to open.
 */

const { Tray, Menu, nativeImage, Notification, shell, app } = require('electron');
const path = require('path');

class TrayManager {
  constructor() {
    this.tray = null;
    this.serverPort = null;
    this.httpsPort = null;
    this.pythonStatus = 'checking...';
    this.callbacks = {};
    this.updateState = 'idle';        // idle | available | downloading | ready | error | up-to-date
    this.updateVersion = null;
    this.updateProgress = 0;
    this.eyeTrackingState = 'idle';   // idle | running | calibrating | error
    this.eyeOverlayActive = false;    // overlay (test mode) on/off
    this.notificationSettings = null; // { system, updates, python, automation, eyeTracking, voice } — set via setNotificationSettings()
  }

  /**
   * Create the system tray icon.
   * @param {Object} callbacks
   * @param {Function} callbacks.onOpenDashboard — called with an optional initial tab id
   * @param {Function} callbacks.onOpenWebApp
   * @param {Function} callbacks.onQuit
   * @param {Function} callbacks.onToggleStartAtLogin
   * @param {Function} callbacks.onKillSwitch
   * @param {Function} callbacks.onEmergencyStopEyeTracking
   */
  create(callbacks = {}) {
    this.callbacks = callbacks;

    // Create a simple icon (16x16 colored square as fallback)
    let icon;
    const iconPath = path.join(__dirname, 'resources', 'icon.png');
    try {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) throw new Error('Empty icon');
    } catch {
      // Create a simple 16x16 green icon as fallback
      icon = nativeImage.createFromBuffer(this._createFallbackIcon());
    }

    // Resize for tray (16x16 on Windows)
    icon = icon.resize({ width: 16, height: 16 });

    this.tray = new Tray(icon);
    this.tray.setToolTip('Simple Addon — Starting...');

    // Single-click opens the dashboard (the primary way into the addon's UI);
    // double-click keeps opening the web app for anyone used to that gesture.
    this.tray.on('click', () => {
      this.callbacks.onOpenDashboard?.();
    });
    this.tray.on('double-click', () => {
      this.callbacks.onOpenWebApp?.();
    });

    this._updateMenu();

    return this.tray;
  }

  /**
   * Update server port info and refresh the menu.
   */
  setServerInfo(port, httpsPort) {
    this.serverPort = port;
    this.httpsPort = httpsPort;
    this.tray?.setToolTip(`Simple Addon — Running on port ${port}`);
    this._updateMenu();
  }

  /**
   * Update the Python status display.
   */
  setPythonStatus(status) {
    this.pythonStatus = status;
    this._updateMenu();
  }

  /**
   * Update the update status. Still called by auto-updater.js on every
   * state transition — kept so that path doesn't need to know the tray
   * menu no longer displays update state directly (the Dashboard's Updates
   * tab reads this from the HTTP update-bridge instead).
   * @param {'idle'|'available'|'downloading'|'ready'|'error'|'up-to-date'} state
   * @param {string} [version]
   * @param {number} [progress]
   */
  setUpdateStatus(state, version, progress) {
    this.updateState = state;
    if (version) this.updateVersion = version;
    if (progress !== undefined) this.updateProgress = progress;
  }

  /**
   * Update the eye tracking status display.
   */
  setEyeTrackingStatus(state) {
    this.eyeTrackingState = state;
    this._updateMenu();
  }

  /**
   * Update the overlay (test mode) toggle state.
   */
  setEyeOverlayActive(active) {
    this.eyeOverlayActive = !!active;
    this._updateMenu();
  }

  /**
   * Update the user's notification preferences (see main.js's
   * get/saveNotificationSettings). Checked on every notify() call so a
   * change takes effect immediately without needing a restart.
   */
  setNotificationSettings(settings) {
    this.notificationSettings = settings || null;
  }

  /**
   * Show a native notification.
   * @param {string} title
   * @param {string} body
   * @param {string} [category] — one of 'system' | 'updates' | 'python' |
   *   'automation' | 'eyeTracking' | 'voice'. When provided and the user has
   *   disabled that category in Settings, the notification is suppressed.
   *   Omit for safety-critical notifications (kill switch, crashes) that
   *   should never be suppressible.
   */
  notify(title, body, category) {
    if (category && this.notificationSettings && this.notificationSettings[category] === false) return;
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show();
    }
  }

  /**
   * Rebuild context menu.
   */
  _updateMenu() {
    if (!this.tray) return;

    // Determine whether the app is set to launch at login
    const loginSettings = app.getLoginItemSettings();
    const startAtLogin = loginSettings.openAtLogin;

    const menu = Menu.buildFromTemplate([
      { label: 'Simple Addon', enabled: false },
      { type: 'separator' },

      // ── Quick Actions ──
      {
        label: 'Open Dashboard',
        click: () => this.callbacks.onOpenDashboard?.(),
      },
      {
        label: 'Open Web App',
        click: () => this.callbacks.onOpenWebApp?.(),
      },
      { type: 'separator' },

      // ── Safety-critical (kept one-click even if the dashboard fails to open) ──
      {
        label: 'EMERGENCY: Kill Switch (block all tools)',
        click: () => this.callbacks.onKillSwitch?.(),
      },
      {
        label: 'Eye Tracking Emergency Stop  (Esc / Ctrl+Alt+E)',
        enabled: this.eyeTrackingState === 'running' || this.eyeTrackingState === 'calibrating',
        click: () => this.callbacks.onEmergencyStopEyeTracking?.(),
      },
      { type: 'separator' },

      // ── Settings ──
      {
        label: 'Start at Login',
        type: 'checkbox',
        checked: startAtLogin,
        click: (menuItem) => this.callbacks.onToggleStartAtLogin?.(menuItem.checked),
      },
      { type: 'separator' },

      // ── Quit ──
      {
        label: 'Quit Simple Addon',
        click: () => this.callbacks.onQuit?.(),
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  /**
   * Create a simple 16x16 RGBA buffer for a fallback tray icon (green circle).
   */
  _createFallbackIcon() {
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    const cx = size / 2;
    const cy = size / 2;
    const r = 6;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist <= r) {
          buf[idx] = 0x4C;     // R
          buf[idx + 1] = 0xAF; // G
          buf[idx + 2] = 0x50; // B
          buf[idx + 3] = 0xFF; // A
        } else {
          buf[idx + 3] = 0x00; // Transparent
        }
      }
    }

    // Convert raw RGBA to a PNG via nativeImage
    const img = nativeImage.createFromBuffer(buf, { width: size, height: size });
    return img.toPNG();
  }

  /**
   * Destroy the tray icon.
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = { TrayManager };
