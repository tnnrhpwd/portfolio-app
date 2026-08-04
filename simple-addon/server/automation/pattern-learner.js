/**
 * pattern-learner.js — Proactive Automation Suggester
 *
 * Analyzes the workspace action log to detect repeating behavioral patterns
 * and surfaces them as automation suggestions. The user can accept a
 * suggestion to create a goal + pre-compiled skill automatically.
 *
 * Algorithm:
 *   1. Fetch recent action log entries (last 7 days, up to 500 entries)
 *   2. Extract "action fingerprints" — (tool, simplified-args) tuples
 *   3. Find n-gram sequences (length 3-6) that repeat ≥3 times
 *   4. For each repeated sequence, ask the LLM to name it and assess value
 *   5. Emit suggestions with confidence scores
 *   6. User-confirmed suggestions become workspace skills automatically
 *
 * Safety:
 *   - Never auto-creates goals or runs tools — only suggests
 *   - Suggestions are local-only (not sent to any server)
 *   - PII filtering: keyboard capture content is stripped from fingerprints
 *   - Rate-limited: analysis runs at most once per hour
 */

const EventEmitter = require('events');
const crypto = require('crypto');

const MIN_SEQUENCE_LEN = 3;
const MAX_SEQUENCE_LEN = 6;
const MIN_REPEAT_COUNT = 3;
const MAX_SUGGESTIONS = 5;
const ANALYSIS_COOLDOWN_MS = 60 * 60_000; // 1 hour
const MAX_LOG_ENTRIES = 500;

// Tools to include in pattern analysis (exclude read-only boring ones)
const INTERESTING_TOOLS = new Set([
    'shell_run', 'text_type', 'input_tap', 'input_hold', 'click_at',
    'find_and_click_visual', 'uia_invoke', 'window_focus', 'browser_goto',
    'browser_click', 'browser_fill', 'fs_write', 'clipboard_write',
    'skill_run', 'goal_update', 'audio_speak', 'open_app',
]);

// PII-sensitive tools whose args we should never fingerprint by content
const PII_TOOLS = new Set(['text_type', 'clipboard_write', 'audio_speak']);

class PatternLearner extends EventEmitter {
    constructor() {
        super();
        this._lastAnalysis = 0;
        this._suggestions = [];
        this._wsClient = null;
        this._llmClient = null;
        this._running = false;
    }

    configure({ wsClient, llmClient } = {}) {
        this._wsClient = wsClient;
        this._llmClient = llmClient;
    }

    getSuggestions() { return [...this._suggestions]; }

    /**
     * Run pattern analysis. Returns suggestions array.
     * Non-blocking — internally async; emits 'suggestions' when done.
     */
    async analyze({ force = false } = {}) {
        const now = Date.now();
        if (!force && now - this._lastAnalysis < ANALYSIS_COOLDOWN_MS) return this._suggestions;
        if (this._running) return this._suggestions;
        this._running = true;
        this._lastAnalysis = now;

        try {
            const entries = await this._fetchEntries();
            if (entries.length < MIN_SEQUENCE_LEN * MIN_REPEAT_COUNT) {
                return this._suggestions;
            }
            const tokens = this._tokenize(entries);
            const sequences = this._findRepeatedSequences(tokens);
            if (sequences.length === 0) return this._suggestions;

            const suggestions = await this._nameSuggestions(sequences.slice(0, MAX_SUGGESTIONS));
            this._suggestions = suggestions;
            this.emit('suggestions', suggestions);
            return suggestions;
        } catch (e) {
            this.emit('error', e);
            return this._suggestions;
        } finally {
            this._running = false;
        }
    }

    // ── Private ──────────────────────────────────────────────────────────────

    async _fetchEntries() {
        if (!this._wsClient) return [];
        const all = [];
        // Fetch the last 7 days of logs
        for (let i = 0; i < 7; i++) {
            const d = new Date(Date.now() - i * 86400000);
            const dateStr = d.toISOString().slice(0, 10);
            try {
                const slug = `log-${dateStr}`;
                const item = await this._wsClient.req('GET', `/log/${encodeURIComponent(slug)}`).catch(() => null);
                const content = item?.content || item?.text || '';
                if (!content) continue;
                const lines = content.trim().split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.tool) all.push(entry);
                    } catch {}
                }
            } catch {}
        }
        return all.slice(-MAX_LOG_ENTRIES);
    }

    _fingerprint(entry) {
        const tool = entry.tool || entry.name || '';
        if (!INTERESTING_TOOLS.has(tool)) return null;
        // For PII tools, fingerprint only by tool name
        if (PII_TOOLS.has(tool)) return `${tool}:pii`;
        // For other tools, include a simplified args hash (strip values, keep keys)
        const args = entry.args || {};
        const argKeys = Object.keys(args).sort().join(',');
        const argHash = crypto.createHash('md5').update(argKeys).digest('hex').slice(0, 6);
        return `${tool}:${argHash}`;
    }

    _tokenize(entries) {
        return entries
            .map(e => this._fingerprint(e))
            .filter(Boolean);
    }

    _findRepeatedSequences(tokens) {
        const counts = new Map(); // seq_str → { seq, count, indices }

        for (let len = MIN_SEQUENCE_LEN; len <= MAX_SEQUENCE_LEN; len++) {
            for (let i = 0; i <= tokens.length - len; i++) {
                const seq = tokens.slice(i, i + len);
                const key = seq.join('→');
                if (!counts.has(key)) {
                    counts.set(key, { seq, key, count: 0, firstSeen: i });
                }
                counts.get(key).count++;
            }
        }

        // Filter to sequences that repeat enough and aren't sub-sequences of longer ones
        const candidates = [...counts.values()]
            .filter(s => s.count >= MIN_REPEAT_COUNT)
            .sort((a, b) => (b.count * b.seq.length) - (a.count * a.seq.length));

        // De-duplicate: skip a sequence if a longer one with higher score exists that contains it
        const result = [];
        for (const cand of candidates) {
            const isSubSeq = result.some(r => r.key.includes(cand.key) && r.key !== cand.key);
            if (!isSubSeq) result.push(cand);
        }
        return result.slice(0, MAX_SUGGESTIONS);
    }

    async _nameSuggestions(sequences) {
        if (!this._llmClient || sequences.length === 0) {
            // Fallback: generate generic names
            return sequences.map((s, i) => ({
                id: `pattern-${i}`,
                title: `Repeated sequence of ${s.seq.length} actions`,
                description: `You do ${s.seq[0].split(':')[0]} → ... → ${s.seq[s.seq.length-1].split(':')[0]} about ${s.count} times`,
                confidence: Math.min(1, s.count / 10),
                tools: s.seq.map(t => t.split(':')[0]),
                repeatCount: s.count,
            }));
        }

        const prompt = [
            'Analyze these repeated PC automation patterns and name each one.',
            'Each pattern is a sequence of tool names (e.g. shell_run, text_type, uia_invoke).',
            'For each, give: a short title (≤8 words), description (≤25 words), and estimated value (high/medium/low).',
            'Reply with ONLY a JSON array: [{"title":"...","description":"...","value":"high|medium|low"}, ...]',
            '',
            'Patterns:',
            sequences.map((s, i) => `${i+1}. [${s.seq.map(t=>t.split(':')[0]).join(' → ')}] × ${s.count} times`).join('\n'),
        ].join('\n');

        let named = null;
        try {
            const resp = await this._llmClient.chat({
                message: prompt,
                systemPrompt: 'You are a PC automation analyst. Output only JSON.',
                temperature: 0.1,
                maxLength: 600,
            });
            const text = resp?.text || '';
            const match = text.match(/\[[\s\S]*\]/);
            if (match) named = JSON.parse(match[0]);
        } catch {}

        return sequences.map((s, i) => {
            const meta = named?.[i] || {};
            return {
                id: `pattern-${Date.now()}-${i}`,
                title: meta.title || `Repeated ${s.seq.length}-step sequence`,
                description: meta.description || `Used ${s.count} times`,
                value: meta.value || 'medium',
                confidence: Math.min(1, (s.count / 10) + (s.seq.length / 20)),
                tools: s.seq.map(t => t.split(':')[0]),
                repeatCount: s.count,
                sequenceKey: s.key,
            };
        });
    }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;
function getPatternLearner() {
    if (!_instance) _instance = new PatternLearner();
    return _instance;
}

module.exports = { PatternLearner, getPatternLearner };
