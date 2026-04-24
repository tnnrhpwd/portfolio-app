/**
 * CSimple Addon — Calibration Window Preload Script
 *
 * Exposes a safe IPC bridge for the calibration UI to communicate
 * with the main Electron process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calibrationAPI', {
  reportPoint: (index, screenX, screenY, opts) => {
    ipcRenderer.send('calibration-point-ready', { index, screenX, screenY, opts });
  },

  finishCalibration: () => {
    ipcRenderer.send('calibration-finish');
  },

  startCalibration: (cameraIndex, displayId, optimize, cameraOptions) => {
    ipcRenderer.send('calibration-start', { cameraIndex, displayId, optimize: !!optimize, cameraOptions: cameraOptions || null });
  },

  getCameras: () => ipcRenderer.invoke('get-cameras'),

  getCameraSnapshot: (cameraIndex) => ipcRenderer.invoke('get-camera-snapshot', { cameraIndex }),

  getDisplays: () => ipcRenderer.invoke('get-displays'),

  getPriorCalibration: () => ipcRenderer.invoke('get-prior-calibration'),

  startValidationTracking: (cameraIndex, cameraOptions) => ipcRenderer.invoke('start-validation-tracking', { cameraIndex, cameraOptions: cameraOptions || null }),

  stopTracking: () => ipcRenderer.invoke('stop-tracking'),

  onProgress: (callback) => {
    ipcRenderer.on('calibration-progress', (_event, data) => callback(data));
  },

  onComplete: (callback) => {
    ipcRenderer.on('calibration-complete', (_event, data) => callback(data));
  },

  onGazeData: (callback) => {
    ipcRenderer.on('gaze-data', (_event, data) => callback(data));
  },

  close: () => {
    ipcRenderer.send('calibration-close');
  },
});
