/**
 * Python Manager — Detects Python installation, manages venv, and installs dependencies.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const VENV_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'CSimple', 'venv'
);

class PythonManager {
  constructor() {
    this.pythonExe = null;
    this.venvPython = null;
    this.setupProcess = null;
    this.isReady = false;
    this._listeners = [];
  }

  /**
   * Emit status updates to listeners (for tray tooltip, etc.)
   */
  onStatus(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  _emit(status, detail = '') {
    for (const cb of this._listeners) {
      try { cb(status, detail); } catch { /* ignore */ }
    }
  }

  /**
   * Find a working Python 3 executable on the system.
   * @returns {string|null} The command name or path, or null if not found.
   */
  findPython() {
    if (this.pythonExe) return this.pythonExe;

    const candidates = ['python', 'python3', 'py'];
    for (const cmd of candidates) {
      try {
        const result = execSync(`${cmd} --version`, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (result.includes('Python 3')) {
          this.pythonExe = cmd;
          console.log(`[PythonManager] Found Python: ${cmd} → ${result.trim()}`);
          return cmd;
        }
      } catch {
        // Try next
      }
    }

    console.error('[PythonManager] Python 3 not found on system');
    return null;
  }

  /**
   * Check if the venv exists and has pip installed.
   */
  isVenvReady() {
    const venvPython = this._getVenvPython();
    if (!venvPython || !fs.existsSync(venvPython)) return false;

    try {
      execSync(`"${venvPython}" -c "import pip"`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if torch and transformers are installed in the venv.
   */
  areDependenciesInstalled() {
    const venvPython = this._getVenvPython();
    if (!venvPython || !fs.existsSync(venvPython)) return false;

    try {
      execSync(`"${venvPython}" -c "import torch; import transformers; print('ok')"`, {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the path to the Python executable inside the venv.
   */
  _getVenvPython() {
    if (this.venvPython) return this.venvPython;

    const winPath = path.join(VENV_PATH, 'Scripts', 'python.exe');
    const unixPath = path.join(VENV_PATH, 'bin', 'python');

    if (fs.existsSync(winPath)) {
      this.venvPython = winPath;
      return winPath;
    }
    if (fs.existsSync(unixPath)) {
      this.venvPython = unixPath;
      return unixPath;
    }
    return null;
  }

  /**
   * Create the virtual environment if it doesn't exist.
   * @returns {Promise<boolean>} True if venv is ready.
   */
  async createVenv() {
    if (this.isVenvReady()) {
      console.log('[PythonManager] Venv already exists and is ready');
      return true;
    }

    const python = this.findPython();
    if (!python) {
      this._emit('error', 'Python 3 not found. Please install Python 3.8+ from python.org');
      return false;
    }

    this._emit('setup', 'Creating Python virtual environment...');
    console.log(`[PythonManager] Creating venv at ${VENV_PATH}`);

    return new Promise((resolve) => {
      const proc = spawn(python, ['-m', 'venv', VENV_PATH], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && this._getVenvPython()) {
          console.log('[PythonManager] Venv created successfully');
          this._emit('setup', 'Virtual environment created');
          resolve(true);
        } else {
          console.error(`[PythonManager] Venv creation failed (code ${code}): ${stderr}`);
          this._emit('error', `Venv creation failed: ${stderr.substring(0, 200)}`);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        console.error(`[PythonManager] Venv creation error: ${err.message}`);
        this._emit('error', `Failed to create venv: ${err.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Install Python dependencies from requirements.txt into the venv.
   * @param {string} requirementsPath - Path to requirements.txt
   * @returns {Promise<boolean>}
   */
  async installDependencies(requirementsPath) {
    if (this.areDependenciesInstalled()) {
      console.log('[PythonManager] Dependencies already installed');
      this.isReady = true;
      this._emit('ready', 'All dependencies installed');
      return true;
    }

    const venvPython = this._getVenvPython();
    if (!venvPython) {
      this._emit('error', 'Virtual environment not found');
      return false;
    }

    if (!fs.existsSync(requirementsPath)) {
      console.warn(`[PythonManager] requirements.txt not found at ${requirementsPath}`);
      this._emit('error', 'requirements.txt not found');
      return false;
    }

    this._emit('installing', 'Installing Python dependencies (this may take a while for PyTorch ~2GB)...');
    console.log(`[PythonManager] Installing dependencies from ${requirementsPath}`);

    return new Promise((resolve) => {
      // Use pip from the venv
      const pipPath = path.join(path.dirname(venvPython), 'pip');
      const proc = spawn(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 0, // No timeout — torch download can take a very long time
        env: { ...process.env, VIRTUAL_ENV: VENV_PATH },
      });

      this.setupProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;

        // Parse progress messages for UI updates
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (line.includes('Downloading') || line.includes('Installing') || line.includes('Collecting')) {
            this._emit('installing', line.trim().substring(0, 100));
          }
        }
      });

      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        this.setupProcess = null;
        if (code === 0) {
          console.log('[PythonManager] Dependencies installed successfully');
          this.isReady = true;
          this._emit('ready', 'All dependencies installed');
          resolve(true);
        } else {
          console.error(`[PythonManager] pip install failed (code ${code})`);
          console.error(stderr.substring(0, 500));
          this._emit('error', `Dependency installation failed. Check logs for details.`);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        this.setupProcess = null;
        this._emit('error', `pip install error: ${err.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Full setup: find Python → create venv → install dependencies.
   * @param {string} requirementsPath
   * @returns {Promise<boolean>}
   */
  async setup(requirementsPath) {
    // Step 1: Find Python
    const python = this.findPython();
    if (!python) {
      this._emit('error', 'Python 3 not found. Please install Python 3.8+ from https://python.org');
      return false;
    }
    this._emit('setup', `Found ${python}`);

    // Step 2: Create venv
    const venvOk = await this.createVenv();
    if (!venvOk) return false;

    // Step 3: Install dependencies
    const depsOk = await this.installDependencies(requirementsPath);
    return depsOk;
  }

  /**
   * Get the status of the Python environment.
   */
  getStatus() {
    return {
      pythonFound: !!this.pythonExe,
      pythonExe: this.pythonExe,
      venvPath: VENV_PATH,
      venvReady: this.isVenvReady(),
      dependenciesInstalled: this.isReady || this.areDependenciesInstalled(),
      isSetupRunning: !!this.setupProcess,
    };
  }

  /**
   * Cancel any running setup process.
   */
  cancelSetup() {
    if (this.setupProcess) {
      this.setupProcess.kill('SIGTERM');
      this.setupProcess = null;
      this._emit('cancelled', 'Setup cancelled');
    }
  }
}

module.exports = { PythonManager, VENV_PATH };
