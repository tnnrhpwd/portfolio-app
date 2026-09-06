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
        this._lastEntries = [];
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
        try {
            // The action ring buffer lives in the `action` kind (YYYYMMDD
            // slug), not `log`; /action/recent returns parsed entries (200
            // with an empty array when nothing is recorded yet). Use the
            // exported client method — the raw `req` helper is not part of
            // the module's public surface, which silently broke this call
            // (this._wsClient.req was undefined, so every analysis returned
            // zero entries and suggestions never appeared).
            const entries = typeof this._wsClient.getActionLog === 'function'
                ? await this._wsClient.getActionLog({ days: 7, n: 500 })
                : [];
            const filtered = Array.isArray(entries)
                ? entries.filter(e => e && e.tool).slice(-MAX_LOG_ENTRIES)
                : [];
            this._lastEntries = filtered;
            return filtered;
        } catch {
            return [];
        }
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
                sequenceKey: s.key,
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

    /**
     * Phase 5 (meta-loop): promote a repeated-sequence suggestion into a
     * reusable skill DRAFT. Nothing is persisted or run unless the caller
     * opts in via `{ save: true }` — promotion is always consent-gated.
     *
     * The draft is built from the actual action-log entries matching the
     * sequence; PII-tool args are stripped so captured content never lands
     * in a draft.
     *
     * @param {string} sequenceKey - a suggestion's `sequenceKey`
     * @param {object} opts - { save: boolean, generalize: boolean } (both default false)
     * @returns {Promise<{skill, source}|null>}
     */
    async draftSkillFromSequence(sequenceKey, { save = false, generalize = false } = {}) {
        const suggestion = this._suggestions.find((s) => s.sequenceKey === sequenceKey);
        if (!suggestion) return null;

        const tokens = this._tokenize(this._lastEntries);
        const seqTokens = String(sequenceKey).split('→');

        // Locate the first contiguous run whose fingerprints match the sequence.
        let start = -1;
        for (let i = 0; i <= tokens.length - seqTokens.length; i++) {
            let match = true;
            for (let j = 0; j < seqTokens.length; j++) {
                if (tokens[i + j] !== seqTokens[j]) { match = false; break; }
            }
            if (match) { start = i; break; }
        }
        if (start < 0) return null;

        const windowEntries = this._lastEntries.slice(start, start + seqTokens.length);
        const steps = windowEntries.map((e) => {
            const tool = e.tool || e.name;
            // PII tools: never persist captured content into a draft.
            return { tool, args: PII_TOOLS.has(tool) ? {} : (e.args || {}) };
        });

        const slug = 'pattern-' + crypto.createHash('sha1').update(sequenceKey).digest('hex').slice(0, 10);
        let skill = {
            slug,
            name: suggestion.title || `Learned ${seqTokens.length}-step skill`,
            description: suggestion.description || `Auto-drafted from ${suggestion.repeatCount} repeats`,
            steps,
            params: [],
            metadata: {
                source: 'pattern-learner',
                sequenceKey,
                repeatCount: suggestion.repeatCount,
                confidence: suggestion.confidence,
                draft: true,
            },
        };

        // Optional generalization (T5.1 refinement): rewrite the literal
        // {tool,args} steps into the abstracted NL-compiler schema via the
        // existing generalize pipeline. Only attempted when saving AND an LLM
        // client is configured; best-effort — on failure the literal draft is
        // kept (the dashboard's "Make robust with AI" can generalize later).
        if (save && generalize && this._llmClient) {
            try {
                const { generalizeSkill } = require('./recorder/generalize');
                const generalized = await generalizeSkill(skill, {
                    goalDescription: skill.description,
                    llmClient: this._llmClient,
                });
                if (generalized && Array.isArray(generalized.steps)) skill = generalized;
            } catch (e) {
                this.emit('error', e);
            }
        }

        if (save && this._wsClient && typeof this._wsClient.upsertSkill === 'function') {
            await this._wsClient.upsertSkill(slug, {
                name: skill.name,
                content: JSON.stringify(skill),
                tags: ['learned', 'draft'],
            }).catch(() => { /* persistence is best-effort */ });
        }

        return {
            skill,
            source: { sequenceKey, repeatCount: suggestion.repeatCount, confidence: suggestion.confidence },
        };
    }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;
function getPatternLearner() {
    if (!_instance) _instance = new PatternLearner();
    return _instance;
}

module.exports = { PatternLearner, getPatternLearner };
