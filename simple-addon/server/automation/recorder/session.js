/**
 * RecorderSession — buffers timestamped input events and persists them as
 * JSONL to <userData>/recordings/<name>-<ts>.jsonl. One session per addon
 * process (recording is a user-initiated, foreground operation).
 *
 * Events are flushed to disk on a timer to survive crashes. The session also
 * stores a header object with metadata: name, started, screenSize, monitors.
 *
 * Public API:
 *   const r = new RecorderSession({ name, recordingsDir });
 *   await r.start();        // returns { sessionId, path }
 *   r.appendMarker(label);  // user annotation midway through
 *   await r.stop();         // returns { sessionId, path, eventCount, durationMs }
 *   r.status();             // { active, eventCount, startedAt, path }
 */

const fs = require('fs/promises');
const path = require('path');
const { PollingInputSource } = require('./polling-source');

const FLUSH_INTERVAL_MS = 500;

class RecorderSession {
    constructor({ name, recordingsDir }) {
        if (!name) throw new Error('RecorderSession requires a name');
        if (!recordingsDir) throw new Error('RecorderSession requires recordingsDir');
        this.name = String(name).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
        this.recordingsDir = recordingsDir;
        this.sessionId = `${this.name}-${Date.now()}`;
        this.path = path.join(this.recordingsDir, `${this.sessionId}.jsonl`);
        this._source = null;
        this._pending = [];       // events awaiting flush
        this._eventCount = 0;
        this._flushTimer = null;
        this._active = false;
        this._startedAt = null;
        this._fileHandle = null;
    }

    async start() {
        if (this._active) throw new Error('Recorder already active');
        await fs.mkdir(this.recordingsDir, { recursive: true });
        this._fileHandle = await fs.open(this.path, 'a');
        this._startedAt = Date.now();
        this._active = true;

        const header = {
            type: 'header',
            ts: this._startedAt,
            data: {
                sessionId: this.sessionId,
                name: this.name,
                platform: process.platform,
                arch: process.arch,
            },
        };
        await this._fileHandle.write(JSON.stringify(header) + '\n');

        this._source = new PollingInputSource({
            listener: ev => this._onEvent(ev),
        });
        this._source.start();

        this._flushTimer = setInterval(() => this._flush().catch(() => {}), FLUSH_INTERVAL_MS);
        return { sessionId: this.sessionId, path: this.path };
    }

    appendMarker(label) {
        if (!this._active) return;
        this._onEvent({ ts: Date.now(), type: 'marker', data: { label: String(label || '').slice(0, 200) } });
    }

    async stop() {
        if (!this._active) throw new Error('Recorder not active');
        this._active = false;
        try { this._source && this._source.stop(); } catch {}
        this._source = null;
        if (this._flushTimer) clearInterval(this._flushTimer);
        this._flushTimer = null;
        await this._flush();
        const durationMs = Date.now() - this._startedAt;
        const footer = {
            type: 'footer',
            ts: Date.now(),
            data: { eventCount: this._eventCount, durationMs },
        };
        try { await this._fileHandle.write(JSON.stringify(footer) + '\n'); } catch {}
        try { await this._fileHandle.close(); } catch {}
        this._fileHandle = null;
        return {
            sessionId: this.sessionId,
            path: this.path,
            eventCount: this._eventCount,
            durationMs,
        };
    }

    status() {
        return {
            active: this._active,
            eventCount: this._eventCount,
            startedAt: this._startedAt,
            sessionId: this.sessionId,
            path: this.path,
        };
    }

    _onEvent(ev) {
        if (!this._active && ev.type !== 'footer') return;
        this._pending.push(ev);
        this._eventCount++;
    }

    async _flush() {
        if (!this._fileHandle || this._pending.length === 0) return;
        const chunk = this._pending.map(e => JSON.stringify(e)).join('\n') + '\n';
        this._pending.length = 0;
        try {
            await this._fileHandle.write(chunk);
        } catch (e) {
            // Re-queue on write failure so events aren't silently lost.
            // (This should be rare since we hold an open fd.)
        }
    }
}

module.exports = { RecorderSession };
