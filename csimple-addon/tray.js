/**
 * System Tray — Creates and manages the tray icon + context menu.
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
  }

  /**
   * Create the system tray icon.
   * @param {Object} callbacks
   * @param {Function} callbacks.onRestartServer
   * @param {Function} callbacks.onOpenSettings
   * @param {Function} callbacks.onSetupPython
   * @param {Function} callbacks.onQuit
   * @param {Function} callbacks.onCheckForUpdates
   * @param {Function} callbacks.onDownloadUpdate
   * @param {Function} callbacks.onInstallUpdate
   * @param {Function} callbacks.onOpenWebApp
   * @param {Function} callbacks.onOpenResources
   * @param {Function} callbacks.onChangeResourcesFolder
   * @param {Function} callbacks.onToggleStartAtLogin
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
    this.tray.setToolTip('CSimple Addon — Starting...');

    // Double-click tray icon opens the web app
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
    this.tray?.setToolTip(`CSimple Addon — Running on port ${port}`);
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
   * Update the update status display and refresh the menu.
   * @param {'idle'|'available'|'downloading'|'ready'|'error'|'up-to-date'} state
   * @param {string} [version]
   * @param {number} [progress]
   */
  setUpdateStatus(state, version, progress) {
    this.updateState = state;
    if (version) this.updateVersion = version;
    if (progress !== undefined) this.updateProgress = progress;
    this._updateMenu();
  }

  /**
   * Show a native notification.
   */
  notify(title, body) {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show();
    }
  }

  /**
   * Rebuild context menu.
   */
  _updateMenu() {
    if (!this.tray) return;

    const serverLabel = this.serverPort
      ? `Server: http://localhost:${this.serverPort}`
      : 'Server: Starting...';

    const httpsLabel = this.httpsPort
      ? `HTTPS: https://localhost:${this.httpsPort}`
      : 'HTTPS: Disabled';

    // Determine whether the app is set to launch at login
    const loginSettings = app.getLoginItemSettings();
    const startAtLogin = loginSettings.openAtLogin;

    const menu = Menu.buildFromTemplate([
      { label: 'CSimple Addon', enabled: false },
      { type: 'separator' },

      // ── Quick Actions ──
      {
        label: 'Open Web App',
        click: () => this.callbacks.onOpenWebApp?.(),
      },
      {
        label: 'Open Resources Folder',
        click: () => this.callbacks.onOpenResources?.(),
      },
      {
        label: 'Change Resources Folder...',
        click: () => this.callbacks.onChangeResourcesFolder?.(),
      },
      { type: 'separator' },

      // ── Status ──
      { label: serverLabel, enabled: false },
      { label: httpsLabel, enabled: false },
      { label: `Python: ${this.pythonStatus}`, enabled: false },
      { type: 'separator' },

      // ── Server / Python ──
      {
        label: 'Restart Server',
        click: () => this.callbacks.onRestartServer?.(),
      },
      {
        label: 'Setup Python Environment',
        click: () => this.callbacks.onSetupPython?.(),
      },
      { type: 'separator' },

      // ── Updates ──
      ...this._buildUpdateMenuItems(),
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
        label: 'Quit CSimple Addon',
        click: () => this.callbacks.onQuit?.(),
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  /**
   * Extract the build number from a version string. "1.0.15" → 15
   */
  _buildNum(version) {
    return version ? version.split('.').pop() : '?';
  }

  /**
   * Build the update-related menu items based on the current update state.
   */
  _buildUpdateMenuItems() {
    const b = this._buildNum(this.updateVersion);
    switch (this.updateState) {
      case 'downloading':
        return [
          { label: `Downloading Build #${b}... ${this.updateProgress}%`, enabled: false },
        ];
      case 'ready':
        return [
          { label: `Build #${b} ready — installs on quit`, enabled: false },
          { label: 'Restart && Update Now', click: () => this.callbacks.onInstallUpdate?.() },
        ];
      case 'error':
        return [
          { label: 'Update check failed', enabled: false },
          { label: 'Retry Update Check', click: () => this.callbacks.onCheckForUpdates?.() },
        ];
      case 'up-to-date':
        return [
          { label: 'App is up to date', enabled: false },
          { label: 'Check for Updates', click: () => this.callbacks.onCheckForUpdates?.() },
        ];
      default: // idle
        return [
          { label: 'Check for Updates', click: () => this.callbacks.onCheckForUpdates?.() },
        ];
    }
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
