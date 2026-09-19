/**
 * Chat — Preload Script
 *
 * Bridges the chat renderer to the main process for the two things that need native
 * help: opening a link in the user's real browser instead of a stray Electron window,
 * and revealing a local file the agent mentioned. Both take a string out of a MODEL'S
 * REPLY, which is why the scheme check lives in the main process.
 *
 * The chat has no navigation of its own — getting to the dashboard or the web app is the
 * tray's job — so there is no bridge for it here.
 *
 * **Nothing about the agent goes through here.** The chat talks to the addon's own
 * local HTTP server (`/api/agent/run`, `/api/agent/events`, `/api/automation/*`)
 * exactly as the dashboard's panels do, because that server is where the loop and
 * the permission gate actually live. An IPC channel for it would be a second path
 * to the same thing, and the second path is always the one that gets forgotten.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('simpleChat', {
  /**
   * Open an http(s) link in the user's real browser.
   *
   * The main process validates the scheme — a renderer can be talked into emitting
   * any string by whatever the model wrote, and `shell.openExternal` will happily
   * act on a `file://` or a shell URI.
   */
  openExternal: (url) => ipcRenderer.invoke('chat:open-external', url),

  /** Reveal a local path (a Windows path the agent mentioned) in Explorer. */
  openPath: (targetPath) => ipcRenderer.invoke('chat:open-path', targetPath),
});
