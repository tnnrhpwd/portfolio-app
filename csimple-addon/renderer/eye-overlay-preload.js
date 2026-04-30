/**
 * CSimple Addon — Eye Overlay Preload
 *
 * Bridges gaze-data and online-training events to the click-through overlay
 * window. The overlay is read-only — it never sends commands back, only
 * receives gaze position updates to draw the floating dot.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onInit: (cb) => ipcRenderer.on('overlay-init', (_e, data) => cb(data)),
  onGaze: (cb) => ipcRenderer.on('gaze-data', (_e, data) => cb(data)),
  onTrainSample: (cb) => ipcRenderer.on('train-sample', (_e, data) => cb(data)),
  onModelUpdated: (cb) => ipcRenderer.on('model-updated', (_e, data) => cb(data)),
});
