/**
 * perception-bus.js — Unified Multimodal Perception Event Bus
 *
 * Collects streams from all input sources and emits unified 'frame' events
 * with a consolidated snapshot of the user's current context. The agent loop
 * and predictor subscribe here for real-time awareness.
 *
 * Sources:
 *   - Screen: periodic PowerShell screenshot (configurable interval)
 *   - Audio:  transcript stream from AudioStreamManager (when active)
 *   - Gaze:   eye position from EyeTrackingManager IPC (when calibrated)
 *   - UIA:    foreground window changes from perception cache pump
 *   - Input:  recent action log tail from workspace (fetched periodically)
 *
 * Emits:
 *   'frame'     — unified PerceptionFrame object
 *   'audio'     — transcript/level from microphone
 *   'gaze'      — eye position update
 *   'window'    — foreground window changed
 *   'error'     — non-fatal error from a source
 *
 * PerceptionFrame shape:
 *   {
 *     ts: number,
 *     seq: number,
 *     screen: { base64? string, width: number, height: number, capturedAt: number } | null,
 *     audio:  { transcript: string, confidence: number, ts: number } | null,
 *     gaze:   { x: number, y: number, confidence: number, ts: number } | null,
 *     window: { title: string, process: string, ts: number } | null,
 *     recentActions: string[],   // last 5 action summaries from log
 *   }
 *
 * Privacy: screen frames are NEVER persisted to disk or sent to cloud.
 * Audio transcripts are NEVER stored beyond the rolling 20-frame buffer.
 */

const EventEmitter = require('events');

const DEFAULT_SCREEN_INTERVAL_MS = 5_000;
const DEFAULT_ACTION_INTERVAL_MS = 10_000;
const HISTORY_SIZE = 20;

class PerceptionBus extends EventEmitter {
    constructor() {
        super();
        this._seq = 0;
        this._history = [];       // rolling array of PerceptionFrame
        this._latestFrame = null;

        // Source state
        this._screen = null;
        this._audio = null;
        this._gaze = null;
        this._window = null;
        this._recentActions = [];

        // Timers
        this._screenTimer = null;
        this._actionTimer = null;
        this._screenIntervalMs = DEFAULT_SCREEN_INTERVAL_MS;
        this._actionIntervalMs = DEFAULT_ACTION_INTERVAL_MS;

        // Injected dependencies (set via configure)
        this._wsClient = null;
        this._audioMgr = null;
        this._eyeTrackingMgr = null;
        this._captureScreen = null;   // async () => {base64, width, height}
        this._uiaPump = null;         // from perception.js

        this._running = false;
    }

    // ─── Configuration ──────────────────────────────────────────────────────────

    configure({
        wsClient,
        audioManager,
        eyeTrackingManager,
        captureScreen,
        screenIntervalMs = DEFAULT_SCREEN_INTERVAL_MS,
        actionIntervalMs = DEFAULT_ACTION_INTERVAL_MS,
    } = {}) {
        this._wsClient = wsClient;
        this._audioMgr = audioManager;
        this._eyeTrackingMgr = eyeTrackingManager;
        this._captureScreen = captureScreen;
        this._screenIntervalMs = Math.max(1000, screenIntervalMs);
        this._actionIntervalMs = Math.max(2000, actionIntervalMs);
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────────

    start() {
        if (this._running) return this;
        this._running = true;

        // Screen capture loop
        if (this._captureScreen) {
            this._scheduleScreen();
        }

        // Action log poll
        if (this._wsClient) {
            this._scheduleActions();
        }

        // Audio: subscribe to audio manager events
        if (this._audioMgr) {
            this._audioMgr.on('transcript', (msg) => {
                if (msg?.text) {
                    this._audio = { transcript: msg.text, confidence: msg.confidence || 0, ts: Date.now() };
                    this.emit('audio', this._audio);
                    this._emitFrame();
                }
            });
            this._audioMgr.on('level', (msg) => {
                this.emit('audio-level', { rms: msg.rms, speaking: msg.speaking });
            });
        }

        // Eye tracking: subscribe if manager is provided
        if (this._eyeTrackingMgr) {
            if (typeof this._eyeTrackingMgr.on === 'function') {
                this._eyeTrackingMgr.on('gaze', (data) => {
                    this._gaze = { x: data.x, y: data.y, confidence: data.confidence || 0, ts: Date.now() };
                    this.emit('gaze', this._gaze);
                });
            }
        }

        return this;
    }

    stop() {
        this._running = false;
        if (this._screenTimer) { clearTimeout(this._screenTimer); this._screenTimer = null; }
        if (this._actionTimer) { clearTimeout(this._actionTimer); this._actionTimer = null; }
        if (this._audioMgr) {
            this._audioMgr.removeAllListeners('transcript');
            this._audioMgr.removeAllListeners('level');
        }
    }

    // ─── External push APIs (called by main.js or eye-tracking-manager) ─────────

    /**
     * Push a gaze update from the eye tracking manager.
     * Called by main.js on tracking data events.
     */
    pushGaze({ x, y, confidence }) {
        this._gaze = { x, y, confidence, ts: Date.now() };
        this.emit('gaze', this._gaze);
    }

    /**
     * Push a foreground window change.
     * Called by the UIA perception pump or main.js window observer.
     */
    pushWindowChange({ title, process: proc }) {
        const prev = this._window?.title;
        this._window = { title, process: proc || '', ts: Date.now() };
        if (title !== prev) {
            this.emit('window', this._window);
            this._emitFrame();
        }
    }

    // ─── Getters ────────────────────────────────────────────────────────────────

    getLatestFrame() { return this._latestFrame; }
    getHistory() { return [...this._history]; }

    getStatus() {
        return {
            running: this._running,
            seq: this._seq,
            hasScreen: !!this._screen,
            hasAudio: !!this._audio,
            hasGaze: !!this._gaze,
            hasWindow: !!this._window,
            recentActions: this._recentActions.length,
            screenIntervalMs: this._screenIntervalMs,
            actionIntervalMs: this._actionIntervalMs,
            latestFrameAge: this._latestFrame ? Date.now() - this._latestFrame.ts : null,
        };
    }

    // ─── Frame emission ──────────────────────────────────────────────────────────

    _emitFrame() {
        const frame = {
            ts: Date.now(),
            seq: ++this._seq,
            screen: this._screen,
            audio: this._audio,
            gaze: this._gaze,
            window: this._window,
            recentActions: [...this._recentActions],
        };
        this._latestFrame = frame;
        this._history.push(frame);
        if (this._history.length > HISTORY_SIZE) this._history.shift();
        this.emit('frame', frame);
    }

    // ─── Screen capture loop ─────────────────────────────────────────────────────

    _scheduleScreen() {
        if (!this._running) return;
        this._screenTimer = setTimeout(async () => {
            if (!this._running) return;
            try {
                const result = await this._captureScreen();
                if (result) {
                    this._screen = {
                        base64: result.base64,
                        width: result.width,
                        height: result.height,
                        capturedAt: Date.now(),
                    };
                    this._emitFrame();
                }
            } catch (e) {
                this.emit('error', new Error('screen capture failed: ' + e.message));
            } finally {
                this._scheduleScreen();
            }
        }, this._screenIntervalMs);
    }

    // ─── Action log poll ─────────────────────────────────────────────────────────

    _scheduleActions() {
        if (!this._running) return;
        this._actionTimer = setTimeout(async () => {
            if (!this._running) return;
            try {
                if (this._wsClient?.getRecentActions) {
                    const actions = await this._wsClient.getRecentActions(5);
                    if (Array.isArray(actions) && actions.length > 0) {
                        this._recentActions = actions.map(a =>
                            typeof a === 'string' ? a : (a.summary || a.tool || JSON.stringify(a)).slice(0, 120)
                        );
                    }
                }
            } catch (e) {
                this.emit('error', new Error('action poll failed: ' + e.message));
            } finally {
                this._scheduleActions();
            }
        }, this._actionIntervalMs);
    }
}

// ─── Context string builder ───────────────────────────────────────────────────

/**
 * Build a short text summary of the latest perception frame for injection
 * into the agent system prompt. Keeps it under 400 chars.
 */
function frameToContextString(frame) {
    if (!frame) return '(no perception data)';
    const parts = [];
    if (frame.window?.title) parts.push(`Foreground: "${frame.window.title}"`);
    if (frame.audio?.transcript) parts.push(`Last heard: "${frame.audio.transcript.slice(0, 120)}"`);
    if (frame.gaze) parts.push(`Gaze: (${Math.round(frame.gaze.x)},${Math.round(frame.gaze.y)})`);
    if (frame.recentActions?.length) {
        parts.push('Recent actions: ' + frame.recentActions.slice(-3).join(' → '));
    }
    return parts.join(' | ').slice(0, 400) || '(no meaningful data)';
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;
function getPerceptionBus() {
    if (!_instance) _instance = new PerceptionBus();
    return _instance;
}

module.exports = { PerceptionBus, getPerceptionBus, frameToContextString };
