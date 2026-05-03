/**
 * CSimple Addon — Electron Main Process
 * 
 * System tray application that runs the CSimple Express server locally.
 * No main window — tray-only app with status menu.
 */

const { app, BrowserWindow, Notification, shell, dialog, ipcMain, globalShortcut } = require('electron');
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
let calibrationWindow = null;
let eyeOverlayWindow = null;       // transparent click-through gaze dot
let eyeOverlayAutoTrain = null;    // {timer, lastSampleAt, lastCursor, lastCursorAt, lastGaze, lastGazeAt}

// ─── Resource Paths ─────────────────────────────────────────────────────────────

const CONFIG_DIR = app.getPath('userData');
const RESOURCES_CONFIG_PATH = path.join(CONFIG_DIR, 'resources-path.json');
const DEFAULT_RESOURCES_PATH = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources');

/**
 * Read the stored resources folder location, or return the default.
 */
function getResourcesPath() {
  try {
    if (fs.existsSync(RESOURCES_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(RESOURCES_CONFIG_PATH, 'utf-8'));
      if (config.resourcesPath && fs.existsSync(path.dirname(config.resourcesPath))) {
        return config.resourcesPath;
      }
    }
  } catch (err) {
    console.error('[Main] Error reading resources config:', err.message);
  }
  return DEFAULT_RESOURCES_PATH;
}

/**
 * Persist the resources folder location.
 */
function saveResourcesPath(resourcesPath) {
  try {
    fs.writeFileSync(RESOURCES_CONFIG_PATH, JSON.stringify({ resourcesPath }, null, 2), 'utf-8');
    console.log(`[Main] Resources path saved: ${resourcesPath}`);
  } catch (err) {
    console.error('[Main] Error saving resources config:', err.message);
  }
}

/**
 * Prompt user to choose resources folder (first run only).
 * Returns the chosen path, or the default if the user cancels.
 */
async function promptResourcesFolder() {
  const result = await dialog.showMessageBox(null, {
    type: 'question',
    title: 'CSimple Addon — Resources Folder',
    message: 'Where would you like to store CSimple data?',
    detail: `This folder holds your memory, personality, behavior files, and agents.\n\nDefault: ${DEFAULT_RESOURCES_PATH}`,
    buttons: ['Use Default', 'Choose Folder', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });

  if (result.response === 1) {
    const folderResult = await dialog.showOpenDialog(null, {
      title: 'Choose CSimple Resources Folder',
      defaultPath: DEFAULT_RESOURCES_PATH,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!folderResult.canceled && folderResult.filePaths.length > 0) {
      return folderResult.filePaths[0];
    }
  }
  return DEFAULT_RESOURCES_PATH;
}

/**
 * Let user change resources folder via dialog. Moves existing files.
 */
async function changeResourcesFolder() {
  const currentPath = getResourcesPath();
  const folderResult = await dialog.showOpenDialog(null, {
    title: 'Change CSimple Resources Folder',
    defaultPath: currentPath,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (folderResult.canceled || folderResult.filePaths.length === 0) return;
  const newPath = folderResult.filePaths[0];
  if (newPath === currentPath) return;

  // Move existing files if the old folder exists
  try {
    if (fs.existsSync(currentPath)) {
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        const src = path.join(currentPath, item);
        const dest = path.join(newPath, item);
        if (!fs.existsSync(dest)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }
      console.log(`[Main] Copied resources from ${currentPath} → ${newPath}`);
    }
  } catch (err) {
    console.error('[Main] Error moving resources:', err.message);
  }

  saveResourcesPath(newPath);
  // Expose updated path so the server can pick it up
  global.CSIMPLE_RESOURCES_PATH = newPath;

  trayManager?.notify('CSimple Addon', `Resources folder changed to:\n${newPath}\n\nRestarting server...`);
  await restartExpressServer();
}

// Make resources path available to server modules
let RESOURCES_PATH = getResourcesPath();
global.CSIMPLE_RESOURCES_PATH = RESOURCES_PATH;

const WEBAPP_URL = 'https://sthopwood.com/net';
const SCRIPTS_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(__dirname, 'scripts');
const REQUIREMENTS_PATH = path.join(SCRIPTS_PATH, 'requirements.txt');

// ─── Directory Setup ────────────────────────────────────────────────────────────

function ensureDirectories() {
  const rp = getResourcesPath();
  const dirs = [
    rp,
    path.join(rp, 'Behaviors'),
    path.join(rp, 'Memory'),
    path.join(rp, 'Personality'),
    path.join(rp, 'Agents'),
    path.join(rp, 'Agents', 'avatars'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[Main] Created directory: ${dir}`);
    }
  }

  // Create default behavior file if missing
  const defaultBehavior = path.join(rp, 'Behaviors', 'default.txt');
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

    // Wire up eye tracking state changes to tray menu + Escape e-stop
    if (server.eyeTrackingManager) {
      // Register a PERSISTENT global emergency-stop hotkey that always works —
      // even if focus is elsewhere and even when tracking isn't actively running
      // (so the user can hit it preemptively if the cursor is acting up).
      try {
        globalShortcut.register('CommandOrControl+Alt+E', () => {
          console.log('[EyeTracking] Ctrl+Alt+E — emergency stop');
          server.eyeTrackingManager.stop().catch(() => {});
          trayManager?.notify('Eye Tracking', 'Emergency stop (Ctrl+Alt+E) — tracking halted.');
        });
      } catch (e) { console.error('[EyeTracking] Failed to register Ctrl+Alt+E:', e.message); }

      server.eyeTrackingManager.onStateChange = (state) => {
        trayManager?.setEyeTrackingStatus(state);
        // If tracking stopped while overlay was active, tear the overlay down
        // (e.g. user hit Escape / Ctrl+Alt+E to emergency-stop).
        if (state === 'idle' && eyeOverlayWindow) {
          _stopOverlayAutoTrain();
          closeEyeOverlayWindow();
          trayManager?.setEyeOverlayActive(false);
        }
        // Register Escape as additional emergency stop while tracking is active
        if (state === 'running') {
          try {
            globalShortcut.register('Escape', () => {
              console.log('[EyeTracking] ESCAPE pressed — emergency stop');
              server.eyeTrackingManager.stop();
            });
          } catch (e) { console.error('[EyeTracking] Failed to register Escape shortcut:', e.message); }
          trayManager?.notify(
            'Eye Tracking Active',
            'Emergency stop: press Escape or Ctrl+Alt+E anytime to halt cursor control.'
          );
        } else {
          globalShortcut.unregister('Escape');
        }
      };
    }

    // Expose calibration window opener as a global so the server can invoke it
    global.openCalibrationWindow = () => openCalibrationWindow();

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

// ─── Eye Tracking Calibration ────────────────────────────────────────────────────

/**
 * Open the fullscreen calibration window and start collecting calibration data.
 */
function openCalibrationWindow() {
  if (calibrationWindow) {
    calibrationWindow.focus();
    return;
  }

  const iconPath = path.join(__dirname, 'resources', 'icon.ico');

  calibrationWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0f',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'calibration-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  calibrationWindow.loadFile(path.join(__dirname, 'renderer', 'calibration.html'));

  calibrationWindow.on('closed', () => {
    calibrationWindow = null;
    // Stop calibration if still running
    if (server?.eyeTrackingManager?.state === 'calibrating') {
      server.eyeTrackingManager.stop();
    }
  });

  // Forward calibration progress from Python to the renderer
  if (server?.eyeTrackingManager) {
    server.eyeTrackingManager.onCalibrationProgress = (data) => {
      if (calibrationWindow && !calibrationWindow.isDestroyed()) {
        if (data.calibration === 'complete') {
          calibrationWindow.webContents.send('calibration-complete', {
            iris_range_x: data.iris_range_x,
            iris_range_y: data.iris_range_y,
            num_points: data.num_points,
            model_type: data.model_type,
            mean_residual_px: data.mean_residual_px,
            max_residual_px: data.max_residual_px,
            worst_point: data.worst_point,
            hom_mean_residual_px: data.hom_mean_residual_px,
            poly_mean_residual_px: data.poly_mean_residual_px,
          });
        } else {
          calibrationWindow.webContents.send('calibration-progress', data);
        }
      }
    };
  }

  console.log('[Main] Calibration window opened');
}

// ─── Eye Tracking Overlay (Test Mode) ────────────────────────────────────────────
//
// The overlay is a click-through transparent fullscreen-virtual-desktop window
// that draws a colored dot at the user's predicted gaze location. It does NOT
// move the OS cursor. While it's active we run an implicit-calibration loop
// that pairs the OS cursor with the live gaze whenever both have been
// stationary together — this lets the model continuously refit as the user
// moves their head into poses the original calibration grid never covered.

function _virtualScreenBounds() {
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const b = d.bounds;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  if (!isFinite(minX)) {
    const p = screen.getPrimaryDisplay().bounds;
    return { x: p.x, y: p.y, width: p.width, height: p.height };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function openEyeOverlayWindow() {
  if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
    eyeOverlayWindow.focus();
    return eyeOverlayWindow;
  }
  const bounds = _virtualScreenBounds();
  eyeOverlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'eye-overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // Make it click-through so it never steals input.
  eyeOverlayWindow.setIgnoreMouseEvents(true, { forward: false });
  eyeOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  // Don't activate the window or its WebContents.
  try { eyeOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}

  eyeOverlayWindow.loadFile(path.join(__dirname, 'renderer', 'eye-overlay.html'));
  eyeOverlayWindow.once('ready-to-show', () => {
    eyeOverlayWindow.showInactive();
    // Re-assert after show (some Windows builds reset ignoreMouseEvents).
    eyeOverlayWindow.setIgnoreMouseEvents(true, { forward: false });
    // Send virtual screen origin so renderer can map global → window coords.
    eyeOverlayWindow.webContents.send('overlay-init', { origin: { x: bounds.x, y: bounds.y } });
  });
  eyeOverlayWindow.on('closed', () => {
    eyeOverlayWindow = null;
  });
  return eyeOverlayWindow;
}

function closeEyeOverlayWindow() {
  if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
    eyeOverlayWindow.close();
  }
  eyeOverlayWindow = null;
}

function _stopOverlayAutoTrain() {
  if (eyeOverlayAutoTrain && eyeOverlayAutoTrain.timer) {
    clearInterval(eyeOverlayAutoTrain.timer);
  }
  eyeOverlayAutoTrain = null;
}

// Hotkeys exposed only while the overlay is active. Give the user explicit
// override over the auto-train heuristic so they can force-capture a sample
// when they KNOW they're looking at the cursor, or undo a bad capture.
function _registerOverlayHotkeys() {
  try {
    globalShortcut.register('CommandOrControl+Shift+G', () => {
      const { screen } = require('electron');
      const cur = screen.getCursorScreenPoint();
      const res = server?.eyeTrackingManager?.addOnlineTrainingSample(cur.x, cur.y, 0.9);
      if (res?.success) {
        if (eyeOverlayAutoTrain) {
          eyeOverlayAutoTrain.lastSampleAt = Date.now();
          eyeOverlayAutoTrain.sampleCount++;
        }
        if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
          eyeOverlayWindow.webContents.send('train-sample', {
            x: cur.x, y: cur.y, weight: 0.9,
            count: eyeOverlayAutoTrain?.sampleCount || 0,
            forced: true,
          });
        }
      }
    });
    globalShortcut.register('CommandOrControl+Shift+U', () => {
      server?.eyeTrackingManager?.dropRecentOnlineSamples(1);
      if (eyeOverlayAutoTrain && eyeOverlayAutoTrain.sampleCount > 0) {
        eyeOverlayAutoTrain.sampleCount--;
      }
      if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
        eyeOverlayWindow.webContents.send('train-sample', {
          x: 0, y: 0, weight: 0,
          count: eyeOverlayAutoTrain?.sampleCount || 0,
          undone: true,
        });
      }
    });
    globalShortcut.register('CommandOrControl+Shift+R', () => {
      server?.eyeTrackingManager?.clearOnlineSamples();
      if (eyeOverlayAutoTrain) eyeOverlayAutoTrain.sampleCount = 0;
      if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
        eyeOverlayWindow.webContents.send('train-sample', {
          x: 0, y: 0, weight: 0,
          count: 0,
          cleared: true,
        });
      }
    });
  } catch (e) {
    console.warn('[EyeOverlay] Failed to register hotkeys:', e.message);
  }
}

function _unregisterOverlayHotkeys() {
  try {
    globalShortcut.unregister('CommandOrControl+Shift+G');
    globalShortcut.unregister('CommandOrControl+Shift+U');
    globalShortcut.unregister('CommandOrControl+Shift+R');
  } catch {}
}

/**
 * Implicit-calibration loop. Polls the OS cursor at ~50ms and uses the most
 * recent gaze emission (fed via onGazeData) to detect "fixation pairs" — the
 * cursor and the gaze both stationary together. When a stable pair is found
 * we fire `addOnlineTrainingSample`, which the Python tracker uses to refit.
 */
function _startOverlayAutoTrain() {
  _stopOverlayAutoTrain();
  const { screen } = require('electron');
  const POLL_MS = 50;
  const CURSOR_STILL_MS = 450;          // cursor must be stationary this long
  const GAZE_STILL_MS = 350;            // gaze must be stationary this long
  const CURSOR_RADIUS_PX = 6;           // movement under this = "still"
  const GAZE_RADIUS_PX = 50;            // gaze jitter that still counts as fixation
  const SAMPLE_COOLDOWN_MS = 1500;      // min interval between fired samples
  // Stricter trust: the LIVE gaze prediction (i.e. the model's current
  // estimate) must already be near the cursor. This is much tighter than
  // "some fraction of the screen" and effectively requires the user to be
  // looking at the cursor, since otherwise the model wouldn't predict near
  // the cursor's location. Combined with cursor-movement evidence below,
  // this rejects the common false-positive of "cursor parked while user
  // reads something elsewhere on screen".
  const TRUST_RADIUS_PX = 180;
  // Cursor-movement evidence: require the cursor to have actually moved a
  // meaningful distance recently (user intent), then settled. A parked
  // cursor that the user isn't looking at won't fire samples.
  const CURSOR_MOVE_WINDOW_MS = 1800;
  const CURSOR_MOVE_MIN_PX = 80;
  const CURSOR_MOVE_MAX_PX = 2500;

  eyeOverlayAutoTrain = {
    timer: null,
    lastSampleAt: 0,
    cursorAnchor: null,
    cursorAnchorAt: 0,
    gazeAnchor: null,
    gazeAnchorAt: 0,
    lastGaze: null,
    lastGazeAt: 0,
    sampleCount: 0,
    cursorTrail: [],   // [{x,y,t}] last few seconds of cursor positions
  };

  eyeOverlayAutoTrain.timer = setInterval(() => {
    if (!server?.eyeTrackingManager || server.eyeTrackingManager.state !== 'running') return;
    const now = Date.now();
    const cursor = screen.getCursorScreenPoint();

    // Maintain a rolling cursor trail (last ~3s) so we can detect that the
    // user actually MOVED the cursor to a new target — not just left it
    // parked while reading something else on screen.
    const trail = eyeOverlayAutoTrain.cursorTrail;
    trail.push({ x: cursor.x, y: cursor.y, t: now });
    while (trail.length && now - trail[0].t > 3000) trail.shift();

    // Cursor stillness
    const ca = eyeOverlayAutoTrain.cursorAnchor;
    if (!ca || Math.hypot(cursor.x - ca.x, cursor.y - ca.y) > CURSOR_RADIUS_PX) {
      eyeOverlayAutoTrain.cursorAnchor = cursor;
      eyeOverlayAutoTrain.cursorAnchorAt = now;
    }
    const cursorStillFor = now - eyeOverlayAutoTrain.cursorAnchorAt;

    // Gaze stillness — must have a recent gaze sample (< 200ms old)
    const gaze = eyeOverlayAutoTrain.lastGaze;
    const gazeAge = now - eyeOverlayAutoTrain.lastGazeAt;
    if (!gaze || gazeAge > 200) return;

    const ga = eyeOverlayAutoTrain.gazeAnchor;
    if (!ga || Math.hypot(gaze.x - ga.x, gaze.y - ga.y) > GAZE_RADIUS_PX) {
      eyeOverlayAutoTrain.gazeAnchor = { x: gaze.x, y: gaze.y };
      eyeOverlayAutoTrain.gazeAnchorAt = now;
    }
    const gazeStillFor = now - eyeOverlayAutoTrain.gazeAnchorAt;

    // Distance gaze ↔ cursor
    const dist = Math.hypot(gaze.x - cursor.x, gaze.y - cursor.y);
    const cooldownRemaining = Math.max(0, SAMPLE_COOLDOWN_MS - (now - eyeOverlayAutoTrain.lastSampleAt));
    const inTrust = dist <= TRUST_RADIUS_PX;

    // Cursor-movement evidence: was there a meaningful cursor displacement
    // within the last CURSOR_MOVE_WINDOW_MS that ended near the current
    // position? This rejects "cursor parked, user looking elsewhere".
    let movedRecently = false;
    let moveDist = 0;
    for (const p of trail) {
      if (now - p.t > CURSOR_MOVE_WINDOW_MS) continue;
      if (now - p.t < 200) continue; // need some history
      const d = Math.hypot(cursor.x - p.x, cursor.y - p.y);
      if (d >= CURSOR_MOVE_MIN_PX && d <= CURSOR_MOVE_MAX_PX) {
        movedRecently = true;
        moveDist = Math.max(moveDist, d);
        break;
      }
    }

    // Stream live progress to overlay HUD so the user can see what's needed
    if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
      eyeOverlayWindow.webContents.send('train-status', {
        cursorStillMs: cursorStillFor,
        cursorStillTargetMs: CURSOR_STILL_MS,
        gazeStillMs: gazeStillFor,
        gazeStillTargetMs: GAZE_STILL_MS,
        dist,
        sanityMaxDist: TRUST_RADIUS_PX,
        inSanity: inTrust,
        cooldownRemaining,
        cursor: { x: cursor.x, y: cursor.y },
        movedRecently,
      });
    }

    // Both must have been stationary long enough
    if (cursorStillFor < CURSOR_STILL_MS) return;
    if (gazeStillFor < GAZE_STILL_MS) return;

    // Cooldown
    if (now - eyeOverlayAutoTrain.lastSampleAt < SAMPLE_COOLDOWN_MS) return;

    // Strict trust gate: gaze prediction must already be near the cursor.
    if (!inTrust) return;

    // Require cursor-movement evidence — user must have intentionally
    // moved the cursor to this spot recently.
    if (!movedRecently) return;

    // Weight by closeness — closer pairs get more trust. Range ~0.25–0.6.
    const closeness = 1.0 - Math.min(1.0, dist / TRUST_RADIUS_PX);
    const weight = 0.25 + 0.35 * closeness;

    const res = server.eyeTrackingManager.addOnlineTrainingSample(cursor.x, cursor.y, weight);
    if (res && res.success) {
      eyeOverlayAutoTrain.lastSampleAt = now;
      eyeOverlayAutoTrain.sampleCount++;
      // Notify overlay so it can flash
      if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
        eyeOverlayWindow.webContents.send('train-sample', {
          x: cursor.x, y: cursor.y, weight, count: eyeOverlayAutoTrain.sampleCount,
        });
      }
    }
  }, POLL_MS);
}

async function startEyeOverlayMode(opts = {}) {
  if (!server?.eyeTrackingManager) {
    return { success: false, error: 'Eye tracking manager unavailable' };
  }
  const mgr = server.eyeTrackingManager;

  // Force the same camera that was used during calibration. Iris geometry,
  // FOV, and lens distortion differ between webcams, so the saved gaze model
  // is only valid for the camera it was trained on. We read cameraIndex from
  // the calibration JSON unless the caller explicitly overrode it.
  let cameraIndex = opts.cameraIndex;
  if (cameraIndex === undefined || cameraIndex === null) {
    try {
      const calFile = path.join(getResourcesPath(), 'eye-calibration.json');
      if (fs.existsSync(calFile)) {
        const cal = JSON.parse(fs.readFileSync(calFile, 'utf-8'));
        if (typeof cal.cameraIndex === 'number') {
          cameraIndex = cal.cameraIndex;
          console.log(`[EyeOverlay] Using calibration camera index: ${cameraIndex}`);
        }
      }
    } catch (err) {
      console.warn('[EyeOverlay] Could not read calibration camera index:', err.message);
    }
  }
  if (cameraIndex === undefined || cameraIndex === null) cameraIndex = 0;
  // If tracking is already running for cursor control, stop it first so we
  // can re-enter in overlay mode (no cursor, online-train enabled).
  if (mgr.state === 'running') {
    await mgr.stop().catch(() => {});
  }

  // Open the window first so it's ready to receive gaze events.
  openEyeOverlayWindow();

  // Wire callbacks
  mgr.overlayMode = true;
  mgr.onGazeData = (data) => {
    if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
      eyeOverlayWindow.webContents.send('gaze-data', data);
    }
    // Cache for the auto-train loop
    if (eyeOverlayAutoTrain && typeof data.x === 'number') {
      eyeOverlayAutoTrain.lastGaze = { x: data.x, y: data.y };
      eyeOverlayAutoTrain.lastGazeAt = Date.now();
    }
  };
  mgr.onModelUpdated = (info) => {
    if (eyeOverlayWindow && !eyeOverlayWindow.isDestroyed()) {
      eyeOverlayWindow.webContents.send('model-updated', info);
    }
  };

  const result = await mgr.start({ cameraIndex, duration: 0, ...(opts.cameraOptions || {}) });
  if (!result.success) {
    closeEyeOverlayWindow();
    mgr.overlayMode = false;
    mgr.onGazeData = null;
    mgr.onModelUpdated = null;
    return result;
  }

  // Tell the tracker to auto-save adapted calibration so adaptation sticks.
  try {
    const calFile = path.join(getResourcesPath(), 'eye-calibration.json');
    mgr.setOnlineCalibrationFile(calFile);
  } catch {}

  _startOverlayAutoTrain();
  _registerOverlayHotkeys();
  trayManager?.setEyeOverlayActive(true);
  trayManager?.notify('Eye Overlay', 'Overlay active. Move the cursor to a new spot you are looking at and hold still. Ctrl+Shift+G = force-confirm sample, Ctrl+Shift+U = undo last sample.');
  return { success: true };
}

async function stopEyeOverlayMode() {
  _stopOverlayAutoTrain();
  _unregisterOverlayHotkeys();
  closeEyeOverlayWindow();
  if (server?.eyeTrackingManager) {
    server.eyeTrackingManager.overlayMode = false;
    if (server.eyeTrackingManager.state === 'running') {
      await server.eyeTrackingManager.stop().catch(() => {});
    }
  }
  trayManager?.setEyeOverlayActive(false);
  return { success: true };
}

// ── Calibration IPC handlers ──────────────────────────────────────────────────

ipcMain.on('calibration-point-ready', (_event, { index, screenX, screenY, opts }) => {
  if (server?.eyeTrackingManager) {
    server.eyeTrackingManager.sendCalibrationPoint(index, screenX, screenY, opts || {});
  }
});

ipcMain.on('calibration-finish', () => {
  if (server?.eyeTrackingManager) {
    server.eyeTrackingManager.finishCalibration();
  }
});

ipcMain.on('calibration-close', () => {
  if (calibrationWindow) {
    calibrationWindow.close();
  }
});

// Start calibration with the user-chosen camera and move window to chosen display
ipcMain.on('calibration-start', async (_event, { cameraIndex, displayId, optimize, cameraOptions }) => {
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  const chosen = displays.find(d => d.id === displayId) || screen.getPrimaryDisplay();

  // Move calibration window to the chosen display and go fullscreen there
  if (calibrationWindow && !calibrationWindow.isDestroyed()) {
    calibrationWindow.setBounds(chosen.bounds);
    calibrationWindow.setFullScreen(true);
  }

  // Start the Python calibration process with the chosen camera
  if (server?.eyeTrackingManager) {
    server.eyeTrackingManager.startCalibration(cameraIndex, {
      optimize: !!optimize,
      ...(cameraOptions || {}),
    });
  }
});

ipcMain.handle('get-prior-calibration', async () => {
  if (server?.eyeTrackingManager) {
    return server.eyeTrackingManager.getPriorCalibrationSummary();
  }
  return { exists: false };
});

ipcMain.handle('get-cameras', async () => {
  if (server?.eyeTrackingManager) {
    return await server.eyeTrackingManager.listCameras();
  }
  return [];
});

ipcMain.handle('get-camera-snapshot', async (_event, { cameraIndex }) => {
  if (server?.eyeTrackingManager) {
    return await server.eyeTrackingManager.getCameraSnapshot(cameraIndex);
  }
  return { error: 'No eye tracking manager' };
});

// Stop eye tracking (used from validation screen)
ipcMain.handle('stop-tracking', async () => {
  if (server?.eyeTrackingManager) {
    server.eyeTrackingManager.validationMode = false;
    server.eyeTrackingManager.onGazeData = null;
    return await server.eyeTrackingManager.stop();
  }
  return { success: false, error: 'No eye tracking manager' };
});

// Start tracking for validation (uses existing calibration, no cursor movement)
ipcMain.handle('start-validation-tracking', async (_event, { cameraIndex, cameraOptions }) => {
  if (server?.eyeTrackingManager) {
    server.eyeTrackingManager.validationMode = true;
    // Pipe gaze data to calibration window
    server.eyeTrackingManager.onGazeData = (data) => {
      if (calibrationWindow && !calibrationWindow.isDestroyed()) {
        calibrationWindow.webContents.send('gaze-data', data);
      }
    };
    return await server.eyeTrackingManager.start({
      cameraIndex,
      duration: 0,
      ...(cameraOptions || {}),
    });
  }
  return { success: false, error: 'No eye tracking manager' };
});

// Get live gaze data for validation display
ipcMain.handle('get-tracking-status', () => {
  if (server?.eyeTrackingManager) {
    return server.eyeTrackingManager.getStatus();
  }
  return { state: 'idle' };
});

ipcMain.handle('get-displays', () => {
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.map(d => ({
    id: d.id,
    label: `${d.size.width}x${d.size.height}` + (d.id === primary.id ? ' (Primary)' : ''),
    width: d.size.width,
    height: d.size.height,
    isPrimary: d.id === primary.id,
  }));
});

// ── Eye Overlay (Test Mode) IPC ─────────────────────────────────────────────

ipcMain.handle('start-eye-overlay', async (_event, opts) => {
  return await startEyeOverlayMode(opts || {});
});

ipcMain.handle('stop-eye-overlay', async () => {
  return await stopEyeOverlayMode();
});

// ─── App Lifecycle ──────────────────────────────────────────────────────────────

app.on('ready', async () => {
  console.log('[Main] CSimple Addon starting...');

  // Don't show in dock/taskbar (tray-only app)
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  // 0. First-run: prompt for resources folder location
  const firstRunConfig = path.join(CONFIG_DIR, '.resources-configured');
  if (!fs.existsSync(firstRunConfig)) {
    const chosenPath = await promptResourcesFolder();
    saveResourcesPath(chosenPath);
    RESOURCES_PATH = chosenPath;
    global.CSIMPLE_RESOURCES_PATH = chosenPath;
    fs.writeFileSync(firstRunConfig, new Date().toISOString(), 'utf-8');
    console.log(`[Main] First-run resources path: ${chosenPath}`);
  }

  // 1. Ensure directories exist
  ensureDirectories();

  // 2. Create system tray
  trayManager = new TrayManager();
  trayManager.create({
    onOpenWebApp: () => shell.openExternal(WEBAPP_URL),
    onOpenResources: () => shell.openPath(getResourcesPath()),
    onChangeResourcesFolder: () => changeResourcesFolder(),
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
    onCalibrateEyeTracking: () => openCalibrationWindow(),
    onToggleEyeTracking: async (enabled) => {
      if (!server?.eyeTrackingManager) {
        trayManager?.notify('Eye Tracking', 'Server is not ready yet.');
        return;
      }
      if (enabled) {
        const result = await server.eyeTrackingManager.start().catch((e) => ({ success: false, error: e.message }));
        if (!result?.success) {
          trayManager?.notify('Eye Tracking', result?.error || 'Failed to start tracking.');
        }
      } else {
        await server.eyeTrackingManager.stop().catch(() => {});
      }
    },
    onToggleEyeOverlay: async (enabled) => {
      if (!server?.eyeTrackingManager) {
        trayManager?.notify('Eye Overlay', 'Server is not ready yet.');
        return;
      }
      if (enabled) {
        const result = await startEyeOverlayMode().catch((e) => ({ success: false, error: e.message }));
        if (!result?.success) {
          trayManager?.notify('Eye Overlay', result?.error || 'Failed to start overlay.');
        }
      } else {
        await stopEyeOverlayMode();
        trayManager?.notify('Eye Overlay', 'Overlay stopped.');
      }
    },
    onEmergencyStopEyeTracking: async () => {
      if (server?.eyeTrackingManager) {
        await server.eyeTrackingManager.stop().catch(() => {});
        trayManager?.notify('Eye Tracking', 'Emergency stop — tracking halted.');
      }
    },
    onShowEyeTrackingHelp: () => {
      trayManager?.notify(
        'Eye Tracking Quick Start',
        '1) Calibrate (tray menu or say "calibrate eye tracking").\n2) Toggle "Enable Eye Tracking" in the tray, or say "track my eyes".\n3) EMERGENCY STOP: Escape or Ctrl+Alt+E (works globally).'
      );
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

  // Unregister all global shortcuts
  globalShortcut.unregisterAll();

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

  // Stop eye tracking if running
  if (server?.eyeTrackingManager) {
    await server.eyeTrackingManager.stop();
  }

  // Tear down overlay window + auto-train loop
  _stopOverlayAutoTrain();
  closeEyeOverlayWindow();

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
