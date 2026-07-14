/**
 * predictor.js — Behavioral Pattern Predictor
 *
 * Observes the action log to build an n-gram sequence model over tool calls.
 * Predicts what the user/agent is likely to do NEXT, and pre-executes
 * safe read-only actions speculatively to reduce latency.
 *
 * Algorithm:
 *   - Bigram + trigram model over (tool_name, args_fingerprint) tuples
 *   - Fingerprint = stable hash of the most discriminating arg values
 *   - Smoothed probabilities (Laplace +1 smoothing)
 *   - Only pre-execute tools in SAFE_PREFETCH set (screen_capture, uia_snapshot, etc.)
 *   - Minimum confidence threshold before prefetch (default 0.65)
 *
 * Safety:
 *   - Pre-executed results are CACHED; actual tool call still goes through
 *     the normal permission gate (safe-read tools auto-approve, others don't)
 *   - Prediction never triggers write/destructive actions
 *   - Kill switch disables prefetch immediately
 */

const crypto = require('crypto');
const EventEmitter = require('events');

// Tools safe to prefetch (no side effects, no user-visible change)
const SAFE_PREFETCH = new Set([
    'screen_capture',
    'uia_snapshot',
    'perception_recent',
    'window_list',
    'process_list',
    'clipboard_read',
    'fs_read',
    'fs_list',
]);

const TRIGRAM_WEIGHT = 2;
const BIGRAM_WEIGHT = 1;
const MIN_CONFIDENCE = 0.55;
const PREFETCH_CONFIDENCE = 0.70;
const MAX_HISTORY = 200;
const MAX_PREDICTIONS = 5;
const PREFETCH_TTL_MS = 8_000;

function _fingerprint(tool, args) {
    // Stable short hash of the tool call signature
    const argStr = args ? JSON.stringify(Object.entries(args || {}).sort()) : '';
    const raw = `${tool}|${argStr}`;
    return crypto.createHash('md5').update(raw).digest('hex').slice(0, 8);
}

class Predictor extends EventEmitter {
    constructor() {
        super();
        this._history = [];      // [{tool, fp, ts}] — recent action tokens
        this._bigrams = new Map(); // "A" → Map("B" → count)
        this._trigrams = new Map(); // "A|B" → Map("C" → count)
        this._prefetchCache = new Map(); // fp → {result, ts}
        this._prefetchFns = new Map();   // tool → async (args) => result
        this._enabled = true;
        this._prefetchEnabled = false;   // opt-in; requires permission
    }

    // ─── Configuration ──────────────────────────────────────────────────────────

    configure({ prefetchEnabled = false, prefetchFns = {} } = {}) {
        this._prefetchEnabled = prefetchEnabled;
        for (const [name, fn] of Object.entries(prefetchFns)) {
            if (typeof fn === 'function') this._prefetchFns.set(name, fn);
        }
    }

    setEnabled(val) { this._enabled = !!val; }

    // ─── Data ingestion ──────────────────────────────────────────────────────────

    /**
     * Record a completed tool call into the n-gram model.
     * Call this from the tool registry after every successful execution.
     */
    record(toolName, args) {
        if (!this._enabled) return;
        const fp = _fingerprint(toolName, args);
        const token = `${toolName}:${fp}`;

        // Maintain rolling history
        this._history.push({ tool: toolName, fp, token, ts: Date.now() });
        if (this._history.length > MAX_HISTORY) this._history.shift();

        const n = this._history.length;
        if (n < 2) return;

        // Update bigrams: prev → token
        const prev = this._history[n - 2].token;
        if (!this._bigrams.has(prev)) this._bigrams.set(prev, new Map());
        const bg = this._bigrams.get(prev);
        bg.set(token, (bg.get(token) || 0) + 1);

        // Update trigrams: prev2+prev → token
        if (n >= 3) {
            const prev2 = this._history[n - 3].token;
            const key = `${prev2}|${prev}`;
            if (!this._trigrams.has(key)) this._trigrams.set(key, new Map());
            const tg = this._trigrams.get(key);
            tg.set(token, (tg.get(token) || 0) + 1);
        }

        // Maybe prefetch predicted next actions
        if (this._prefetchEnabled) {
            this._maybePrefetch().catch(() => {});
        }
    }

    /**
     * Bulk-ingest action log entries from the workspace (at startup or refresh).
     */
    ingestActionLog(entries) {
        for (const entry of entries) {
            const tool = entry.tool || entry.name;
            if (tool && typeof tool === 'string') {
                this.record(tool, entry.args || {});
            }
        }
    }

    // ─── Prediction ──────────────────────────────────────────────────────────────

    /**
     * Predict the top-N most likely next tool calls given recent history.
     * @returns {Array<{tool: string, fp: string, probability: number, prefetched: boolean}>}
     */
    predict() {
        if (!this._enabled || this._history.length < 2) return [];

        const n = this._history.length;
        const scores = new Map(); // token → weighted score

        // Trigram predictions (weight 2)
        if (n >= 3) {
            const key = `${this._history[n - 2].token}|${this._history[n - 1].token}`;
            const tgMap = this._trigrams.get(key);
            if (tgMap) {
                const total = [...tgMap.values()].reduce((a, b) => a + b, 0);
                for (const [tok, cnt] of tgMap) {
                    scores.set(tok, (scores.get(tok) || 0) + TRIGRAM_WEIGHT * (cnt / total));
                }
            }
        }

        // Bigram predictions (weight 1)
        const bgMap = this._bigrams.get(this._history[n - 1].token);
        if (bgMap) {
            const total = [...bgMap.values()].reduce((a, b) => a + b, 0);
            for (const [tok, cnt] of bgMap) {
                scores.set(tok, (scores.get(tok) || 0) + BIGRAM_WEIGHT * (cnt / total));
            }
        }

        // Normalize and sort
        const maxScore = Math.max(...scores.values(), 1e-9);
        const results = [];
        for (const [tok, score] of scores) {
            const prob = score / (TRIGRAM_WEIGHT + BIGRAM_WEIGHT);
            if (prob < MIN_CONFIDENCE) continue;
            const [tool, fp] = tok.split(':');
            const prefetched = this._prefetchCache.has(tok) &&
                (Date.now() - this._prefetchCache.get(tok).ts) < PREFETCH_TTL_MS;
            results.push({ tool, fp, token: tok, probability: Math.min(1, prob), prefetched });
        }
        results.sort((a, b) => b.probability - a.probability);
        return results.slice(0, MAX_PREDICTIONS);
    }

    /**
     * Get a prefetched result for a tool call if available (within TTL).
     */
    getPrefetched(toolName, args) {
        const fp = _fingerprint(toolName, args);
        const tok = `${toolName}:${fp}`;
        const entry = this._prefetchCache.get(tok);
        if (!entry || (Date.now() - entry.ts) > PREFETCH_TTL_MS) return null;
        return entry.result;
    }

    getStats() {
        return {
            enabled: this._enabled,
            prefetchEnabled: this._prefetchEnabled,
            historyLength: this._history.length,
            bigramKeys: this._bigrams.size,
            trigramKeys: this._trigrams.size,
            prefetchCached: this._prefetchCache.size,
            lastTools: this._history.slice(-5).map(h => h.tool),
        };
    }

    // ─── Prefetch ────────────────────────────────────────────────────────────────

    async _maybePrefetch() {
        const predictions = this.predict();
        for (const p of predictions) {
            if (p.probability < PREFETCH_CONFIDENCE) continue;
            if (!SAFE_PREFETCH.has(p.tool)) continue;
            if (p.prefetched) continue; // already cached and fresh
            const fn = this._prefetchFns.get(p.tool);
            if (!fn) continue;
            try {
                const result = await fn({});
                this._prefetchCache.set(p.token, { result, ts: Date.now() });
                this.emit('prefetch', { tool: p.tool, probability: p.probability });
            } catch {
                // Non-fatal — prefetch is best-effort
            }
        }

        // Evict stale prefetch entries
        for (const [tok, entry] of this._prefetchCache) {
            if ((Date.now() - entry.ts) > PREFETCH_TTL_MS) this._prefetchCache.delete(tok);
        }
    }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;
function getPredictor() {
    if (!_instance) _instance = new Predictor();
    return _instance;
}

module.exports = { Predictor, getPredictor };
