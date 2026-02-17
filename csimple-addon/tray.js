/**
 * System Tray — Creates and manages the tray icon + context menu.
 */

const { Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');

class TrayManager {
  constructor() {
    this.tray = null;
    this.serverPort = null;
    this.httpsPort = null;
    this.pythonStatus = 'checking...';
    this.callbacks = {};
  }

  /**
   * Create the system tray icon.
   * @param {Object} callbacks
   * @param {Function} callbacks.onRestartServer
   * @param {Function} callbacks.onOpenSettings
   * @param {Function} callbacks.onSetupPython
   * @param {Function} callbacks.onQuit
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
   * Show a native notification.
   */
  notify(title, body) {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: true }).show();
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

    const menu = Menu.buildFromTemplate([
      { label: 'CSimple Addon', enabled: false },
      { type: 'separator' },
      { label: serverLabel, enabled: false },
      { label: httpsLabel, enabled: false },
      { label: `Python: ${this.pythonStatus}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Restart Server',
        click: () => this.callbacks.onRestartServer?.(),
      },
      {
        label: 'Setup Python Environment',
        click: () => this.callbacks.onSetupPython?.(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
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
