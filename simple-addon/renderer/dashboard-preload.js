/**
 * Dashboard — Preload Script
 *
 * Bridges the dashboard renderer to the main process for the handful of
 * things that live only in main-process memory (server/Python status,
 * resources folder, login-at-startup) or need native dialogs. Everything
 * else the dashboard needs (agent, recorder, workspace profiles,
 * permissions, ...) goes through the local Express server via `fetch`,
 * same as the existing renderer pages (permissions.html, recordings.html).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('simpleDashboard', {
  getStatus: () => ipcRenderer.invoke('dashboard:get-status'),
  restartServer: () => ipcRenderer.invoke('dashboard:restart-server'),
  setupPython: () => ipcRenderer.invoke('dashboard:setup-python'),
  openResourcesFolder: () => ipcRenderer.invoke('dashboard:open-resources-folder'),
  changeResourcesFolder: () => ipcRenderer.invoke('dashboard:change-resources-folder'),
  getStartAtLogin: () => ipcRenderer.invoke('dashboard:get-start-at-login'),
  setStartAtLogin: (enabled) => ipcRenderer.invoke('dashboard:set-start-at-login', enabled),
  getEyeTrackingStatus: () => ipcRenderer.invoke('dashboard:get-eye-tracking-status'),
  toggleEyeTracking: (enabled) => ipcRenderer.invoke('dashboard:toggle-eye-tracking', enabled),
  toggleEyeOverlay: (enabled) => ipcRenderer.invoke('dashboard:toggle-eye-overlay', enabled),
  emergencyStopEyeTracking: () => ipcRenderer.invoke('dashboard:emergency-stop-eye-tracking'),
  calibrateEyeTracking: () => ipcRenderer.invoke('dashboard:calibrate-eye-tracking'),
  onStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('dashboard:status-changed', listener);
    return () => ipcRenderer.removeListener('dashboard:status-changed', listener);
  },
});
