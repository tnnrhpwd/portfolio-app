/**
 * CSimple Addon — Electron Main Process
 * 
 * System tray application that runs the CSimple Express server locally.
 * No main window — tray-only app with status menu.
 */

const { app, BrowserWindow, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { TrayManager } = require('./tray');
const { PythonManager } = require('./python-manager');
const { ActionBridge } = require('./server/action-bridge');
const { UpdateManager } = require('./auto-updater');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ─── Globals ────────────────────────────────────────────────────────────────────

let trayManager = null;
let pythonManager = null;
let server = null;
let settingsWindow = null;
let actionBridge = null;
let updateManager = null;

// ─── Resource Paths ─────────────────────────────────────────────────────────────

const RESOURCES_PATH = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources');
const WEBAPP_URL = 'https://sthopwood.com/net';
const SCRIPTS_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(__dirname, 'scripts');
const REQUIREMENTS_PATH = path.join(SCRIPTS_PATH, 'requirements.txt');

// ─── Directory Setup ────────────────────────────────────────────────────────────

function ensureDirectories() {
  const dirs = [
    RESOURCES_PATH,
    path.join(RESOURCES_PATH, 'Behaviors'),
    path.join(RESOURCES_PATH, 'Memory'),
    path.join(RESOURCES_PATH, 'Personality'),
    path.join(RESOURCES_PATH, 'Agents'),
    path.join(RESOURCES_PATH, 'Agents', 'avatars'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[Main] Created directory: ${dir}`);
    }
  }

  // Create default behavior file if missing
  const defaultBehavior = path.join(RESOURCES_PATH, 'Behaviors', 'default.txt');
  if (!fs.existsSync(defaultBehavior)) {
    fs.writeFileSync(defaultBehavior, 
      'You are a helpful AI assistant. Be concise and informative in your responses.\n' +
      'If the user asks you to perform an action on their computer, translate it into a system command.\n',
      'utf-8'
    );
    console.log('[Main] Created default behavior file');
  }
}

// ─── Server Management ──────────────────────────────────────────────────────────

async function startExpressServer() {
  try {
    // Require the server module (lazy to allow path resolution)
    server = require('./server/index');
    const { port, httpsPort } = await server.startServer();

    console.log(`[Main] Server started on port ${port}`);
    trayManager?.setServerInfo(port, httpsPort);
    trayManager?.notify('CSimple Addon', `Server running on port ${port}`);

    // Start the built-in action bridge so PC automation works without a separate app
    if (!actionBridge) {
      actionBridge = new ActionBridge(port);
    }
    actionBridge.start();
    console.log('[Main] Built-in ActionBridge started');

    return { port, httpsPort };
  } catch (err) {
    console.error('[Main] Failed to start server:', err);
    trayManager?.notify('CSimple Addon Error', `Server failed to start: ${err.message}`);
    throw err;
  }
}

async function restartExpressServer() {
  try {
    trayManager?.setServerInfo(null, null);
    if (server) {
      await server.stopServer();
      server.stopGeneration();
    }

    // Re-require with cache clear
    const serverPath = require.resolve('./server/index');
    delete require.cache[serverPath];

    await startExpressServer();
  } catch (err) {
    console.error('[Main] Failed to restart server:', err);
  }
}

// ─── Python Setup ───────────────────────────────────────────────────────────────

async function setupPython() {
  pythonManager = new PythonManager();

  pythonManager.onStatus((status, detail) => {
    console.log(`[Python] ${status}: ${detail}`);
    trayManager?.setPythonStatus(`${status}${detail ? ' — ' + detail.substring(0, 50) : ''}`);

    // Show notification for key events
    if (status === 'error') {
      trayManager?.notify('CSimple — Python Error', detail);
    } else if (status === 'ready') {
      trayManager?.notify('CSimple — Python Ready', 'AI models can now run locally');
    }
  });

  const python = pythonManager.findPython();
  if (!python) {
    trayManager?.setPythonStatus('Not found — install Python 3.8+');
    trayManager?.notify(
      'CSimple — Python Not Found',
      'Local AI models require Python 3.8+. Download from python.org'
    );
    return;
  }

  trayManager?.setPythonStatus(`Found: ${python}`);

  // Setup venv and dependencies in background (don't block startup)
  pythonManager.setup(REQUIREMENTS_PATH).then(success => {
    if (success) {
      trayManager?.setPythonStatus('Ready');
    } else {
      trayManager?.setPythonStatus('Setup incomplete — check logs');
    }
  }).catch(err => {
    console.error('[Main] Python setup error:', err);
    trayManager?.setPythonStatus('Setup failed');
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────────

app.on('ready', async () => {
  console.log('[Main] CSimple Addon starting...');

  // Don't show in dock/taskbar (tray-only app)
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  // 1. Ensure directories exist
  ensureDirectories();

  // 2. Create system tray
  trayManager = new TrayManager();
  trayManager.create({
    onOpenWebApp: () => shell.openExternal(WEBAPP_URL),
    onOpenResources: () => shell.openPath(RESOURCES_PATH),
    onRestartServer: () => restartExpressServer(),
    onSetupPython: () => {
      if (pythonManager) {
        pythonManager.setup(REQUIREMENTS_PATH);
      }
    },
    onQuit: () => {
      app.quit();
    },
    onCheckForUpdates: () => updateManager?.checkForUpdates(),
    onInstallUpdate: () => updateManager?.quitAndInstall(),
    onToggleStartAtLogin: (enabled) => {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: app.getPath('exe'),
      });
      console.log(`[Main] Start at login: ${enabled}`);
    },
  });

  // Enable start-at-login by default on first run (use a marker file since
  // wasOpenedAtLogin is macOS-only and unreliable on Windows)
  const firstRunMarker = path.join(app.getPath('userData'), '.start-at-login-set');
  if (!fs.existsSync(firstRunMarker)) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: app.getPath('exe'),
    });
    fs.writeFileSync(firstRunMarker, new Date().toISOString(), 'utf-8');
    console.log('[Main] Enabled start-at-login (first run)');
  }

  // 2b. Initialize auto-updater
  updateManager = new UpdateManager();
  updateManager.init(trayManager);
  updateManager.startPeriodicChecks();

  // 3. Start Express server
  try {
    await startExpressServer();
  } catch (err) {
    console.error('[Main] Server startup failed:', err);
  }

  // 4. Setup Python (in background)
  setupPython();
});

// Prevent window-all-closed from quitting (tray app stays running)
app.on('window-all-closed', (e) => {
  // Do nothing — keep running in tray
});

app.on('before-quit', async (e) => {
  console.log('[Main] Shutting down...');

  // Stop update checks
  if (updateManager) {
    updateManager.stopPeriodicChecks();
  }

  // Stop the built-in action bridge
  if (actionBridge) {
    actionBridge.stop();
  }

  // Stop any running Python processes
  if (pythonManager) {
    pythonManager.cancelSetup();
  }

  // Stop the Express server
  if (server) {
    server.stopGeneration();
    await server.stopServer();
  }

  // Destroy tray so the process can fully exit (no lingering tray icon)
  trayManager?.destroy();
  trayManager = null;

  // Release the single-instance lock so the installer/updater can proceed
  app.releaseSingleInstanceLock();
});

// Handle second instance launch — just show a notification
app.on('second-instance', () => {
  trayManager?.notify('CSimple Addon', 'Already running in system tray');
});

// ─── Error Handling ─────────────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
  trayManager?.notify('CSimple Error', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});
