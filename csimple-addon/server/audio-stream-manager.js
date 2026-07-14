/**
 * AudioStreamManager — manages the voice_pipeline.py subprocess.
 *
 * Provides:
 *   - listen(opts)        → Promise<TranscriptResult>  (record + STT)
 *   - stopListening()     → void
 *   - speak(text, opts)   → Promise<void>  (TTS)
 *   - getStatus()         → { running, listening, model, device, lastLevel }
 *   - listDevices()       → Promise<Device[]>
 *   - setDevice(index)    → Promise<void>
 *   - setModel(size)      → Promise<void>
 *   - on('level', fn)     → EventEmitter subscription
 *   - on('wakeword', fn)
 *   - on('transcript', fn)
 *   - on('error', fn)
 *   - startWakewordLoop() → begins continuous listening; emits 'wakeword' + 'transcript'
 *   - stopWakewordLoop()
 *
 * The subprocess is started lazily on the first call and restarted automatically
 * if it crashes (with exponential backoff, max 5 retries).
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');

const MAX_RESTARTS = 5;
const RESTART_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

class AudioStreamManager extends EventEmitter {
    constructor({ scriptPath, pythonExe } = {}) {
        super();
        this._scriptPath = scriptPath || _resolveVoiceScript();
        this._pythonExe = pythonExe || _resolvePython();
        this._proc = null;
        this._buf = '';
        this._pending = new Map();  // id → {resolve, reject, timeout}
        this._nextId = 1;
        this._restarts = 0;
        this._restartTimer = null;
        this._listening = false;
        this._wakewordLoop = false;
        this._lastLevel = null;
        this._model = 'tiny';
        this._device = null;
        this._devices = [];
        this._starting = false;
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    async listen({ maxSeconds = 10, silenceMs = 800 } = {}) {
        await this._ensureRunning();
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error('listen timed out'));
            }, (maxSeconds + 15) * 1000);
            this._pending.set(id, { resolve, reject, timer, type: 'transcript' });
            this._send({ cmd: 'listen', max_seconds: maxSeconds, silence_ms: silenceMs });
            this._listening = true;
        });
    }

    stopListening() {
        if (!this._proc) return;
        this._send({ cmd: 'stop_listen' });
        this._listening = false;
    }

    async speak(text, { rate = 175, volume = 1.0 } = {}) {
        await this._ensureRunning();
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error('speak timed out after 30s'));
            }, 30_000);
            this._pending.set(id, { resolve, reject, timer, type: 'speak_done' });
            this._send({ cmd: 'speak', text, rate, volume });
        });
    }

    async listDevices() {
        await this._ensureRunning();
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error('listDevices timed out'));
            }, 5000);
            this._pending.set(id, { resolve, reject, timer, type: 'devices' });
            this._send({ cmd: 'list_devices' });
        });
    }

    async setDevice(index) {
        await this._ensureRunning();
        this._device = index;
        this._send({ cmd: 'set_device', index });
    }

    async setModel(size) {
        await this._ensureRunning();
        this._model = size;
        this._send({ cmd: 'set_model', size });
    }

    getStatus() {
        return {
            running: !!this._proc && !this._proc.killed,
            listening: this._listening,
            wakewordLoop: this._wakewordLoop,
            model: this._model,
            device: this._device,
            lastLevel: this._lastLevel,
            devices: this._devices,
            restarts: this._restarts,
        };
    }

    /**
     * Start continuous wakeword detection loop.
     * Emits 'wakeword' when detected, then pauses and restarts.
     */
    startWakewordLoop() {
        if (this._wakewordLoop) return;
        this._wakewordLoop = true;
        this._runWakewordCycle();
    }

    stopWakewordLoop() {
        this._wakewordLoop = false;
        this.stopListening();
    }

    shutdown() {
        this._wakewordLoop = false;
        if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
        if (this._proc) {
            try { this._send({ cmd: 'quit' }); } catch {}
            setTimeout(() => {
                try { this._proc?.kill('SIGKILL'); } catch {}
            }, 1000);
            this._proc = null;
        }
    }

    // ─── Private ───────────────────────────────────────────────────────────────

    async _runWakewordCycle() {
        while (this._wakewordLoop) {
            try {
                await this._ensureRunning();
                // Listen for up to 5s at a time; 1.5s silence to end utterance
                const result = await this.listen({ maxSeconds: 5, silenceMs: 1500 });
                if (result && result.wakeword_detected) {
                    this.emit('wakeword', result);
                }
                // Short pause between cycles
                await _sleep(200);
            } catch (e) {
                if (this._wakewordLoop) {
                    this.emit('error', e);
                    await _sleep(2000);
                }
            }
        }
    }

    _send(obj) {
        if (!this._proc || this._proc.killed) return;
        try {
            this._proc.stdin.write(JSON.stringify(obj) + '\n');
        } catch (e) {
            this.emit('error', new Error(`send failed: ${e.message}`));
        }
    }

    async _ensureRunning() {
        if (this._proc && !this._proc.killed) return;
        if (this._starting) {
            // Wait for startup
            await new Promise(r => this.once('ready', r));
            return;
        }
        await this._start();
    }

    async _start() {
        this._starting = true;
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this._scriptPath)) {
                this._starting = false;
                return reject(new Error(`voice_pipeline.py not found at ${this._scriptPath}`));
            }
            if (!fs.existsSync(this._pythonExe)) {
                this._starting = false;
                return reject(new Error(`Python not found at ${this._pythonExe}`));
            }

            const proc = spawn(this._pythonExe, ['-u', this._scriptPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
            this._proc = proc;
            this._buf = '';

            proc.stdout.on('data', chunk => this._onData(chunk.toString('utf-8')));
            proc.stderr.on('data', chunk => {
                const msg = chunk.toString('utf-8').trim();
                if (msg) this.emit('log', msg);
            });
            proc.on('exit', code => {
                this._proc = null;
                this._listening = false;
                this._starting = false;
                // Reject all pending
                for (const [id, p] of this._pending) {
                    clearTimeout(p.timer);
                    p.reject(new Error('voice process exited'));
                }
                this._pending.clear();
                if (this._wakewordLoop || this._restarts < MAX_RESTARTS) {
                    const delay = RESTART_BACKOFF_MS[Math.min(this._restarts, RESTART_BACKOFF_MS.length - 1)];
                    this._restarts++;
                    this._restartTimer = setTimeout(() => this._start().catch(e => this.emit('error', e)), delay);
                }
                this.emit('exit', code);
            });
            proc.on('error', err => {
                this._starting = false;
                reject(err);
            });

            // Wait for 'ready' message before resolving
            const onMsg = (msg) => {
                if (msg.type === 'ready') {
                    this._devices = msg.devices || [];
                    this._starting = false;
                    this._restarts = 0;
                    this.emit('ready', msg);
                    resolve();
                } else if (msg.type === 'error') {
                    this._starting = false;
                    reject(new Error(msg.message));
                }
            };
            this.once('_msg', onMsg);
        });
    }

    _onData(chunk) {
        this._buf += chunk;
        const lines = this._buf.split('\n');
        this._buf = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed);
                this._handleMsg(msg);
            } catch {
                // Not JSON — stderr/debug line
                this.emit('log', trimmed);
            }
        }
    }

    _handleMsg(msg) {
        this.emit('_msg', msg);
        switch (msg.type) {
            case 'level':
                this._lastLevel = { rms: msg.rms, speaking: msg.speaking, ts: Date.now() };
                this.emit('level', msg);
                break;
            case 'wakeword':
                this.emit('wakeword', msg);
                break;
            case 'transcript':
                this._listening = false;
                this.emit('transcript', msg);
                // Resolve any pending listen() promise
                for (const [id, p] of this._pending) {
                    if (p.type === 'transcript') {
                        clearTimeout(p.timer);
                        this._pending.delete(id);
                        p.resolve(msg);
                        break;
                    }
                }
                break;
            case 'speak_done':
                for (const [id, p] of this._pending) {
                    if (p.type === 'speak_done') {
                        clearTimeout(p.timer);
                        this._pending.delete(id);
                        p.resolve();
                        break;
                    }
                }
                break;
            case 'devices':
                this._devices = msg.devices || [];
                for (const [id, p] of this._pending) {
                    if (p.type === 'devices') {
                        clearTimeout(p.timer);
                        this._pending.delete(id);
                        p.resolve(msg.devices || []);
                        break;
                    }
                }
                break;
            case 'error':
                this.emit('error', new Error(msg.message));
                // Reject oldest pending
                for (const [id, p] of this._pending) {
                    clearTimeout(p.timer);
                    this._pending.delete(id);
                    p.reject(new Error(msg.message));
                    break;
                }
                break;
            case 'ready':
            case 'ok':
            case 'stopped':
            case 'status':
                this.emit(msg.type, msg);
                break;
            default:
                this.emit('message', msg);
        }
    }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function _resolveVoiceScript() {
    if (process.resourcesPath) {
        const p = path.join(process.resourcesPath, 'scripts', 'voice_pipeline.py');
        if (fs.existsSync(p)) return p;
    }
    return path.join(__dirname, '..', 'scripts', 'voice_pipeline.py');
}

function _resolvePython() {
    const venvBase = path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'CSimple', 'venv'
    );
    const candidates = [
        path.join(venvBase, 'Scripts', 'python.exe'),  // Windows venv
        path.join(venvBase, 'bin', 'python3'),          // Linux/Mac venv
        'python3',
        'python',
    ];
    for (const c of candidates) {
        try {
            if (!c.includes('/') && !c.includes('\\')) return c; // system python — let OS find it
            if (fs.existsSync(c)) return c;
        } catch {}
    }
    return 'python';
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;
function getAudioStreamManager(opts) {
    if (!_instance) _instance = new AudioStreamManager(opts);
    return _instance;
}

module.exports = { AudioStreamManager, getAudioStreamManager };
