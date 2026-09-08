/**
 * AppAudioManager — records application/system audio (WASAPI loopback) to MP3.
 *
 * Flow:
 *   - listApps()  → running windowed apps (PowerShell Get-Process)
 *   - start({appName, appPid}) → spawn app_audio_recorder.py, begin loopback capture
 *   - stop()      → finalize capture, encode raw PCM → MP3 (lamejs, bundled)
 *   - getStatus() → { recording, startedAt, app, level, lastRecording }
 *   - getRecordings() / getRecordingPath(name)
 *
 * The recorder subprocess writes raw interleaved int16 PCM to a temp file;
 * this manager reads it and encodes MP3 in-process (no ffmpeg dependency).
 */

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');

const MP3_BITRATE = 192;
const SAMPLE_BLOCK = 1152; // MP3 frame size — fixed by LAME

class AppAudioManager extends EventEmitter {
  constructor({ scriptPath, pythonExe, recordingsDir } = {}) {
    super();
    this._scriptPath = scriptPath || _resolveScript();
    this._pythonExe = pythonExe || _resolvePython();
    this._recordingsDir = recordingsDir || _resolveRecordingsDir();

    this._proc = null;
    this._buf = '';
    this._recording = false;
    this._startedAt = null;
    this._app = null;
    this._level = 0;
    this._lastRecording = null;
    this._soundcardChecked = false;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** List running windowed applications (deduped by process name). */
  async listApps() {
    const script = [
      'Get-Process | Where-Object { $_.MainWindowTitle } |',
      'Select-Object Id, ProcessName, MainWindowTitle |',
      'Sort-Object ProcessName | ConvertTo-Json -Compress',
    ].join(' ');
    try {
      const out = await _runPowerShell(script);
      const parsed = out ? JSON.parse(out) : [];
      const list = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
      const seen = new Set();
      const apps = [];
      for (const p of list) {
        const name = p.ProcessName || 'unknown';
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        apps.push({ pid: p.Id, name, title: p.MainWindowTitle || '' });
      }
      return apps;
    } catch (e) {
      this.emit('error', e);
      return [];
    }
  }

  /** Begin recording loopback audio. */
  async start({ appName, appPid } = {}) {
    if (this._recording) throw new Error('Already recording');
    await this._ensureRunning();
    this._app = appName || 'System Audio';
    this._appPid = appPid || null;
    this._startedAt = Date.now();
    this._level = 0;
    this._recording = true;
    this._send({ cmd: 'start' });
    return { ok: true, recording: true, app: this._app };
  }

  /** Stop recording, encode MP3, and return the saved file info. */
  async stop() {
    if (!this._recording) {
      throw new Error('Not recording');
    }
    const result = await this._request('stop');
    this._recording = false;

    const pcmFile = result.file;
    const sampleRate = result.sample_rate || 48000;
    const channels = result.channels || 2;
    const durationS = result.duration_s || 0;

    if (!pcmFile || !fs.existsSync(pcmFile) || (result.bytes || 0) === 0) {
      this._cleanupPcm(pcmFile);
      throw new Error('No audio was captured (is the selected app playing sound?)');
    }

    try {
      const mp3 = await this._encodeMp3(pcmFile, sampleRate, channels);
      const name = this._makeFileName(durationS);
      fs.mkdirSync(this._recordingsDir, { recursive: true });
      const target = path.join(this._recordingsDir, name);
      fs.writeFileSync(target, mp3);
      this._lastRecording = {
        name,
        file: target,
        size: mp3.length,
        durationS,
        app: this._app,
        recordedAt: new Date().toISOString(),
      };
      this.emit('recording', this._lastRecording);
      return { ok: true, recording: this._lastRecording };
    } finally {
      this._cleanupPcm(pcmFile);
    }
  }

  getStatus() {
    return {
      recording: this._recording,
      startedAt: this._startedAt,
      app: this._app,
      level: this._level,
      lastRecording: this._lastRecording,
      recordingsDir: this._recordingsDir,
    };
  }

  /** List saved MP3 recordings (newest first). */
  getRecordings() {
    try {
      if (!fs.existsSync(this._recordingsDir)) return [];
      return fs.readdirSync(this._recordingsDir)
        .filter(f => f.toLowerCase().endsWith('.mp3'))
        .map(f => {
          const st = fs.statSync(path.join(this._recordingsDir, f));
          return { name: f, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      return [];
    }
  }

  /** Resolve a recording file path by basename (path-traversal safe). */
  getRecordingPath(name) {
    if (typeof name !== 'string' || !name) return null;
    const base = path.basename(name);
    if (!base.toLowerCase().endsWith('.mp3')) return null;
    const full = path.join(this._recordingsDir, base);
    return fs.existsSync(full) ? full : null;
  }

  shutdown() {
    this._recording = false;
    if (this._proc) {
      try { this._send({ cmd: 'quit' }); } catch {}
      setTimeout(() => {
        try { this._proc?.kill('SIGKILL'); } catch {}
      }, 1000);
      this._proc = null;
    }
  }

  // ─── MP3 encoding ──────────────────────────────────────────────────────────

  async _encodeMp3(pcmPath, sampleRate, channels) {
    const { getLamejs } = require('./mp3-encoder');
    const lamejs = getLamejs();
    const buf = fs.readFileSync(pcmPath);
    // Byte length must be a whole number of samples (channels * 2 bytes each)
    const sampleBytes = channels * 2;
    const usable = buf.length - (buf.length % sampleBytes);
    const samples = new Int16Array(buf.buffer, buf.byteOffset, usable / 2);
    const sampleRateSafe = [44100, 48000, 32000].includes(sampleRate) ? sampleRate : 48000;

    const encoder = new lamejs.Mp3Encoder(channels === 1 ? 1 : 2, sampleRateSafe, MP3_BITRATE);
    const chunks = [];

    if (channels === 1) {
      const block = new Int16Array(SAMPLE_BLOCK);
      for (let i = 0; i < samples.length; i += SAMPLE_BLOCK) {
        const n = Math.min(SAMPLE_BLOCK, samples.length - i);
        block.set(samples.subarray(i, i + n));
        if (n < SAMPLE_BLOCK) block.fill(0, n);
        const mp3buf = encoder.encodeBuffer(block);
        if (mp3buf.length > 0) chunks.push(Buffer.from(mp3buf));
      }
    } else {
      const left = new Int16Array(SAMPLE_BLOCK);
      const right = new Int16Array(SAMPLE_BLOCK);
      for (let i = 0; i + 1 < samples.length; i += 2 * SAMPLE_BLOCK) {
        for (let j = 0; j < SAMPLE_BLOCK; j++) {
          const k = i + 2 * j;
          left[j] = k < samples.length ? samples[k] : 0;
          right[j] = k + 1 < samples.length ? samples[k + 1] : 0;
        }
        const mp3buf = encoder.encodeBuffer(left, right);
        if (mp3buf.length > 0) chunks.push(Buffer.from(mp3buf));
      }
    }

    const tail = encoder.flush();
    if (tail.length > 0) chunks.push(Buffer.from(tail));
    return Buffer.concat(chunks);
  }

  _makeFileName(durationS) {
    const safe = String(this._app || 'System Audio')
      .replace(/[^a-z0-9\-_ ]/gi, '')
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'System-Audio';
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    return `${safe}__${ts}.mp3`;
  }

  _cleanupPcm(pcmPath) {
    if (pcmPath) {
      try { fs.unlinkSync(pcmPath); } catch {}
    }
  }

  // ─── Subprocess plumbing (mirrors audio-stream-manager) ────────────────────

  _send(obj) {
    if (!this._proc || this._proc.killed) return;
    try { this._proc.stdin.write(JSON.stringify(obj) + '\n'); } catch {}
  }

  /**
   * The recorder depends on python-soundcard (WASAPI loopback). Existing venvs
   * predate it, so self-heal once: verify it imports, else pip-install it.
   */
  async _ensureSoundcard() {
    if (this._soundcardChecked) return;
    this._soundcardChecked = true;
    try {
      await _run(this._pythonExe, ['-c', 'import soundcard']);
    } catch {
      try {
        await _run(this._pythonExe, ['-m', 'pip', 'install', 'soundcard', '--quiet', '--disable-pip-version-check']);
      } catch (e) {
        this.emit('log', `soundcard install failed: ${e.message}`);
      }
    }
  }

  _request(cmd, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending = null;
        reject(new Error(`app-audio ${cmd} timed out`));
      }, timeoutMs);
      this._pending = { cmd, resolve, reject, timer };
      this._send({ cmd });
    });
  }

  async _ensureRunning() {
    if (this._proc && !this._proc.killed) return;
    if (!fs.existsSync(this._scriptPath)) {
      throw new Error(`app_audio_recorder.py not found at ${this._scriptPath}`);
    }
    if (!fs.existsSync(this._pythonExe) && !_isSystemPython(this._pythonExe)) {
      throw new Error(`Python not found at ${this._pythonExe}`);
    }
    await this._ensureSoundcard();
    return new Promise((resolve, reject) => {
      const proc = spawn(this._pythonExe, ['-u', this._scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this._proc = proc;
      this._buf = '';

      proc.stdout.on('data', chunk => this._onData(chunk.toString('utf-8')));
      proc.stderr.on('data', chunk => this.emit('log', chunk.toString('utf-8').trim()));
      proc.on('error', reject);
      proc.on('exit', () => {
        this._proc = null;
        this._recording = false;
        if (this._pending) {
          clearTimeout(this._pending.timer);
          this._pending.reject(new Error('app-audio process exited'));
          this._pending = null;
        }
      });

      const onMsg = msg => {
        if (msg.type === 'ready') {
          this.emit('ready');
          resolve();
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      };
      this._waitingReady = onMsg;
    });
  }

  _onData(chunk) {
    this._buf += chunk;
    const lines = this._buf.split('\n');
    this._buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        this._handleMsg(JSON.parse(t));
      } catch {
        this.emit('log', t);
      }
    }
  }

  _handleMsg(msg) {
    if (this._waitingReady && (msg.type === 'ready' || msg.type === 'error')) {
      const cb = this._waitingReady;
      this._waitingReady = null;
      cb(msg);
      if (msg.type === 'error') return;
    }
    switch (msg.type) {
      case 'level':
        this._level = msg.rms || 0;
        this.emit('level', msg);
        break;
      case 'status':
        this.emit('status', msg);
        break;
      case 'stopped':
      case 'ok':
        this._resolvePending(msg);
        break;
      case 'error':
        this.emit('error', new Error(msg.message));
        this._resolvePending(msg, true);
        break;
      default:
        this.emit('message', msg);
    }
  }

  _resolvePending(msg, isError = false) {
    if (!this._pending) return;
    const p = this._pending;
    this._pending = null;
    clearTimeout(p.timer);
    if (isError) p.reject(new Error(msg.message || 'app-audio error'));
    else p.resolve(msg);
  }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function _resolveScript() {
  if (process.resourcesPath) {
    const p = path.join(process.resourcesPath, 'scripts', 'app_audio_recorder.py');
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, '..', 'scripts', 'app_audio_recorder.py');
}

function _isSystemPython(p) {
  return !p.includes('/') && !p.includes('\\');
}

function _resolvePython() {
  const venvBase = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Simple', 'venv'
  );
  const candidates = [
    path.join(venvBase, 'Scripts', 'python.exe'),
    path.join(venvBase, 'bin', 'python3'),
    'python3',
    'python',
  ];
  for (const c of candidates) {
    try {
      if (_isSystemPython(c)) return c;
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return 'python';
}

function _resolveRecordingsDir() {
  const dir = path.join(os.homedir(), 'Documents', 'Simple', 'Recordings');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function _run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error('command timed out'));
    }, timeoutMs);
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`command exited with code ${code}`));
    });
  });
}

function _runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 8000,
    }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || '').trim());
    });
  });
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;
function getAppAudioManager(opts) {
  if (!_instance) _instance = new AppAudioManager(opts);
  return _instance;
}

module.exports = { AppAudioManager, getAppAudioManager };
