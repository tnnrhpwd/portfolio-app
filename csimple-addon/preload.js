/**
 * CSimple Addon — Preload Script
 * 
 * Bridges the renderer (settings window) to the main process via contextBridge.
 * Currently minimal since the app is tray-only with no settings window.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('csimpleAddon', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  restartServer: () => ipcRenderer.invoke('restart-server'),
  getVersion: () => ipcRenderer.invoke('get-version'),
});
