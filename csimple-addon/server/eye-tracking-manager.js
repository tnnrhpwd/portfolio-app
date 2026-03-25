/**
 * CSimple Addon — Eye Tracking Manager
 *
 * Manages the Python eye_tracker.py subprocess and a persistent PowerShell
 * process for low-latency cursor movement. Provides start/stop/calibrate API.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

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
  if (global.CSIMPLE_RESOURCES_PATH) return global.CSIMPLE_RESOURCES_PATH;
  return path.join(os.homedir(), 'Documents', 'CSimple', 'Resources');
}

class EyeTrackingManager {
  constructor() {
    this.state = 'idle'; // idle | running | calibrating | error
    this.pythonProcess = null;
    this.cursorProcess = null;
    this.startTime = null;
    this.duration = 0;
    this.cameraIndex = 0;
    this.lastError = null;
    this.onStateChange = null; // callback for tray updates
    this._stdinWriter = null;
  }

  /**
   * Get the Python executable path (from venv or system).
   */
  _getPythonPath() {
    const venvDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CSimple', 'venv');
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
}
"@
while ($true) {
    $line = [Console]::ReadLine()
    if ($line -eq 'quit') { break }
    $parts = $line.Split(',')
    if ($parts.Length -eq 2) {
        [CursorHelper]::SetCursorPos([int]$parts[0], [int]$parts[1])
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
    this.cursorProcess.stdin.write(`${Math.round(x)},${Math.round(y)}\n`);
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
   * Start eye tracking.
   * @param {Object} options
   * @param {number} options.cameraIndex - Webcam index (default: 0)
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

    this.cameraIndex = options.cameraIndex ?? 0;
    this.duration = options.duration ?? 0;

    const screen = this._getScreenSize();
    const scriptPath = path.join(resolveScriptsPath(), 'eye_tracker.py');

    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: 'eye_tracker.py not found' };
    }

    // Load settings for smoothing/confidence
    let smoothing = 0.3;
    let confidence = 0.6;
    try {
      const settingsPath = path.join(resourcesPath, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settings.eyeTracking) {
          smoothing = settings.eyeTracking.smoothingAlpha ?? smoothing;
          confidence = settings.eyeTracking.confidenceThreshold ?? confidence;
        }
      }
    } catch {}

    const pythonPath = this._getPythonPath();
    const args = [
      scriptPath,
      '--camera_index', String(this.cameraIndex),
      '--screen_width', String(screen.width),
      '--screen_height', String(screen.height),
      '--calibration_file', calFile,
      '--duration', String(this.duration),
      '--mode', 'track',
      '--smoothing', String(smoothing),
      '--confidence_threshold', String(confidence),
    ];

    return new Promise((resolve) => {
      try {
        this.pythonProcess = spawn(pythonPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        this._stdinWriter = this.pythonProcess.stdin;

        // Start the cursor mover
        this._startCursorProcess();

        // Read stdout line-by-line
        const rl = readline.createInterface({ input: this.pythonProcess.stdout });
        rl.on('line', (line) => {
          try {
            const data = JSON.parse(line);

            if (data.status === 'stopped' || data.status === 'duration_complete') {
              this._setState('idle');
              return;
            }

            if (data.error) {
              this.lastError = data.error;
              return;
            }

            if (typeof data.x === 'number' && typeof data.y === 'number') {
              if (data.confidence >= confidence) {
                this._moveCursor(data.x, data.y);
              }
            }
          } catch {}
        });

        // Handle stderr
        this.pythonProcess.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) console.error('[EyeTracking] Python stderr:', msg);
        });

        this.pythonProcess.on('exit', (code) => {
          console.log(`[EyeTracking] Python process exited with code ${code}`);
          this.pythonProcess = null;
          this._stdinWriter = null;
          this._stopCursorProcess();
          this._setState('idle');
        });

        this.pythonProcess.on('error', (err) => {
          console.error('[EyeTracking] Failed to start Python process:', err.message);
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

    // Give it a moment to exit cleanly, then force kill
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pythonProcess) {
          this.pythonProcess.kill();
          this.pythonProcess = null;
        }
        resolve();
      }, 3000);

      if (this.pythonProcess) {
        this.pythonProcess.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    this._stopCursorProcess();
    this._stdinWriter = null;
    this._setState('idle');
    console.log('[EyeTracking] Stopped');
    return { success: true };
  }

  /**
   * Start calibration mode — spawns eye_tracker.py in calibrate mode.
   * The calibration window will send points via sendCalibrationPoint().
   */
  async startCalibration(cameraIndex = 0) {
    if (this.state === 'running') {
      await this.stop();
    }

    this.cameraIndex = cameraIndex;
    const screen = this._getScreenSize();
    const scriptPath = path.join(resolveScriptsPath(), 'eye_tracker.py');
    const pythonPath = this._getPythonPath();

    const args = [
      scriptPath,
      '--camera_index', String(this.cameraIndex),
      '--screen_width', String(screen.width),
      '--screen_height', String(screen.height),
      '--mode', 'calibrate',
    ];

    return new Promise((resolve) => {
      try {
        this.pythonProcess = spawn(pythonPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        this._stdinWriter = this.pythonProcess.stdin;

        const rl = readline.createInterface({ input: this.pythonProcess.stdout });
        rl.on('line', (line) => {
          try {
            const data = JSON.parse(line);
            if (data.calibration === 'complete') {
              console.log(`[EyeTracking] Calibration complete: ${data.file}`);
              this._setState('idle');
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

        this.pythonProcess.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) console.error('[EyeTracking] Calibration stderr:', msg);
        });

        this.pythonProcess.on('exit', () => {
          this.pythonProcess = null;
          this._stdinWriter = null;
          if (this.state === 'calibrating') {
            this._setState('idle');
          }
        });

        this.pythonProcess.on('error', (err) => {
          this.lastError = err.message;
          this._setState('error');
          resolve({ success: false, error: err.message });
        });

        this._setState('calibrating');
        console.log('[EyeTracking] Calibration started');
        resolve({ success: true });

      } catch (err) {
        this.lastError = err.message;
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * Send a calibration point to the Python subprocess.
   */
  sendCalibrationPoint(index, screenX, screenY) {
    if (!this._stdinWriter || !this._stdinWriter.writable) {
      return { success: false, error: 'Calibration process not running' };
    }
    this._stdinWriter.write(JSON.stringify({
      cmd: 'calibrate_point',
      index,
      screen_x: screenX,
      screen_y: screenY,
    }) + '\n');
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
          resolve(data.cameras || []);
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
