/**
 * Agent Loop — ReAct-style controller that pursues a user goal by repeatedly
 * asking the LLM what to do next and executing tool calls.
 *
 * Architecture:
 *   1. On start: GET /workspace/goals/next (highest-priority active goal)
 *   2. Build a system prompt:
 *        - Goal title + success criteria + constraints
 *        - Available tools (registry.toolSchemasForLlm())
 *        - Recent action log tail (so the LLM doesn't repeat itself)
 *        - The full workspaceContext (CORE/USER/MEMORY/goals/recent actions)
 *   3. Loop step:
 *        a) Ask LLM with tools=available, messages=[system, ...recent]
 *        b) For each tool_call: registry.executeTool(name, args, ctx)
 *           - record the result in a `tool` message for the next turn
 *        c) If LLM returned a final text reply with no tool calls → consider
 *           the step "talked", check if it asked to stop
 *        d) After every step, append a one-line summary to action log
 *        e) Every REFLECT_EVERY steps, ask the LLM to write a `decision`
 *           item summarising what worked/didn't → long-term memory.
 *   4. Exit conditions:
 *        - goal_update set status to done/failed/blocked
 *        - max steps reached
 *        - LLM returns a text reply containing the sentinel "<<GOAL_DONE>>"
 *        - stop() called externally
 *        - kill switch activated
 *
 * The loop talks to an LLM via the §7.1 provider seam (llm-provider.js),
 * which ALWAYS proxies through the portfolio backend's HTTP API using the
 * user's JWT — the addon never calls an LLM provider directly (injected via
 * opts.llmClient for tests, or pulled from ./llm-provider otherwise).
 */

const DEFAULT_MAX_STEPS = 20;
// No default model id — the backend picks its own default (Claude Haiku 4.5
// via Bedrock) when `modelId` isn't set. Model selection is a backend
// concern now that all LLM calls are proxied.
const DEFAULT_MODEL_ID = undefined;
const REFLECT_EVERY = 5;
const STEP_DELAY_MS = 400;
const crypto = require('crypto');
// Tools whose args contain human/PII content — never captured into a
// success-run skill draft (mirrors pattern-learner.js PII_TOOLS).
const PII_TOOLS = new Set(['text_type', 'clipboard_write', 'audio_speak']);

// Future-phase tunables (docs/implementation/simple-agent-prompt.md
// §7.4). Not yet consumed by the loop — wired in Phases 2–6. Present here so
// the injectable `ctx.config` seam exists from the start without changing any
// default behavior.
const DEFAULT_CONFIG = {
    ORIENT_CAP_BYTES: 12288,      // hard cap on the situation block
    EPISODIC_WINDOW: 20,          // recent actions recalled into Orient
    LESSON_TOPK: 3,               // matching lessons injected into Orient
    REEVAL_STEPS: 8,              // inner ticks between Goal re-evals
    REEVAL_MS: 300000,            // wall-clock fallback (5 min)
    DRIFT_THRESHOLD: 0.35,        // orientation delta that forces re-eval
    IDLE_SLEEP_MS: 2500,          // sleep when plan() returns idle
    STALL_THRESHOLD: 3,           // consecutive no-progress actions → blocked
    MAX_STEPS_DEFAULT: 60,        // default hard step budget per goal
    META_EVERY_ACTIONS: 50,       // meta-loop cadence in recorded actions
    SKILL_PROMOTE_MIN_REPEATS: 3, // n-gram repeats before a skill draft
};

function nowIso() { return new Date().toISOString(); }

/**
 * Score a candidate skill against a goal. Returns 0..1 plus a human-readable
 * reason for why we think it might match. Used to populate the
 * "RECORDED SKILLS THAT MIGHT MATCH" hint block in the system prompt — the
 * LLM makes the final decision whether to call skill_run.
 */
function _scoreSkillAgainstGoal(skill, goal) {
    const goalText = `${goal.name || ''} ${goal.successCriteria || ''} ${goal.content || ''}`.toLowerCase();
    const skillText = `${skill.name || ''} ${skill.description || ''} ${skill.slug || ''}`.toLowerCase();
    if (!goalText.trim() || !skillText.trim()) return { score: 0, reason: 'no overlap' };

    // Tokenize on word boundaries; drop short stopwords.
    const stop = new Set(['the','a','an','of','to','for','and','or','in','on','at','with','from','by','is','are','it','this','that']);
    const tokens = (s) => new Set(
        s.split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !stop.has(t))
    );
    const g = tokens(goalText);
    const k = tokens(skillText);
    if (g.size === 0 || k.size === 0) return { score: 0, reason: 'no meaningful tokens' };

    let hits = 0;
    const matched = [];
    for (const t of k) if (g.has(t)) { hits++; matched.push(t); }
    const score = hits / Math.max(k.size, 1);
    if (score === 0) return { score: 0, reason: 'no tokens shared' };
    return { score, reason: `matched: ${matched.slice(0, 6).join(', ')}` };
}

/**
 * Find skills (cached + workspace) most relevant to the current goal.
 * Best-effort — failures here must NOT break the agent step.
 *
 * @returns {Promise<Array<{slug:string,name:string,steps:number,reason:string,score:number}>>}
 */
async function findRelevantSkills(goal, { wsClient, log, skillModule } = {}) {
    const out = [];
    // 1. Local cache (cheap, no network).
    try {
        const skillMod = skillModule || (() => { try { return require('./tools/skill'); } catch { return {}; } })();
        if (skillMod && skillMod.getAllCachedSkills) {
            for (const s of skillMod.getAllCachedSkills()) {
                const { score, reason } = _scoreSkillAgainstGoal(s, goal);
                if (score > 0.1) {
                    out.push({ slug: s.slug, name: s.name, steps: s.steps?.length || 0, reason: `cache · ${reason}`, score });
                }
            }
        }
    } catch (e) {
        log && log('[agent] local skill scan failed:', e.message);
    }
    // 2. Workspace listing (network, best-effort).
    try {
        const list = await wsClient.listSkills();
        const entries = list?.entries || list?.items || [];
        for (const e of entries) {
            // Skip duplicates we already added from cache.
            if (out.some(x => x.slug === e.slug)) continue;
            const fake = { slug: e.slug, name: e.name, description: e.description || '', steps: [] };
            const { score, reason } = _scoreSkillAgainstGoal(fake, goal);
            if (score > 0.1) {
                out.push({ slug: e.slug, name: e.name, steps: e.stepsCount || '?', reason: `workspace · ${reason}`, score });
            }
        }
    } catch (e) {
        log && log('[agent] workspace skill list failed:', e.message);
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 3);
}

function buildSystemPrompt({ goal, workspaceContext, toolNames, skillHints, perceptionContext }) {
    return [
        'You are an autonomous Windows automation agent running inside the user\'s PC via the Simple addon.',
        'You are pursuing a specific GOAL on behalf of the user. Take small, deliberate steps.',
        '',
        '== GOAL ==',
        `Title: ${goal.name}`,
        goal.successCriteria ? `Success criteria: ${goal.successCriteria}` : '',
        goal.constraints ? `Constraints: ${goal.constraints}` : '',
        '',
        'Goal details:',
        (goal.content || '(no further detail)').trim(),
        '',
        '== RULES ==',
        '1. Prefer the safest tool that gets the job done. Use uia_* over screen_capture+click when possible.',
        '2. Use shell_run for read-only inspection freely; destructive shell commands will be refused.',
        '3. After each meaningful step, briefly say what you observed and what you\'ll try next.',
        '4. If you are stuck or need a human decision, call goal_ask_user — do NOT keep retrying blindly.',
        '5. When the success criteria are satisfied, call goal_update with status="done" AND respond with the sentinel "<<GOAL_DONE>>" on its own line. The loop will stop.',
        '6. When you have done enough that the user should review, you may also stop with "<<GOAL_DONE>>".',
        '7. Never call tools that you don\'t need. Avoid spamming screen_capture; capture only when vision is required.',
        '8. If a RECORDED SKILL below matches this goal, PREFER skill_run({ slug: "..." }) over rederiving the steps. Skills are previously-validated demonstrations from the user.',
        '9. Use audio_transcribe if the goal involves spoken input. Use audio_speak to deliver voice assistant responses.',
        '10. Use webcam_capture with describe=true only when you need to understand the user\'s physical environment.',
        '',
        '== AVAILABLE TOOLS ==',
        toolNames.join(', '),
        '',
        (skillHints && skillHints.length
            ? '== RECORDED SKILLS THAT MIGHT MATCH THIS GOAL ==\n' +
              skillHints.map(s => `- slug="${s.slug}" name="${s.name}" steps=${s.steps} — ${s.reason}`).join('\n')
            : ''),
        '',
        perceptionContext ? `== CURRENT PERCEPTION (live) ==\n${perceptionContext}` : '',
        '',
        '== USER WORKSPACE CONTEXT ==',
        (workspaceContext || '(no workspace context loaded)').trim(),
    ].filter(Boolean).join('\n');
}

function reflectionPrompt(goal) {
    return [
        `Pause and reflect on progress toward goal "${goal.name}".`,
        'Write a SHORT (<= 6 lines) JSON object with fields:',
        '  { "title": "...", "progress": "what advanced", "blockers": "what didn\'t work", "next": "next focused step" }',
        'Reply with ONLY the JSON, no prose.',
    ].join('\n');
}

/**
 * AgentLoop — the O-O-G-P-A loop controller (Phases 0–1 of the
 * Observe → Orient → Goal → Plan → Action refactor).
 *
 * `observe` / `orient` / `selectGoal` / `plan` / `act` / `reflect` are named
 * stage methods, each returning a plain object, so they can be unit-tested in
 * isolation with an injected `ctx`. The stage order and data flow are
 * identical to the original ReAct loop — this refactor only adds boundaries,
 * an explicit `stage` field, and the injectable dependency seams.
 */
class AgentLoop {
    constructor(opts = {}) {
        this.wsClient = opts.wsClient;
        this.registry = opts.registry;
        this.contextFactory = opts.contextFactory;
        this.log = opts.log || console.log;

        // Injectable seams (undefined → lazy-require the real module).
        this._llmClient = opts.llmClient || null;
        this._llm = null;                    // lazily resolved provider
        this._eventsOverride = opts.events;
        this._perceptionOverride = opts.perception;
        this._plannerOverride = opts.planner;
        this._skillOverride = opts.skillModule;
        this.config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
        this.memory = opts.memory || this._defaultMemory();
        this.critic = opts.critic || require('./critic');

        this._toolCtx = null;                // built once per run (contextFactory)
        this._lastOrientSig = null;          // drift-detection baseline (Phase 2)
        this._lastDrifted = false;           // last orient() drift flag (Phase 3)
        this.state = this._initialState();
    }

    _initialState() {
        return {
            running: false,
            currentGoal: null,
            step: 0,
            lastTick: null,
            startedAt: null,
            history: [],         // { role, content, tool_calls?, tool_call_id? }
            stopReason: null,
            modelId: DEFAULT_MODEL_ID,
            maxSteps: DEFAULT_MAX_STEPS,
            dryRun: false,
            abortController: null,
            stage: 'IDLE',
            loop: 'idle',
            stallCount: 0,
            lastOutcomeDelta: 0,
            lastLesson: null,
            lastMetaStep: 0,
            lastMeta: null,
            runSteps: [],
            stepLog: [],
            lastSkillDraft: null,
            finalAnswer: null,
            stepsSinceReeval: 0,
            nextReevaluateAt: null,
        };
    }

    // ── Dependency seams ─────────────────────────────────────────────────
    _lazyLoadLlm() {
        if (this._llm) return this._llm;
        if (this._llmClient) { this._llm = this._llmClient; return this._llm; }
        // Lazy require to avoid circular deps at server boot. Routed through the
        // §7.1 provider seam (llm-provider.js), which ALWAYS proxies through the
        // backend's HTTP API using the user's JWT (already wired via
        // workspace-client's cloud-relay token getter) — no local token
        // discovery needed here anymore.
        try {
            const { createLlmProvider } = require('./llm-provider');
            this._llm = createLlmProvider();
            return this._llm;
        } catch (e) {
            throw new Error('No LLM client available: ' + e.message);
        }
    }

    _events() {
        if (this._eventsOverride) return this._eventsOverride;
        try { return require('./events'); } catch { return null; }
    }

    _publish(type, data) {
        const ev = this._events();
        if (ev) { try { ev.publish(type, data); } catch { /* event bus failure must not kill the loop */ } }
    }

    _perception() {
        if (this._perceptionOverride !== undefined) return this._perceptionOverride;
        try { return require('./perception-bus'); } catch { return null; }
    }

    _planner() {
        if (this._plannerOverride) return this._plannerOverride;
        try { return require('./planner'); } catch { return null; }
    }

    _skillModule() {
        if (this._skillOverride) return this._skillOverride;
        try { return require('./tools/skill'); } catch { return {}; }
    }

    /**
     * Default semantic-memory seam — best-effort recall of episodic actions,
     * critic lessons, and pattern-learner suggestions. All failures degrade to
     * empty arrays so the Orient stage can never crash on memory I/O.
     */
    _defaultMemory() {
        const wsClient = this.wsClient;
        return {
            async recallEpisodes(n) {
                try {
                    const actions = await wsClient.getRecentActions(n);
                    return (Array.isArray(actions) ? actions : []).slice(-n);
                } catch { return []; }
            },
            async recallLessons(topK) {
                try {
                    if (typeof wsClient.listLessons === 'function') {
                        const out = await wsClient.listLessons({ limit: topK });
                        return (out?.lessons || out?.entries || (Array.isArray(out) ? out : [])).slice(0, topK);
                    }
                } catch { /* lessons store not wired until Phase 4 */ }
                return [];
            },
            async recallSuggestions() {
                try {
                    const { getPatternLearner } = require('./pattern-learner');
                    const s = getPatternLearner()?.getSuggestions?.() || [];
                    return (Array.isArray(s) ? s : []).slice(0, 5);
                } catch { return []; }
            },
        };
    }

    _setStage(stage) {
        if (this.state.stage !== stage) {
            this.state.stage = stage;
            this.state.loop = stage === 'SELECTING_GOAL' ? 'outer' : 'inner';
            this._publish('agent.stage', { goalSlug: this.state.currentGoal?.slug, stage, loop: this.state.loop, step: this.state.step });
        }
    }

    // ── O-O-G-P-A stage methods ──────────────────────────────────────────

    /** OBSERVE — assemble one Frame: tool surface + workspace context + skill hints + perception. */
    async observe() {
        this.state.step++;
        this.state.stepsSinceReeval++;
        this.state.lastTick = nowIso();
        this._publish('agent.step', { goalSlug: this.state.currentGoal?.slug, step: this.state.step, lastTickAt: this.state.lastTick, modelId: this.state.modelId });

        const toolSchemas = this.registry.toolSchemasForLlm();
        const toolNames = toolSchemas.map(t => t.function.name);

        // Refresh workspace context every step (cheap; ensures memory edits land).
        let wsContextString = '';
        try {
            const ctxPreview = await this.wsClient.getContext({ message: this.state.currentGoal?.name });
            wsContextString = ctxPreview?.workspaceContext || '';
        } catch (e) {
            this.log('[agent] workspace context fetch failed:', e.message);
        }

        // Find skills (cached + workspace) that might match this goal. Best-effort.
        let skillHints = [];
        try {
            skillHints = await findRelevantSkills(this.state.currentGoal, { wsClient: this.wsClient, log: this.log, skillModule: this._skillModule() });
        } catch (e) {
            this.log('[agent] skill hint resolution failed:', e.message);
        }

        // Get latest perception frame for real-time environmental context.
        let perceptionContext = null;
        try {
            const p = this._perception();
            if (p) {
                const frame = p.getPerceptionBus().getLatestFrame();
                if (frame) perceptionContext = p.frameToContextString(frame);
            }
        } catch { /* perception bus not started — non-fatal */ }

        return { ts: nowIso(), toolSchemas, toolNames, wsContextString, skillHints, perceptionContext };
    }

    /**
     * ORIENT — assemble the bounded, priority-ordered situation block from a
     * Frame plus semantic memory (episodic actions, lessons, suggestions).
     * The block is capped at `ORIENT_CAP_BYTES`; when over cap, lower-priority
     * parts are dropped first (5→1). Also computes drift: a large change in the
     * *semantic* parts (priority ≥ 2, excluding the volatile perception part)
     * sets `drifted` so the outer loop can force a Goal re-eval.
     */
    async orient(frame) {
        // Semantic memory recall (episodic + lessons + suggestions) — best-effort.
        let episodes = [];
        let lessons = [];
        let suggestions = [];
        try { episodes = await this.memory.recallEpisodes(this.config.EPISODIC_WINDOW); }
        catch (e) { this.log('[agent] episode recall failed:', e.message); }
        try { lessons = await this.memory.recallLessons(this.config.LESSON_TOPK); }
        catch (e) { this.log('[agent] lesson recall failed:', e.message); }
        try { suggestions = await this.memory.recallSuggestions(); }
        catch (e) { this.log('[agent] suggestion recall failed:', e.message); }

        const parts = [
            { priority: 1, label: 'CURRENT PERCEPTION', text: frame.perceptionContext || '' },
            { priority: 2, label: 'RECENT ACTIONS', text: this._formatEpisodes(episodes) },
            { priority: 3, label: 'GOALS & CONTEXT', text: (frame.wsContextString || '').trim() },
            { priority: 4, label: 'LESSONS', text: this._formatLessons(lessons) },
            { priority: 5, label: 'SUGGESTIONS', text: this._formatSuggestions(suggestions) },
        ];

        const block = this._assembleBoundedBlock(parts);

        // Drift is measured on the semantic parts only (priority ≥ 2): perception
        // changes every tick and must not masquerade as goal drift.
        const semanticText = parts.filter(p => p.priority >= 2).map(p => p.text).join('\n');
        const sig = this._blockSignature(semanticText);
        const drifted = this._lastOrientSig
            ? this._jaccard(this._lastOrientSig, sig) < (1 - this.config.DRIFT_THRESHOLD)
            : false;
        this._lastOrientSig = sig;
        this._lastDrifted = drifted;

        const systemPrompt = buildSystemPrompt({
            goal: this.state.currentGoal,
            workspaceContext: block,
            toolNames: frame.toolNames,
            skillHints: frame.skillHints,
            perceptionContext: frame.perceptionContext,
        });

        // Last user-ish message: a tick prompt that nudges the model to take the
        // next concrete action OR call goal_update to finalize.
        const userTick = this.state.step === 1
            ? 'Begin. What is your first action?'
            : 'Continue. Based on the recent action results, what is your next action? Use a tool, or finalize with goal_update + "<<GOAL_DONE>>".';

        return { block, hash: this._stringHash(block), drifted, systemPrompt, userTick };
    }

    // ── Orient helpers (Phase 2) ──────────────────────────────────────────
    _formatEpisodes(episodes) {
        const list = Array.isArray(episodes) ? episodes : [];
        if (!list.length) return '';
        return list.map((e) => {
            if (typeof e === 'string') return `- ${e}`;
            const tool = e.tool || e.name || 'action';
            const detail = e.summary || e.result || e.error || '';
            return `- ${tool}: ${String(detail).slice(0, 120)}`;
        }).join('\n');
    }

    _formatLessons(lessons) {
        const list = Array.isArray(lessons) ? lessons : [];
        if (!list.length) return '';
        return list.map((l) => {
            const c = l?.content || l;
            const text = typeof c === 'string' ? c : (c?.pattern || c?.do || JSON.stringify(c));
            return `- ${String(text).slice(0, 160)}`;
        }).join('\n');
    }

    _formatSuggestions(suggestions) {
        const list = Array.isArray(suggestions) ? suggestions : [];
        if (!list.length) return '';
        return list.map((s) => {
            const text = typeof s === 'string' ? s : (s?.title || s?.name || s?.suggestion || JSON.stringify(s));
            return `- ${String(text).slice(0, 120)}`;
        }).join('\n');
    }

    _assembleBoundedBlock(parts) {
        const cap = this.config.ORIENT_CAP_BYTES;
        // Present parts are already ordered by priority (1 → 5). Drop the
        // LOWEST-priority part first until the block fits under the cap.
        const present = parts.filter((p) => String(p.text || '').trim());
        if (!present.length) return '';
        let kept = present;
        while (kept.length) {
            const block = kept.map((p) => `== ${p.label} ==\n${String(p.text).trim()}`).join('\n\n');
            if (Buffer.byteLength(block, 'utf8') <= cap) return block;
            kept = kept.slice(0, -1); // drop the lowest-priority part
        }
        // Even the single highest-priority part exceeds the cap — truncate it.
        const only = present[0];
        return this._truncateBytes(`== ${only.label} ==\n${String(only.text).trim()}`, cap);
    }

    _truncateBytes(str, maxBytes) {
        if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
        const suffix = '...';
        let out = '';
        for (const ch of str) {
            if (Buffer.byteLength(out + ch, 'utf8') > maxBytes - Buffer.byteLength(suffix, 'utf8')) break;
            out += ch;
        }
        return out + suffix;
    }

    _stringHash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    }

    _blockSignature(text) {
        const sig = new Set();
        for (const tok of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
            if (tok.length >= 2) sig.add(tok);
        }
        return sig;
    }

    _jaccard(a, b) {
        if (a.size === 0 && b.size === 0) return 1;
        let inter = 0;
        for (const t of a) if (b.has(t)) inter++;
        const union = a.size + b.size - inter;
        return union === 0 ? 1 : inter / union;
    }

    /**
     * GOAL (light, every tick) — re-check the active goal and self-block on
     * repeated stalls. This is the cheap safety core: a user pause/block/done
     * stops the loop promptly, and a stalling loop is caught on the very tick
     * it crosses the stall threshold (never cadence-gated).
     */
    async refreshGoalStatus() {
        try {
            const fresh = await this.wsClient.getGoal(this.state.currentGoal.slug);
            if (!fresh || ['done', 'failed', 'paused', 'blocked'].includes(fresh.status)) {
                return { status: 'terminal', reason: `goal status=${fresh?.status || 'missing'}` };
            }
            this.state.currentGoal = fresh;
        } catch (e) {
            this.log('[agent] goal refresh failed:', e.message);
        }

        // Stall / boredom detector (Phase 6): stop a runaway loop instead of
        // letting it spin until maxSteps. Only autoAbandon makes the block
        // permanent — otherwise the run stops but the goal stays active.
        if (this.state.stallCount >= this.config.STALL_THRESHOLD) {
            const reason = `stalled after ${this.state.stallCount} consecutive no-progress ticks`;
            if (this.state.currentGoal?.autoAbandon === true) {
                try { await this.wsClient.upsertGoal(this.state.currentGoal.slug, { status: 'blocked' }); }
                catch (e) { this.log('[agent] stall block persist failed:', e.message); }
                this._publish('goal.blocked', { goalSlug: this.state.currentGoal?.slug, reason });
            } else {
                this._publish('goal.stalled', { goalSlug: this.state.currentGoal?.slug, reason });
            }
            return { status: 'terminal', reason: 'stalled' };
        }

        return { status: 'continue' };
    }

    /** True when the outer Goal re-eval is due: start, cadence, drift, or wall-clock. */
    _shouldReevaluate() {
        if (this.state.stepsSinceReeval >= this.config.REEVAL_STEPS) return true;
        if (this.state.nextReevaluateAt && Date.now() >= this.state.nextReevaluateAt) return true;
        if (this._lastDrifted) return true;
        return false;
    }

    /**
     * GOAL — the outer loop's cadence-gated re-eval step (Phase 3). Runs the
     * same refresh + stall check as `refreshGoalStatus()`, then resets the
     * cadence. Future intent re-derivation (pick a higher-priority goal, decide
     * done/abandoned) slots in here without touching the per-tick safety path.
     */
    async selectGoal() {
        const decision = await this.refreshGoalStatus();
        if (decision.status === 'terminal') return decision;

        this.state.stepsSinceReeval = 0;
        this.state.nextReevaluateAt = Date.now() + this.config.REEVAL_MS;
        return { status: 'continue' };
    }

    /** PLAN — ask the LLM for the next action (tool calls or final reply). */
    async plan(frame, situation) {
        let result;
        try {
            result = await this._lazyLoadLlm().chat({
                message: situation.userTick,
                modelId: this.state.modelId,
                systemPrompt: situation.systemPrompt,
                temperature: 0.2,
                maxLength: 800,
                conversationHistory: this.state.history.slice(-12),
                tools: frame.toolSchemas,
                tool_choice: 'auto',
            });
        } catch (e) {
            this.log('[agent] LLM error:', e.message);
            return { type: 'llm-error' };
        }

        const text = (result?.text || '').trim();
        const toolCalls = result?.toolCalls || [];

        // Echo assistant message into history.
        this.state.history.push({
            role: 'assistant',
            content: text || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });

        // Idleness (Phase 6): no tool call and no sentinel = the agent chose to
        // do nothing this tick. Record a best-effort `expected` for the critic
        // (Phase 4 replaces this with a real one-line outcome prediction).
        const isDone = text.includes('<<GOAL_DONE>>');
        const expected = toolCalls.length ? toolCalls.map((tc) => tc.function.name).join(', ') : (isDone ? 'finish' : 'no-op');
        if (!toolCalls.length && !isDone) {
            return { type: 'idle', text, toolCalls, expected };
        }
        return { type: 'response', text, toolCalls, expected };
    }

    /** ACTION — execute each tool call, compact the results into history. */
    async act(action) {
        const outcomes = [];
        const ctx = this._toolCtx || this.contextFactory({ goalSlug: this.state.currentGoal?.slug });
        for (const tc of action.toolCalls) {
            let argsObj = {};
            try { argsObj = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {}); }
            catch { argsObj = {}; }
            const out = await this.registry.executeTool(tc.function.name, argsObj, ctx);
            // Compact tool result for next turn — full result already in action log
            const summary = JSON.stringify({
                ok: out.ok,
                ...(out.ok ? { result: typeof out.result === 'string' ? out.result.slice(0, 800) : out.result } : { error: out.error }),
                mode: out.mode,
                durationMs: out.durationMs,
            }).slice(0, 1200);
            this.state.history.push({
                role: 'tool',
                tool_call_id: tc.id || `${tc.function.name}_${this.state.step}`,
                content: summary,
            });
            this.log(`[agent] step ${this.state.step} tool=${tc.function.name} ok=${out.ok}`);
            outcomes.push({ name: tc.function.name, args: argsObj, out });
            this.state.stepLog.push({
                tool: tc.function.name,
                args: PII_TOOLS.has(tc.function.name) ? {} : argsObj,
                ok: !!out.ok,
                result: out.ok
                    ? (typeof out.result === 'string' ? out.result.slice(0, 300) : out.result)
                    : String(out.error || '').slice(0, 300),
            });
            if (out.ok) {
                this.state.runSteps.push({ tool: tc.function.name, args: PII_TOOLS.has(tc.function.name) ? {} : argsObj });
            }
        }
        return { outcomes };
    }

    /** REFLECT — sentinel stop check, outcome delta + stall tracking, periodic reflection. */
    async reflect(action, outcome) {
        // Stop sentinel: the loop declared the goal finished. Capture the final
        // answer (the text the model wrote before the sentinel) so callers can
        // report it back to the user (chat / run / relay).
        if (action.text.includes('<<GOAL_DONE>>')) {
            this.state.finalAnswer = String(action.text || '')
                .replace(/<<GOAL_DONE>>/gi, '').trim() || null;
            return { stop: true, reason: 'goal-done-sentinel' };
        }

        // Outcome delta (critic, Phase 4) + stall detection (Phase 6).
        const outcomes = outcome?.outcomes || [];
        const delta = this.critic.score({ predicted: action.expected, actual: outcomes.map((o) => o.out) });
        this.state.lastOutcomeDelta = delta;
        if (delta <= 0) this.state.stallCount++;
        else this.state.stallCount = 0;

        // The critic writes one idempotent lesson per failing tick (Phase 4).
        if (delta < 0) {
            const slug = await this.critic.writeLesson(action, outcome, {
                wsClient: this.wsClient,
                goalSlug: this.state.currentGoal?.slug,
                log: this.log,
            });
            if (slug) this.state.lastLesson = slug;
        }

        // Reflection
        if (this.state.step % REFLECT_EVERY === 0) {
            try {
                const refl = await this._lazyLoadLlm().chat({
                    message: reflectionPrompt(this.state.currentGoal),
                    modelId: this.state.modelId,
                    systemPrompt: 'You are reflecting on agent progress. Output ONLY the requested JSON.',
                    temperature: 0,
                    maxLength: 300,
                    conversationHistory: this.state.history.slice(-8),
                });
                const reflectionText = (refl?.text || '').trim();
                if (reflectionText) {
                    await this.wsClient.upsertGoal(
                        // Append reflection into the goal content for a tighter loop.
                        this.state.currentGoal.slug, {
                            name: this.state.currentGoal.name,
                            content: (this.state.currentGoal.content || '') + `\n\n[reflection ${nowIso()}] ${reflectionText}`,
                            status: this.state.currentGoal.status,
                        }
                    ).catch(err => this.log('[agent] reflection persist failed:', err.message));
                }
            } catch (e) {
                this.log('[agent] reflection failed:', e.message);
            }
        }

        return { stop: false };
    }

    /** One inner-loop pass: observe → orient → plan → act → reflect. */
    async tick() {
        this._setStage('OBSERVING');
        const frame = await this.observe();
        this._setStage('ORIENTING');
        const situation = await this.orient(frame);
        this._setStage('PLANNING');
        const action = await this.plan(frame, situation);
        if (action.type === 'llm-error') {
            this._setStage('REFLECTING');
            return { stop: false, idle: false, reason: 'llm-error' };
        }
        if (action.type === 'idle') {
            // Terminal tick: no tool call — the loop sleeps longer and lets the
            // stall detector (Phase 6) decide when to give up.
            this._setStage('REFLECTING');
            const r = await this.reflect(action, { outcomes: [] });
            return { ...r, idle: true };
        }
        this._setStage('ACTING');
        const outcome = await this.act(action);
        this._setStage('REFLECTING');
        return await this.reflect(action, outcome);
    }

    async _runLoop() {
        this._toolCtx = this.contextFactory({ goalSlug: this.state.currentGoal.slug });

        while (this.state.running && this.state.step < this.state.maxSteps) {
            this._setStage('SELECTING_GOAL');
            const decision = this._shouldReevaluate()
                ? await this.selectGoal()
                : await this.refreshGoalStatus();
            if (decision.status === 'terminal') {
                this.state.stopReason = decision.reason;
                break;
            }

            const r = await this.tick();
            if (r.stop) {
                this.state.stopReason = r.reason;
                break;
            }
            const sleepMs = r.idle ? this.config.IDLE_SLEEP_MS : STEP_DELAY_MS;
            await new Promise(res => setTimeout(res, sleepMs));

            // Meta-loop (OpenClaw-style self-reflection): every META_EVERY_ACTIONS
            // steps, review the recent action log and append a written note.
            if (this.state.step - this.state.lastMetaStep >= this.config.META_EVERY_ACTIONS) {
                this.state.lastMetaStep = this.state.step;
                await this._runMetaReflection();
            }
        }

        if (this.state.step >= this.state.maxSteps && !this.state.stopReason) {
            this.state.stopReason = 'max-steps-reached';
            await this._markGoalFailedOnMaxSteps();
        }
        this.state.running = false;
        this._setStage('IDLE');

        // On a sentinel-done run, persist the goal status and surface the final
        // answer so chat / run / relay callers can report it back to the user.
        if (this.state.stopReason === 'goal-done-sentinel') {
            const slug = this.state.currentGoal?.slug;
            if (slug) {
                if (this.state.finalAnswer) {
                    this._publish('agent.reply', { goalSlug: slug, text: this.state.finalAnswer, steps: this.state.step });
                }
                this._publish('goal.done', { goalSlug: slug, steps: this.state.step, result: this.state.finalAnswer || null });
                try { await this.wsClient.upsertGoal(slug, { status: 'done' }); }
                catch (e) { this.log('[agent] goal done persist failed:', e.message); }

                // Success-run skill draft (OpenClaw-style self-authored skills).
                // Consent-gated: only an explicit save persists it — here we just
                // build the draft and surface it via status() + an event.
                const draft = this._buildSkillDraft();
                if (draft) {
                    this.state.lastSkillDraft = draft;
                    this._publish('agent.skill-draft', { goalSlug: slug, slug: draft.slug, title: draft.name, steps: draft.steps.length });
                }
            }
        }

        this._publish('agent.stopped', { goalSlug: this.state.currentGoal?.slug, reason: this.state.stopReason });
        this.log(`[agent] loop exited: ${this.state.stopReason} (steps=${this.state.step})`);
    }

    /** Mark the goal `failed` when its hard step budget is exhausted. */
    async _markGoalFailedOnMaxSteps() {
        const slug = this.state.currentGoal?.slug;
        if (!slug) return;
        try {
            await this.wsClient.upsertGoal(slug, { status: 'failed' });
            this._publish('goal.failed', { goalSlug: slug, reason: 'max-steps-reached' });
        } catch (e) {
            this.log('[agent] max-steps goal persist failed:', e.message);
        }
    }

    /**
     * Meta-loop self-reflection (OpenClaw-style): every META_EVERY_ACTIONS
     * steps, review the recent action log, ask the LLM for a short written
     * self-assessment, and append it to the daily workspace log. Best-effort —
     * a missing token, empty log, or LLM failure never blocks the loop.
     */
    async _runMetaReflection() {
        if (!this.wsClient || typeof this.wsClient.appendLog !== 'function') return;

        let actions = [];
        try { actions = await this.wsClient.getRecentActions(this.config.META_EVERY_ACTIONS); }
        catch { return; }
        const toolLine = (Array.isArray(actions) ? actions : [])
            .map((a) => a.tool || a.name).filter(Boolean).slice(-this.config.META_EVERY_ACTIONS)
            .join(' → ');
        if (!toolLine) return;

        let summary = null;
        try {
            const res = await this._lazyLoadLlm().chat({
                message: `Recent actions (oldest → newest): ${toolLine}`,
                systemPrompt: 'You are the agent reviewing its own recent work. In ONE short paragraph, summarize what it did, what is working, and what it should stop doing. Be concise and factual.',
                temperature: 0,
                maxLength: 200,
            });
            summary = (res?.text || '').trim();
        } catch (e) {
            this.log('[agent] meta reflection LLM failed:', e.message);
            return;
        }
        if (!summary) return;

        try {
            await this.wsClient.appendLog(`[agent meta] ${summary}`);
        } catch (e) {
            this.log('[agent] meta reflection write failed:', e.message);
            return;
        }

        this.state.lastMeta = summary;
        this._publish('agent.meta', { goalSlug: this.state.currentGoal?.slug, step: this.state.step, summary });
        this.log(`[agent] meta reflection at step ${this.state.step}`);
    }

    /**
     * Build a skill DRAFT from the successful tool sequence of the run that
     * just finished. Returns null when fewer than 2 steps were executed.
     * Never persisted here — the caller surfaces it for the user to save.
     */
    _buildSkillDraft() {
        const steps = Array.isArray(this.state.runSteps) ? this.state.runSteps : [];
        if (steps.length < 2) return null;
        const goal = this.state.currentGoal || {};
        const seq = steps.map((s) => s.tool).join('→');
        const slug = 'skill-' + crypto.createHash('sha1').update(seq).digest('hex').slice(0, 10);
        return {
            slug,
            name: `${goal.name || 'Automation'} (learned)`,
            description: `Recorded from a successful run: ${seq}`,
            steps,
            params: [],
            metadata: { source: 'success-run', goalSlug: goal.slug || null, draft: true },
        };
    }

    async start(opts = {}) {
        if (this.state.running) return { running: true, reason: 'already running', currentGoal: this.state.currentGoal?.slug };
        // If no slug provided, fetch next.
        let goal = null;
        if (opts.goalSlug) {
            goal = await this.wsClient.getGoal(opts.goalSlug);
        } else {
            goal = await this.wsClient.getNextGoal();
        }
        if (!goal) return { running: false, reason: 'no-active-goal' };

        // Optional planner pass — only if this looks like a "big" goal and
        // the caller didn't opt out. Planner failures are non-fatal: we
        // still run the goal directly.
        if (!opts.skipPlanner) {
            try {
                const planner = this._planner();
                if (planner && planner.shouldPlan(goal)) {
                    const llm = this._lazyLoadLlm();
                    const result = await planner.planGoal(goal, {
                        wsClient: this.wsClient,
                        llm,
                        log: this.log,
                        eventBus: this._events(),
                    });
                    if (result?.created > 0) {
                        // Re-fetch nextGoal so the loop picks the highest-priority child.
                        const next = await this.wsClient.getNextGoal();
                        if (next) goal = next;
                    }
                }
            } catch (e) {
                this.log('[agent] planner pass skipped:', e.message);
            }
        }

        this.state = {
            running: true,
            currentGoal: goal,
            step: 0,
            lastTick: nowIso(),
            startedAt: nowIso(),
            history: [],
            stopReason: null,
            modelId: opts.modelId || DEFAULT_MODEL_ID,
            maxSteps: Math.min(100, Math.max(1, opts.maxSteps || goal.maxSteps || DEFAULT_MAX_STEPS)),
            dryRun: !!opts.dryRun,
            abortController: null,
            stage: 'IDLE',
            loop: 'idle',
            stallCount: 0,
            lastOutcomeDelta: 0,
            lastLesson: null,
            lastMetaStep: 0,
            lastMeta: null,
            runSteps: [],
            stepLog: [],
            lastSkillDraft: null,
            finalAnswer: null,
            stepsSinceReeval: this.config.REEVAL_STEPS,
            nextReevaluateAt: null,
        };
        this._toolCtx = null;
        this._lastOrientSig = null;
        this._lastDrifted = false;
        this.log(`[agent] start goal=${goal.slug} maxSteps=${this.state.maxSteps} dryRun=${this.state.dryRun}`);
        this._runLoop().catch(e => this.log('[agent] loop crashed:', e.message));
        return { running: true, currentGoal: goal.slug, startedAt: this.state.startedAt };
    }

    stop(reason = 'manual') {
        if (!this.state.running) return { running: false, reason: 'already stopped' };
        this.state.running = false;
        this.state.stopReason = reason;
        this.log(`[agent] stop requested: ${reason}`);
        return { running: false, reason };
    }

    status() {
        return {
            running: this.state.running,
            currentGoal: this.state.currentGoal ? { slug: this.state.currentGoal.slug, name: this.state.currentGoal.name, status: this.state.currentGoal.status } : null,
            step: this.state.step,
            startedAt: this.state.startedAt,
            lastTick: this.state.lastTick,
            stopReason: this.state.stopReason,
            modelId: this.state.modelId,
            maxSteps: this.state.maxSteps,
            dryRun: this.state.dryRun,
            stage: this.state.stage,
            loop: this.state.loop,
            stallCount: this.state.stallCount,
            lastOutcomeDelta: this.state.lastOutcomeDelta,
            lastLesson: this.state.lastLesson,
            finalAnswer: this.state.finalAnswer || null,
            lastMeta: this.state.lastMeta || null,
            lastSkillDraft: this.state.lastSkillDraft || null,
            stepLog: this.state.stepLog || [],
        };
    }

    get running() { return this.state.running; }
}

function createAgentLoop(opts = {}) {
    return new AgentLoop(opts);
}

module.exports = { createAgentLoop, AgentLoop };
