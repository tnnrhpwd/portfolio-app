/**
 * CSimple Addon — Calibration Window Preload Script
 *
 * Exposes a safe IPC bridge for the calibration UI to communicate
 * with the main Electron process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calibrationAPI', {
  /**
   * Report that the user is now fixating on a calibration point.
   * The main process will forward this to the Python eye tracker.
   */
  reportPoint: (index, screenX, screenY) => {
    ipcRenderer.send('calibration-point-ready', { index, screenX, screenY });
  },

  /**
   * Request the main process to finalize calibration (compute homography).
   */
  finishCalibration: () => {
    ipcRenderer.send('calibration-finish');
  },

  /**
   * Listen for calibration progress updates from the Python process.
   */
  onProgress: (callback) => {
    ipcRenderer.on('calibration-progress', (_event, data) => callback(data));
  },

  /**
   * Listen for calibration completion.
   */
  onComplete: (callback) => {
    ipcRenderer.on('calibration-complete', (_event) => callback());
  },

  /**
   * Close the calibration window.
   */
  close: () => {
    ipcRenderer.send('calibration-close');
  },
});
