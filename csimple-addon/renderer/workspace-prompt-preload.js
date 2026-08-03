/**
 * CSimple Addon — Workspace Name Prompt Preload Script
 *
 * Bridges the small "Save New Workspace" modal to the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workspacePromptAPI', {
  save: (name) => ipcRenderer.send('workspace-prompt-save', { name }),
  cancel: () => ipcRenderer.send('workspace-prompt-cancel'),
});
