/**
 * Simple Addon — Eye Tracking Manager
 *
 * Manages the Python eye_tracker.py subprocess and a persistent PowerShell
 * process for low-latency cursor movement. Provides start/stop/calibrate API.
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { GazeClick } = require('./gaze-click');
const { BlinkGestureDetector } = require('./blink-gesture');

// Resolve scripts path (packaged vs dev)
function resolveScriptsPath() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'scripts');
    if (fs.existsSync(packaged)) return packaged;
  }
  return path.join(__dirname, '..', 'scripts');
}

// Resolve resources path
function resolveResourcesPath() {
  if (global.SIMPLE_RESOURCES_PATH) return global.SIMPLE_RESOURCES_PATH;
  return path.join(os.homedir(), 'Documents', 'Simple', 'Resources');
}

class EyeTrackingManager extends EventEmitter {
  constructor() {
    super();
    this.state = 'idle'; // idle | running | calibrating | error
    this.pythonProcess = null;
    this.cursorProcess = null;
    this.startTime = null;
    this.duration = 0;
    this.cameraIndex = 0;
    this.lastError = null;
    this.onStateChange = null; // callback for tray updates
    this._stdinWriter = null;
    this._display = null;      // {width,height,scaleFactor,x,y} DIP bounds of the calibration display
    this._lastCursorX = null;  // dedupe physical SetCursorPos writes
    this._lastCursorY = null;
    this._rawTrackFrames = 0;  // downsample counter for the track-mode raw log
    this._rawLogKind = null;   // 'calibrate' | 'track' — selects the raw-log filename
    this.onGazeData = null; // callback for live gaze coordinates
    this.validationMode = false; // when true, don't move cursor
    this.overlayMode = false; // when true, don't move cursor + accept online_train
    this.onModelUpdated = null; // callback when online refit succeeds
    this._onlineSamples = 0;     // online-training samples added this session
    this._lastModelUpdate = null; // timestamp of the last successful refit
    this.gazeClick = new GazeClick({ enabled: false });
    this.blinkGesture = new BlinkGestureDetector({ enabled: false });
    this.onGazeClick = null;     // callback(payload) when a dwell click completes
    this._quality = null;        // live tracking-quality accumulator
    this._gazeHeatmap = null;    // {cols,rows,total,cells} gaze-density histogram
  }

  /**
   * Raw diagnostic capture. Every JSON line the Python eye_tracker emits during
   * calibration is appended to a single session log so a calibration can be
   * analyzed after the fact (per-point progress, face/camera status, and the
   * final fit summary). The file is truncated at the start of each calibration.
   */
  _rawLogPath() {
    // Calibration keeps its historical filename; track mode gets its own file
    // so the validation preview (which is also `start()`) never clobbers the
    // calibration diagnostic the user wants to read afterward.
    const name = this._rawLogKind === 'track' ? 'eye-tracker-track.log' : 'eye-tracker-session.log';
    return path.join(resolveResourcesPath(), name);
  }

  _startRawSession(kind, cameraIndex, screen) {
    try {
      this._rawLogKind = kind;
      const logPath = this._rawLogPath();
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const header = { ts: new Date().toISOString(), kind, cameraIndex, screen, version: 1 };
      fs.writeFileSync(logPath, '=== ' + JSON.stringify(header) + ' ===\n', 'utf-8');
    } catch (e) {
      console.warn('[EyeTracking] Could not start raw log:', e.message);
    }
  }

  _appendRawLine(line) {
    try {
      // Strip base64 preview frames so the session log stays small/readable.
      const s = String(line).replace(/"image"\s*:\s*"data:image\/[^"]*"/g, '"image":"[base64 preview omitted]"');
      fs.appendFileSync(this._rawLogPath(), s + '\n', 'utf-8');
    } catch {}
  }

  /**
   * Multi-display support: persist the display the user calibrated on (DIP
   * bounds + scale factor) so tracking can reuse the exact coordinate space.
   * Gaze is emitted in display-local DIPs; SetCursorPos needs virtual-desktop
   * physical pixels, so the (x,y) offset and scale factor must round-trip.
   */
  _displaySidecarPath() {
    return path.join(resolveResourcesPath(), 'eye-display.json');
  }

  _loadDisplaySidecar() {
    try {
      const p = this._displaySidecarPath();
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (d && typeof d.width === 'number' && typeof d.height === 'number') {
          return {
            width: d.width,
            height: d.height,
            scaleFactor: typeof d.scaleFactor === 'number' && d.scaleFactor > 0 ? d.scaleFactor : 1,
            x: typeof d.x === 'number' ? d.x : 0,
            y: typeof d.y === 'number' ? d.y : 0,
          };
        }
      }
    } catch {}
    return null;
  }

  _saveDisplaySidecar(display) {
    try {
      fs.mkdirSync(resolveResourcesPath(), { recursive: true });
      fs.writeFileSync(this._displaySidecarPath(), JSON.stringify(display), 'utf-8');
    } catch (e) {
      console.warn('[EyeTracking] Could not save display sidecar:', e.message);
    }
  }

  /**
   * Center of the calibration display (display-local DIPs) — used by the
   * re-anchor hotkey so it points at the display the user actually calibrated on.
   */
  getDisplayCenter() {
    const d = this._display;
    if (d && d.width && d.height) {
      return { x: Math.round(d.width / 2), y: Math.round(d.height / 2) };
    }
    const s = this._getScreenSize();
    return { x: Math.round(s.width / 2), y: Math.round(s.height / 2) };
  }

  /**
   * Resolve camera pipeline options (IR mode, process resolution, hires iris,
   * native capture resolution). Merges persisted settings.json with per-call
   * overrides passed into start()/startCalibration().
   */
  _resolveCameraOptions(options = {}) {
    let irMode = false;
    let processWidth = 640;
    let processHeight = 480;
    let hiresIris = false;
    let captureWidth = 0;
    let captureHeight = 0;
    let cameraName = null;
    let cameraBackend = null;

    // Baseline: the camera pipeline the user actually calibrated with. The
    // calibration window lets them pick a profile (auto / IR / hi-res) that
    // changes iris precision; tracking MUST reuse the same pipeline or the
    // accuracy measured at calibration won't hold in the field. eye_tracker.py
    // now stamps this pipeline into eye-calibration.json on every save.
    try {
      const calPath = path.join(resolveResourcesPath(), 'eye-calibration.json');
      if (fs.existsSync(calPath)) {
        const cal = JSON.parse(fs.readFileSync(calPath, 'utf-8'));
        if (cal.pipeline && typeof cal.pipeline === 'object') {
          irMode = cal.pipeline.irMode ?? irMode;
          processWidth = cal.pipeline.processWidth ?? processWidth;
          processHeight = cal.pipeline.processHeight ?? processHeight;
          hiresIris = cal.pipeline.hiresIris ?? hiresIris;
          captureWidth = cal.pipeline.captureWidth ?? captureWidth;
          captureHeight = cal.pipeline.captureHeight ?? captureHeight;
        }
      }
    } catch {}

    // User-level overrides (settings.json) win over the calibration baseline.
    try {
      const settingsPath = path.join(resolveResourcesPath(), 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (s.eyeTracking) {
          irMode = s.eyeTracking.irMode ?? irMode;
          processWidth = s.eyeTracking.processWidth ?? processWidth;
          processHeight = s.eyeTracking.processHeight ?? processHeight;
          hiresIris = s.eyeTracking.hiresIris ?? hiresIris;
          captureWidth = s.eyeTracking.captureWidth ?? captureWidth;
          captureHeight = s.eyeTracking.captureHeight ?? captureHeight;
        }
      }
    } catch {}
    // Per-call overrides win over everything (explicit caller intent).
    if (options.irMode !== undefined) irMode = !!options.irMode;
    if (options.processWidth) processWidth = options.processWidth;
    if (options.processHeight) processHeight = options.processHeight;
    if (options.hiresIris !== undefined) hiresIris = !!options.hiresIris;
    if (options.captureWidth) captureWidth = options.captureWidth;
    if (options.captureHeight) captureHeight = options.captureHeight;
    if (options.cameraName) cameraName = options.cameraName;
    if (options.cameraBackend) cameraBackend = options.cameraBackend;
    return { irMode, processWidth, processHeight, hiresIris, captureWidth, captureHeight, cameraName, cameraBackend };
  }

  /**
   * Get the Python executable path (from venv or system).
   */
  _getPythonPath() {
    const venvDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Simple', 'venv');
    const venvPython = path.join(venvDir, 'Scripts', 'python.exe');
    if (fs.existsSync(venvPython)) return venvPython;
    // Fallback to system Python
    return 'python';
  }

  /**
   * Start the persistent PowerShell cursor mover process.
   * It reads "x,y" lines from stdin and calls SetCursorPos.
   */
  _startCursorProcess() {
    if (this.cursorProcess) return;

    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CursorHelper {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
while ($true) {
    $line = [Console]::ReadLine()
    if ($line -eq 'quit') { break }
    if ($line.StartsWith('click:')) {
        $coords = $line.Substring(6).Split(',')
        if ($coords.Length -eq 2) {
            [CursorHelper]::SetCursorPos([int]$coords[0], [int]$coords[1])
            [CursorHelper]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
            [CursorHelper]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
        }
    } else {
        $parts = $line.Split(',')
        if ($parts.Length -eq 2) {
            [CursorHelper]::SetCursorPos([int]$parts[0], [int]$parts[1])
        }
    }
}
`.trim();

    this.cursorProcess = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });

    this.cursorProcess.on('exit', () => {
      this.cursorProcess = null;
    });

    this.cursorProcess.on('error', (err) => {
      console.error('[EyeTracking] Cursor process error:', err.message);
      this.cursorProcess = null;
    });
  }

  /**
   * Move cursor to absolute screen position via the persistent PS process.
   */
  _moveCursor(x, y) {
    if (!this.cursorProcess || !this.cursorProcess.stdin.writable) return;
    // The tracker emits display-local DIP coordinates (the same space as the
    // calibration dots); SetCursorPos needs virtual-desktop physical pixels.
    // Map through the calibrated display's offset + scale factor so gaze
    // lands correctly on multi-monitor and scaled (125%/150%) setups.
    const d = this._display;
    const s = d && d.scaleFactor ? d.scaleFactor : (this._screenScaleFactor || 1);
    const ox = d ? (d.x || 0) : 0;
    const oy = d ? (d.y || 0) : 0;
    const px = Math.round((ox + x) * s);
    const py = Math.round((oy + y) * s);
    // The Python dead-zone already holds the cursor during fixations, so we
    // receive the same coordinate repeatedly — skip redundant SetCursorPos
    // round-trips (a no-op at the OS level, but not free across the pipe).
    if (px === this._lastCursorX && py === this._lastCursorY) return;
    this._lastCursorX = px;
    this._lastCursorY = py;
    this.cursorProcess.stdin.write(`${px},${py}\n`);
  }

  /**
   * Perform a left click at a screen position via the persistent PS process.
   * Coordinates are DIPs; scaled to physical pixels like _moveCursor.
   */
  _click(x, y) {
    if (!this.cursorProcess || !this.cursorProcess.stdin.writable) return;
    const d = this._display;
    const s = d && d.scaleFactor ? d.scaleFactor : (this._screenScaleFactor || 1);
    const ox = d ? (d.x || 0) : 0;
    const oy = d ? (d.y || 0) : 0;
    this.cursorProcess.stdin.write(`click:${Math.round((ox + x) * s)},${Math.round((oy + y) * s)}\n`);
  }

  /**
   * Accumulate live tracking-quality metrics and drive dwell-to-click.
   */
  _ingestGaze(data, { suppressCursor, confidenceThreshold }) {
    if (!this._quality) {
      this._quality = { frames: 0, confSum: 0, blinks: 0, fixations: 0, faceLost: 0, startedAt: Date.now() };
    }
    const q = this._quality;
    q.frames += 1;
    q.confSum += (typeof data.confidence === 'number' ? data.confidence : 0);
    if (data.blink === true) q.blinks += 1;
    if (data.held === true) q.faceLost += 1;

    // Gaze-density heatmap (blinks / held / face-loss frames excluded so the
    // map reflects where the user actually looked, not where the cursor froze).
    if (this._gazeHeatmap && data.blink !== true && data.held !== true
        && typeof data.x === 'number' && typeof data.y === 'number') {
      this._accumulateGazeHeatmap(data.x, data.y);
    }

    if (!suppressCursor && this.gazeClick && this.gazeClick.enabled) {
      const payload = this.gazeClick.feed(data.x, data.y, Date.now(), {
        blink: data.blink === true,
        confidence: data.confidence,
        confidenceThreshold,
      });
      if (payload) {
        this.emit('gaze-click', payload);
        if (this.onGazeClick) { try { this.onGazeClick(payload); } catch {} }
        this._click(payload.x, payload.y);
      }
    }
  }

  _ingestFixation(data) {
    if (!this._quality) return;
    if (data.fixation_start) this._quality.fixations += 1;
  }

  _computeQuality() {
    if (!this._quality) return null;
    const q = this._quality;
    const elapsed = Math.max(0.001, (Date.now() - q.startedAt) / 1000);
    return {
      fps: Math.round((q.frames / elapsed) * 10) / 10,
      meanConfidence: q.frames > 0 ? Math.round((q.confSum / q.frames) * 1000) / 1000 : null,
      blinks: q.blinks,
      fixations: q.fixations,
      faceLostFrames: q.faceLost,
    };
  }

  /**
   * Gaze-density histogram (16:9 grid) accumulated across a tracking session.
   * Downstream UI renders it as a heatmap of where the user has been looking.
   */
  _newGazeHeatmap(width, height) {
    const cols = 16;
    const rows = 9;
    return {
      cols,
      rows,
      width: Math.max(1, width || 1920),
      height: Math.max(1, height || 1080),
      total: 0,
      max: 0,
      cells: new Array(cols * rows).fill(0),
    };
  }

  _accumulateGazeHeatmap(x, y) {
    const hm = this._gazeHeatmap;
    if (!hm) return;
    const col = Math.min(hm.cols - 1, Math.max(0, Math.floor((x / hm.width) * hm.cols)));
    const row = Math.min(hm.rows - 1, Math.max(0, Math.floor((y / hm.height) * hm.rows)));
    const idx = row * hm.cols + col;
    hm.cells[idx] += 1;
    hm.total += 1;
    if (hm.cells[idx] > hm.max) hm.max = hm.cells[idx];
  }

  getGazeHeatmap() {
    if (!this._gazeHeatmap) return null;
    return {
      cols: this._gazeHeatmap.cols,
      rows: this._gazeHeatmap.rows,
      width: this._gazeHeatmap.width,
      height: this._gazeHeatmap.height,
      total: this._gazeHeatmap.total,
      max: this._gazeHeatmap.max,
      cells: this._gazeHeatmap.cells,
    };
  }

  /**
   * Stop the persistent cursor mover process.
   */
  _stopCursorProcess() {
    if (!this.cursorProcess) return;
    try {
      if (this.cursorProcess.stdin.writable) {
        this.cursorProcess.stdin.write('quit\n');
      }
    } catch {}
    setTimeout(() => {
      if (this.cursorProcess) {
        this.cursorProcess.kill();
        this.cursorProcess = null;
      }
    }, 1000);
  }

  /**
   * Get the screen dimensions of the primary monitor.
   */
  _getScreenSize() {
    try {
      const { screen } = require('electron');
      const primary = screen.getPrimaryDisplay();
      return { width: primary.size.width, height: primary.size.height };
    } catch {
      return { width: 1920, height: 1080 };
    }
  }

  /**
   * The display's OS scale factor (e.g. 1.25 for 125% Windows scaling).
   * `screen.size`/`bounds` are in DIPs, but the OS cursor API (SetCursorPos)
   * operates in physical pixels — so the tracked DIP coordinates must be
   * multiplied by this at the cursor-move boundary. Returns 1.0 (no scaling)
   * when the display is at 100% or the value can't be resolved.
   */
  _getScreenScaleFactor() {
    try {
      const { screen } = require('electron');
      const sf = screen.getPrimaryDisplay().scaleFactor;
      return (Number.isFinite(sf) && sf > 0) ? sf : 1;
    } catch {
      return 1;
    }
  }

  /**
   * Resolve which camera tracking should use. Iris geometry, FOV, and lens
   * distortion differ between webcams, so the saved gaze model is only valid
   * for the camera it was trained on — read that from the calibration file,
   * falling back to camera 0. Callers may still override it explicitly.
   */
  resolveCalibrationCameraIndex() {
    try {
      const calFile = path.join(resolveResourcesPath(), 'eye-calibration.json');
      if (fs.existsSync(calFile)) {
        const cal = JSON.parse(fs.readFileSync(calFile, 'utf-8'));
        if (typeof cal.cameraIndex === 'number') return cal.cameraIndex;
      }
    } catch (err) {
      console.warn('[EyeTracking] Could not read calibration camera index:', err.message);
    }
    return 0;
  }

  /**
   * Start eye tracking.
   * @param {Object} options
   * @param {number} options.cameraIndex - Webcam index (default: calibration camera, else 0)
   * @param {number} options.duration - Duration in seconds (0 = indefinite)
   * @param {string} options.calibrationFile - Path to calibration JSON
   */
  async start(options = {}) {
    if (this.state === 'running') {
      return { success: false, error: 'Eye tracking is already running' };
    }

    const resourcesPath = resolveResourcesPath();
    const calFile = options.calibrationFile || path.join(resourcesPath, 'eye-calibration.json');

    if (!fs.existsSync(calFile)) {
      return { success: false, error: 'No calibration data found. Please calibrate first.' };
    }

    this.cameraIndex = options.cameraIndex ?? this.resolveCalibrationCameraIndex();
    this.duration = options.duration ?? 0;

    // Resolve the calibrated display (multi-monitor) and reuse its DIP bounds
    // + scale factor so tracking maps into the same coordinate space calibration
    // measured. Falls back to the primary display when no sidecar exists.
    const display = options.display || this._loadDisplaySidecar() || null;
    this._display = display;
    const screen = display
      ? { width: display.width, height: display.height }
      : this._getScreenSize();
    this._screenScaleFactor = display
      ? (display.scaleFactor || 1)
      : this._getScreenScaleFactor();
    this._lastCursorX = null;
    this._lastCursorY = null;
    const scriptPath = path.join(resolveScriptsPath(), 'eye_tracker.py');

    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: 'eye_tracker.py not found' };
    }

    // Load tracking settings (confidence, 1€ filter, dwell, lead).
    let confidence = 0.6;
    let oeMinCutoff = 0.8;
    let oeBeta = 0.007;
    let deadzonePx = 4.0;
    let fixationVelocityThreshold = 120;
    let fixationMinDuration = 0.10;
    let fixationDispersion = 40;
    let viewingDistanceMm = 600;
    let dwellClickEnabled = false;
    let dwellMs = 600;
    let dwellRadiusPx = 28;
    let dwellCooldownMs = 900;
    let blinkClickEnabled = false;
    let doubleBlinkWindowMs = 800;
    let leadMs = 0;
    try {
      const settingsPath = path.join(resourcesPath, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settings.eyeTracking) {
          confidence = settings.eyeTracking.confidenceThreshold ?? confidence;
          oeMinCutoff = settings.eyeTracking.oneEuroMinCutoff ?? oeMinCutoff;
          oeBeta = settings.eyeTracking.oneEuroBeta ?? oeBeta;
          deadzonePx = settings.eyeTracking.deadzonePx ?? deadzonePx;
          fixationVelocityThreshold = settings.eyeTracking.fixationVelocityThreshold ?? fixationVelocityThreshold;
          fixationMinDuration = settings.eyeTracking.fixationMinDuration ?? fixationMinDuration;
          fixationDispersion = settings.eyeTracking.fixationDispersion ?? fixationDispersion;
          viewingDistanceMm = settings.eyeTracking.viewingDistanceMm ?? viewingDistanceMm;
          dwellClickEnabled = settings.eyeTracking.dwellClickEnabled ?? dwellClickEnabled;
          dwellMs = settings.eyeTracking.dwellMs ?? dwellMs;
          dwellRadiusPx = settings.eyeTracking.dwellRadiusPx ?? dwellRadiusPx;
          dwellCooldownMs = settings.eyeTracking.dwellCooldownMs ?? dwellCooldownMs;
          blinkClickEnabled = settings.eyeTracking.blinkClickEnabled ?? blinkClickEnabled;
          doubleBlinkWindowMs = settings.eyeTracking.doubleBlinkWindowMs ?? doubleBlinkWindowMs;
          leadMs = settings.eyeTracking.leadMs ?? leadMs;
        }
      }
    } catch {}
    // Per-call overrides
    if (typeof options.oneEuroMinCutoff === 'number') oeMinCutoff = options.oneEuroMinCutoff;
    if (typeof options.oneEuroBeta === 'number') oeBeta = options.oneEuroBeta;
    if (typeof options.deadzonePx === 'number') deadzonePx = options.deadzonePx;
    if (typeof options.confidenceThreshold === 'number') confidence = options.confidenceThreshold;
    if (typeof options.dwellMs === 'number') dwellMs = options.dwellMs;
    if (typeof options.dwellRadiusPx === 'number') dwellRadiusPx = options.dwellRadiusPx;
    if (typeof options.dwellCooldownMs === 'number') dwellCooldownMs = options.dwellCooldownMs;
    if (options.dwellClickEnabled !== undefined) dwellClickEnabled = !!options.dwellClickEnabled;
    if (options.blinkClickEnabled !== undefined) blinkClickEnabled = !!options.blinkClickEnabled;
    if (typeof options.doubleBlinkWindowMs === 'number') doubleBlinkWindowMs = options.doubleBlinkWindowMs;
    if (typeof options.leadMs === 'number') leadMs = options.leadMs;

    // Camera pipeline options (IR, processing/capture resolution, hires iris)
    const camOpts = this._resolveCameraOptions(options);

    const pythonPath = this._getPythonPath();
    const args = [
      scriptPath,
      '--camera_index', String(this.cameraIndex),
      '--screen_width', String(screen.width),
      '--screen_height', String(screen.height),
      '--calibration_file', calFile,
      '--duration', String(this.duration),
      '--mode', 'track',
      '--confidence_threshold', String(confidence),
      '--process_width', String(camOpts.processWidth),
      '--process_height', String(camOpts.processHeight),
      '--oe_min_cutoff', String(oeMinCutoff),
      '--oe_beta', String(oeBeta),
      '--deadzone_px', String(deadzonePx),
      '--fixation_velocity_threshold', String(fixationVelocityThreshold),
      '--fixation_min_duration', String(fixationMinDuration),
      '--fixation_dispersion', String(fixationDispersion),
      '--viewing_distance_mm', String(viewingDistanceMm),
      '--lead_ms', String(leadMs),
    ];
    if (camOpts.irMode) args.push('--ir_mode');
    if (camOpts.hiresIris) args.push('--hires_iris');
    if (camOpts.captureWidth > 0) args.push('--capture_width', String(camOpts.captureWidth));
    if (camOpts.captureHeight > 0) args.push('--capture_height', String(camOpts.captureHeight));
    if (camOpts.cameraName) args.push('--camera_name', String(camOpts.cameraName));
    if (camOpts.cameraBackend) args.push('--camera_backend', String(camOpts.cameraBackend));

    // Configure dwell-to-click + double-blink click + reset live metrics.
    this.gazeClick.dwellMs = dwellMs;
    this.gazeClick.radiusPx = dwellRadiusPx;
    this.gazeClick.cooldownMs = dwellCooldownMs;
    this.gazeClick.enabled = !!dwellClickEnabled;
    this.gazeClick.reset();
    this.blinkGesture.doubleBlinkWindowMs = doubleBlinkWindowMs;
    this.blinkGesture.enabled = !!blinkClickEnabled;
    this.blinkGesture.reset();
    this._quality = { frames: 0, confSum: 0, blinks: 0, fixations: 0, faceLost: 0, startedAt: Date.now() };
    this._gazeHeatmap = this._newGazeHeatmap(screen.width, screen.height);

    // Track-mode raw session log (downsampled) so cursor jumps / quality can be
    // analyzed after the fact, matching the calibration diagnostic.
    this._startRawSession('track', this.cameraIndex, screen);
    this._rawTrackFrames = 0;

    return new Promise((resolve) => {
      try {
        // Make sure a lingering process (e.g. a still-shutting-down calibration
        // subprocess) can't race the new one and later clobber its handle.
        if (this.pythonProcess) {
          try { this.pythonProcess.kill(); } catch {}
          this.pythonProcess = null;
          this._stdinWriter = null;
        }

        const proc = spawn(pythonPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        this.pythonProcess = proc;
        this._stdinWriter = proc.stdin;

        // Start the cursor mover
        this._startCursorProcess();

        // Persist online-learning refits (e.g. the Ctrl+Alt+R re-anchor) back to
        // the calibration file so adaptation survives the session. The tracker
        // only auto-saves after a successful refit, so this is a no-op unless
        // online_train samples actually arrive.
        try {
          if (this._stdinWriter && this._stdinWriter.writable) {
            this._stdinWriter.write(JSON.stringify({
              cmd: 'set_online_calibration_file',
              path: calFile,
            }) + '\n');
          }
        } catch {}

        // Read stdout line-by-line
        const rl = readline.createInterface({ input: proc.stdout });
        rl.on('line', (line) => {
          try {
            const data = JSON.parse(line);

            // Raw-log: keep status/error/fixation lines always, downsample gaze.
            const isGaze = typeof data.x === 'number' && typeof data.y === 'number';
            if (!isGaze || (this._rawTrackFrames++ % 30) === 0) {
              this._appendRawLine(line);
            }

            if (data.status === 'stopped' || data.status === 'duration_complete') {
              this._setState('idle');
              return;
            }

            if (data.status === 'model_updated') {
              this._lastModelUpdate = Date.now();
              if (this.onModelUpdated) {
                try { this.onModelUpdated(data); } catch {}
              }
            }

            if (data.error) {
              this.lastError = data.error;
              return;
            }

            if (typeof data.x === 'number' && typeof data.y === 'number') {
              // Always emit gaze data for listeners (validation screen / overlay)
              if (this.onGazeData) {
                this.onGazeData({ x: data.x, y: data.y, confidence: data.confidence, blink: data.blink });
              }
              // Also emit as an EventEmitter event so the perception bus (and any
              // other subscriber) receives gaze regardless of who owns the
              // onGazeData callback (overlay/validation overwrite it directly).
              this.emit('gaze', { x: data.x, y: data.y, confidence: data.confidence, blink: data.blink });
              // Skip cursor movement during blinks, face-loss grace frames,
              // or out-of-range head pose (all emitted with held=true).
              const isBlink = data.blink === true;
              const isHeld = data.held === true;
              const suppressCursor = this.validationMode || this.overlayMode;
              if (!suppressCursor && !isBlink && !isHeld && data.confidence >= confidence) {
                this._moveCursor(data.x, data.y);
              }
              this._ingestGaze(data, { suppressCursor, confidenceThreshold: confidence });

              // Double-blink click gesture (off unless enabled in settings).
              if (this.blinkGesture && this.blinkGesture.enabled) {
                const click = this.blinkGesture.feed(Date.now(), isBlink, data.x, data.y);
                if (click && !this.validationMode && !this.overlayMode) {
                  this.emit('blink-click', click);
                  if (this.onGazeClick) { try { this.onGazeClick(click); } catch {} }
                  this._click(click.x, click.y);
                }
              }
            }

            // Fixation / saccade events (I-VT). Emit as a distinct event so the
            // perception bus + dashboard can react to dwell targets without
            // re-parsing the raw gaze stream.
            if (data.fixation_start || data.fixation_end) {
              this.emit('fixation', data);
              this._ingestFixation(data);
            }
          } catch {}
        });

        // Handle stderr
        proc.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) console.error('[EyeTracking] Python stderr:', msg);
        });

        proc.on('exit', (code) => {
          console.log(`[EyeTracking] Python process exited with code ${code}`);
          // Only clear shared state if this is still the process we own. A
          // stale calibration subprocess exiting late must not clobber the
          // handle of a newer tracking/validation process.
          if (this.pythonProcess !== proc) return;
          this.pythonProcess = null;
          this._stdinWriter = null;
          this._stopCursorProcess();
          this._setState('idle');
        });

        proc.on('error', (err) => {
          console.error('[EyeTracking] Failed to start Python process:', err.message);
          if (this.pythonProcess !== proc) return;
          this.lastError = err.message;
          this._setState('error');
          resolve({ success: false, error: err.message });
        });

        this.startTime = Date.now();
        this._setState('running');
        console.log(`[EyeTracking] Started — camera: ${this.cameraIndex}, duration: ${this.duration}s`);
        resolve({ success: true });

      } catch (err) {
        this.lastError = err.message;
        this._setState('error');
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * Stop eye tracking.
   */
  async stop() {
    if (this.state !== 'running' && this.state !== 'calibrating') {
      return { success: false, error: 'Eye tracking is not active' };
    }

    // Send stop command to Python process
    if (this._stdinWriter && this._stdinWriter.writable) {
      try {
        this._stdinWriter.write(JSON.stringify({ cmd: 'stop' }) + '\n');
      } catch {}
    }

    // Give it a moment to exit cleanly, then force kill. Capture the process
    // reference so a late-spawned replacement can't be mistaken for this one.
    const proc = this.pythonProcess;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (proc) {
          try { proc.kill(); } catch {}
          if (this.pythonProcess === proc) this.pythonProcess = null;
        }
        resolve();
      }, 3000);

      if (proc) {
        proc.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    this._stopCursorProcess();
    this.pythonProcess = null;
    this._stdinWriter = null;
    this.validationMode = false;
    this.overlayMode = false;
    this.onGazeData = null;
    this.onModelUpdated = null;
    this._quality = null;
    this.lastError = null;
    this._setState('idle');
    console.log('[EyeTracking] Stopped');
    return { success: true };
  }

  /**
   * Tear down a still-running calibration subprocess (graceful then forced).
   * Called when the Python tracker reports calibration:complete so the
   * webcam is freed for follow-up features (overlay, validation, tracking).
   */
  _shutdownCalibrationProcess() {
    if (!this.pythonProcess) return;
    try {
      if (this._stdinWriter && this._stdinWriter.writable) {
        this._stdinWriter.write(JSON.stringify({ cmd: 'stop' }) + '\n');
      }
    } catch {}
    const proc = this.pythonProcess;
    setTimeout(() => {
      try {
        if (proc && !proc.killed) proc.kill();
      } catch {}
    }, 1500);
  }

  /**
   * Start calibration mode — spawns eye_tracker.py in calibrate mode.
   * The calibration window will send points via sendCalibrationPoint().
   */
  async startCalibration(cameraIndex = 0, options = {}) {
    if (this.state === 'running') {
      await this.stop();
    }

    this.cameraIndex = cameraIndex;

    // Resolve the chosen display so the calibration measures in that display's
    // DIP coordinate space (multi-monitor). Persist it for tracking to reuse.
    const display = (options && options.display) || this._loadDisplaySidecar() || null;
    this._display = display;
    if (display) this._saveDisplaySidecar(display);
    const screen = display
      ? { width: display.width, height: display.height }
      : this._getScreenSize();

    const scriptPath = path.join(resolveScriptsPath(), 'eye_tracker.py');
    const pythonPath = this._getPythonPath();

    this._startRawSession('calibrate', cameraIndex, screen);

    // If optimizing an existing calibration, load the prior aggregated points.
    let priorPoints = null;
    if (options && options.optimize) {
      try {
        const resourcesPath = resolveResourcesPath();
        const calFile = path.join(resourcesPath, 'eye-calibration.json');
        if (fs.existsSync(calFile)) {
          const prior = JSON.parse(fs.readFileSync(calFile, 'utf8'));
          if (Array.isArray(prior.points) && prior.points.length > 0) {
            priorPoints = prior.points
              .filter(p => p && !p.fromPrior &&
                typeof p.screenX === 'number' && typeof p.screenY === 'number' &&
                typeof p.irisX === 'number' && typeof p.irisY === 'number')
              .map(p => ({
                screenX: p.screenX,
                screenY: p.screenY,
                irisX: p.irisX,
                irisY: p.irisY,
                weight: typeof p.weight === 'number' ? p.weight : 1.0,
              }));
            if (priorPoints.length === 0) priorPoints = null;
          }
        }
      } catch (err) {
        console.warn('[EyeTracking] Could not load prior calibration for optimize:', err.message);
        priorPoints = null;
      }
    }

    const args = [
      scriptPath,
      '--camera_index', String(this.cameraIndex),
      '--screen_width', String(screen.width),
      '--screen_height', String(screen.height),
      '--mode', 'calibrate',
    ];

    // Merge settings + per-call options for IR / resolution
    const camOpts = this._resolveCameraOptions(options);
    args.push('--process_width', String(camOpts.processWidth));
    args.push('--process_height', String(camOpts.processHeight));
    if (camOpts.irMode) args.push('--ir_mode');
    if (camOpts.hiresIris) args.push('--hires_iris');
    if (camOpts.captureWidth > 0) args.push('--capture_width', String(camOpts.captureWidth));
    if (camOpts.captureHeight > 0) args.push('--capture_height', String(camOpts.captureHeight));
    if (camOpts.cameraName) args.push('--camera_name', String(camOpts.cameraName));
    if (camOpts.cameraBackend) args.push('--camera_backend', String(camOpts.cameraBackend));

    return new Promise((resolve) => {
      try {
        // Make sure a lingering process can't race the new calibration subprocess.
        if (this.pythonProcess) {
          try { this.pythonProcess.kill(); } catch {}
          this.pythonProcess = null;
          this._stdinWriter = null;
        }

        const proc = spawn(pythonPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        this.pythonProcess = proc;
        this._stdinWriter = proc.stdin;

        const rl = readline.createInterface({ input: proc.stdout });
        rl.on('line', (line) => {
          this._appendRawLine(line);
          try {
            const data = JSON.parse(line);
            if (data.calibration === 'complete') {
              console.log(`[EyeTracking] Calibration complete: ${data.file}`);
              this._setState('idle');
              // Terminate the Python subprocess so the webcam is released.
              // Otherwise the calibration process keeps running its capture
              // loop in the background and blocks the camera for downstream
              // features (overlay/test mode, validation, plain tracking).
              this._shutdownCalibrationProcess();
            }
            if (data.error) {
              this.lastError = data.error;
              console.error(`[EyeTracking] Calibration error: ${data.error}`);
            }
            // Forward calibration progress to any listener
            if (this.onCalibrationProgress) {
              this.onCalibrationProgress(data);
            }
          } catch {}
        });

        proc.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) {
            this._appendRawLine('[stderr] ' + msg);
            console.error('[EyeTracking] Calibration stderr:', msg);
          }
        });

        proc.on('exit', () => {
          this._appendRawLine('=== end ===');
          // Only clear shared state if this is still the process we own.
          if (this.pythonProcess !== proc) return;
          this.pythonProcess = null;
          this._stdinWriter = null;
          if (this.state === 'calibrating') {
            this._setState('idle');
          }
        });

        proc.on('error', (err) => {
          if (this.pythonProcess !== proc) return;
          this.lastError = err.message;
          this._setState('error');
          resolve({ success: false, error: err.message });
        });

        this._setState('calibrating');
        console.log('[EyeTracking] Calibration started');

        // If optimizing, seed the Python fit with prior aggregated points.
        if (priorPoints && priorPoints.length > 0 && this._stdinWriter && this._stdinWriter.writable) {
          try {
            this._stdinWriter.write(JSON.stringify({
              cmd: 'load_prior_calibration',
              points: priorPoints,
            }) + '\n');
            console.log(`[EyeTracking] Seeded optimize with ${priorPoints.length} prior points`);
          } catch (err) {
            console.warn('[EyeTracking] Failed to send prior points:', err.message);
          }
        }

        resolve({ success: true, optimize: !!(priorPoints && priorPoints.length), priorCount: priorPoints ? priorPoints.length : 0 });

      } catch (err) {
        this.lastError = err.message;
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * Send a calibration point to the Python subprocess.
   */
  sendCalibrationPoint(index, screenX, screenY, opts = {}) {
    if (!this._stdinWriter || !this._stdinWriter.writable) {
      return { success: false, error: 'Calibration process not running' };
    }
    const payload = {
      cmd: 'calibrate_point',
      index,
      screen_x: screenX,
      screen_y: screenY,
    };
    if (opts && typeof opts.minSamples === 'number') payload.min_samples = opts.minSamples;
    if (opts && typeof opts.maxSamples === 'number') payload.max_samples = opts.maxSamples;
    this._stdinWriter.write(JSON.stringify(payload) + '\n');
    return { success: true };
  }

  /**
   * Tell the Python subprocess to compute the homography and save calibration.
   */
  finishCalibration() {
    if (!this._stdinWriter || !this._stdinWriter.writable) {
      return { success: false, error: 'Calibration process not running' };
    }
    const resourcesPath = resolveResourcesPath();
    const outputFile = path.join(resourcesPath, 'eye-calibration.json');
    this._stdinWriter.write(JSON.stringify({
      cmd: 'finish_calibration',
      output_file: outputFile,
    }) + '\n');
    return { success: true };
  }

  /**
   * Send an implicit-calibration training sample to the running tracker.
   * The Python side pairs the screen target with the most recent iris/pose
   * measurement and refits the gaze model in-place after a few samples.
   */
  addOnlineTrainingSample(screenX, screenY, weight = 0.4) {
    if (this.state !== 'running') return { success: false, error: 'not running' };
    if (!this._stdinWriter || !this._stdinWriter.writable) {
      return { success: false, error: 'tracker stdin not writable' };
    }
    try {
      this._stdinWriter.write(JSON.stringify({
        cmd: 'online_train',
        screen_x: Math.round(screenX),
        screen_y: Math.round(screenY),
        weight,
      }) + '\n');
      this._onlineSamples += 1;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Tell the tracker where to auto-save the updated calibration after each
   * successful online refit (so adaptation persists across sessions).
   */
  setOnlineCalibrationFile(filePath) {
    if (!this._stdinWriter || !this._stdinWriter.writable) return { success: false };
    try {
      this._stdinWriter.write(JSON.stringify({
        cmd: 'set_online_calibration_file',
        path: filePath,
      }) + '\n');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Drop the most recent N online training samples. The tracker will refit
   * immediately so the bad samples are removed from the model.
   */
  dropRecentOnlineSamples(count = 1) {
    if (!this._stdinWriter || !this._stdinWriter.writable) return { success: false };
    try {
      this._stdinWriter.write(JSON.stringify({
        cmd: 'drop_recent_online_sample',
        count,
      }) + '\n');
      this._onlineSamples = Math.max(0, this._onlineSamples - count);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Drop ALL online samples and revert the model to the anchor calibration.
   */
  clearOnlineSamples() {
    if (!this._stdinWriter || !this._stdinWriter.writable) return { success: false };
    try {
      this._stdinWriter.write(JSON.stringify({
        cmd: 'clear_online_samples',
      }) + '\n');
      this._onlineSamples = 0;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Return a summary of any existing calibration so the UI can offer "Optimize".
   */
  getPriorCalibrationSummary() {
    try {
      const resourcesPath = resolveResourcesPath();
      const calFile = path.join(resourcesPath, 'eye-calibration.json');
      if (!fs.existsSync(calFile)) return { exists: false };
      const prior = JSON.parse(fs.readFileSync(calFile, 'utf8'));
      const pts = Array.isArray(prior.points) ? prior.points : [];
      const usable = pts.filter(p => p && !p.fromPrior &&
        typeof p.screenX === 'number' && typeof p.irisX === 'number').length;
      return {
        exists: true,
        timestamp: prior.timestamp || null,
        modelType: prior.modelType || (prior.gazeModel ? 'poly2' : 'homography'),
        meanResidualPx: typeof prior.meanResidualPx === 'number' ? prior.meanResidualPx : null,
        maxResidualPx: typeof prior.maxResidualPx === 'number' ? prior.maxResidualPx : null,
        accuracyDeg: typeof prior.accuracyDeg === 'number' ? prior.accuracyDeg : null,
        quality: prior.quality || null,
        pointCount: usable,
        screenResolution: prior.screenResolution || null,
      };
    } catch (err) {
      return { exists: false, error: err.message };
    }
  }

  /**
   * Get current tracking status.
   */
  getStatus() {
    const resourcesPath = resolveResourcesPath();
    const calFile = path.join(resourcesPath, 'eye-calibration.json');
    const hasCalibration = fs.existsSync(calFile);
    const elapsed = this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0;

    return {
      state: this.state,
      active: this.state === 'running',
      calibrating: this.state === 'calibrating',
      duration: this.duration,
      elapsed,
      cameraIndex: this.cameraIndex,
      hasCalibration,
      lastError: this.lastError,
      onlineSamples: this._onlineSamples,
      lastModelUpdate: this._lastModelUpdate,
      quality: this._computeQuality(),
    };
  }

  /**
   * List available webcams by probing via Python.
   */
  async listCameras() {
    const scriptPath = path.join(resolveScriptsPath(), 'eye_tracker.py');
    const pythonPath = this._getPythonPath();

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, [scriptPath, '--mode', 'list_cameras'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.on('exit', () => {
        try {
          const data = JSON.parse(output.trim());
          const cameras = Array.isArray(data.cameras) ? data.cameras : [];
          resolve(cameras.map((camera) => {
            if (typeof camera === 'number') {
              return { index: camera, name: `Camera ${camera}` };
            }
            return camera;
          }));
        } catch {
          resolve([]);
        }
      });
      proc.on('error', () => resolve([]));

      // Timeout after 15 seconds (camera probing can be slow)
      setTimeout(() => {
        proc.kill();
        resolve([]);
      }, 15000);
    });
  }

  /**
   * Capture a single preview frame from the selected calibration camera.
   */
  async getCameraSnapshot(cameraIndex) {
    const scriptPath = path.join(resolveScriptsPath(), 'eye_tracker.py');
    const pythonPath = this._getPythonPath();

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, [scriptPath, '--mode', 'snapshot_camera', '--camera_index', String(cameraIndex)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.on('exit', () => {
        try {
          const data = JSON.parse(output.trim());
          resolve(data);
        } catch {
          resolve({ error: 'Failed to read camera preview' });
        }
      });
      proc.on('error', () => resolve({ error: 'Failed to start camera preview' }));

      setTimeout(() => {
        proc.kill();
        resolve({ error: 'Camera preview timed out' });
      }, 10000);
    });
  }

  /**
   * Full per-backend diagnostics for one camera index — used to debug Windows
   * Hello IR cameras that fail to enumerate or return bad frames.
   */
  async diagnoseCamera(cameraIndex) {
    const scriptPath = path.join(resolveScriptsPath(), 'eye_tracker.py');
    const pythonPath = this._getPythonPath();

    return new Promise((resolve) => {
      const proc = spawn(pythonPath, [scriptPath, '--mode', 'diagnose_camera', '--camera_index', String(cameraIndex)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.on('exit', () => {
        try {
          resolve(JSON.parse(output.trim()));
        } catch {
          resolve({ error: 'Failed to read camera diagnostics' });
        }
      });
      proc.on('error', () => resolve({ error: 'Failed to start camera diagnostics' }));

      setTimeout(() => {
        proc.kill();
        resolve({ error: 'Camera diagnostics timed out' });
      }, 15000);
    });
  }

  /**
   * Update internal state and notify listeners.
   */
  _setState(newState) {
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(newState);
    }
  }
}

module.exports = { EyeTrackingManager };
