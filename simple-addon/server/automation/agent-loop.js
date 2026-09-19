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
 * The loop talks to an LLM via the `LLM_PROVIDERS.md` provider seam (llm-provider.js),
 * which ALWAYS proxies through the portfolio backend's HTTP API using the
 * user's JWT — the addon never calls an LLM provider directly (injected via
 * opts.llmClient for tests, or pulled from ./llm-provider otherwise).
 */

const DEFAULT_MAX_STEPS = 60; // `BACKLOG.md` follow-up: bumped from the legacy 20 to match DEFAULT_CONFIG.MAX_STEPS_DEFAULT below.
// No default model id — the backend picks its own default (Claude Haiku 4.5
// via Bedrock) when `modelId` isn't set. Model selection is a backend
// concern now that all LLM calls are proxied.
const DEFAULT_MODEL_ID = undefined;
const REFLECT_EVERY = 5;
const STEP_DELAY_MS = 400;

// Optional goal horizon (mirrors the backend's GOAL_HORIZONS). `year`/`life` mark a
// CONTAINER: an aim the loop must split into nearer work rather than try to finish.
const HORIZON_LABELS = {
    week: 'this week',
    quarter: 'this quarter',
    year: 'this year — long-term, split it before working it',
    life: 'life / open-ended — long-term, split it before working it',
};
function isContainerHorizon(horizon) {
    return horizon === 'year' || horizon === 'life';
}
const crypto = require('crypto');
// The PII tool set lives in one place (`event-detail.js`) because the EVENT
// stream needs it too — a `text_type` step must not publish what the user typed.
const { PII_TOOLS, clip } = require('./event-detail');

/** Chars of the model's own reasoning that reach an event. Long enough to say
 *  what it is doing and why; short enough that the event ring stays useful. */
const THOUGHT_MAX = 500;

// Future-phase tunables (docs/implementation/BACKLOG.md). Not yet consumed by the loop — wired in Phases 2–6. Present here so
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
    MAX_STEPS_DEFAULT: DEFAULT_MAX_STEPS, // default hard step budget per goal (single source of truth — see DEFAULT_MAX_STEPS above)
    META_EVERY_ACTIONS: 50,       // meta-loop cadence in recorded actions
    // How many LLM failures in a row before the run gives up. A failure retried
    // in a hot loop is indistinguishable from progress in the step counter, so
    // the bound is what makes it terminate at all. See _onLlmError().
    LLM_ERROR_MAX_CONSECUTIVE: 5,
    LLM_ERROR_BACKOFF_MS: 4000,       // wait after the 1st failure; doubles each time
    LLM_ERROR_BACKOFF_MAX_MS: 30000,  // ceiling for that backoff
    // After a FAILED workspace context/skill fetch, wait this many steps before
    // trying again — a refused read must not be retried on every tick.
    CONTEXT_RETRY_STEPS: 10,
    // Consecutive IDENTICAL calls (same tool, same args) after which the action is
    // treated as no progress and the model is told outright. See act()/reflect().
    REPEAT_ACTION_LIMIT: 3,
    // Consecutive READS (category `safe-read`) with no acting call at all, after
    // which read-only progress stops counting. Reading is not progress: the screen
    // cannot change until something acts on it. See act().
    READ_STREAK_LIMIT: 4,
    // How much of a tool result the model actually sees. Anything longer is cut AND
    // announced (see act()) — a silent cut teaches the model nothing except to retry.
    RESULT_PREVIEW_CHARS: 800,
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
        goal.horizon ? `Horizon: ${HORIZON_LABELS[goal.horizon] || goal.horizon}` : '',
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
        '7. Never call tools that you don\'t need. Avoid spamming screen_capture; capture only when vision is required. ' +
            'Repeating the same call with the same arguments cannot make progress — it is not a way to look harder and not a way to wait. ' +
            'The harness counts consecutive identical calls itself, tells you in the result, and stops the run if you carry on.',
        '8. If a RECORDED SKILL below matches this goal, PREFER skill_run({ slug: "..." }) over rederiving the steps. Skills are previously-validated demonstrations from the user.',
        '9. Use audio_transcribe if the goal involves spoken input. Use audio_speak to deliver voice assistant responses.',
        '10. Use webcam_capture with describe=true only when you need to understand the user\'s physical environment.',
        isContainerHorizon(goal.horizon)
            ? '11. The goal above is a LONG-TERM AIM, not a task. Do not try to finish it in this run. ' +
              'Use goal_create to split off the nearest one or two steps with horizon="week" or "quarter" ' +
              '(they inherit this goal as their parent), then make real progress on the first step. ' +
              'If that step is waiting on something only the user can supply — money, a date, an appointment — ' +
              'call goal_ask_user instead of looking for a substitute.'
            : '',
        // ── Doing something on the user's own PC ─────────────────────────────
        // Rewritten after a real request ("google message my girlfriend that I love
        // her — I am already signed into google message on microsoft edge") stalled.
        // The earlier version of these rules pointed at `browser_*` and at attaching
        // to a debug-port browser — i.e. at a SECOND browser, which is both the wrong
        // answer for a machine the addon can already see and a setup burden on the
        // user. Everything needed to do it natively was already here: window_focus,
        // uia_*, click_at, input_tap, text_type.
        '12. To do something on the user\'s own PC — INCLUDING a website they are already signed ' +
            'into — drive their real window: get the name from window_list, window_focus it, then LOOK ' +
            'at it with uia_snapshot / uia_find / uia_get_text and ACT on what you actually found using ' +
            'uia_invoke, click_at, input_tap or text_type. That is you operating the machine the way a ' +
            'person does, and it uses the session they are already signed into — no sign-in, no second ' +
            'browser, no extra setup from them.',
        '13. To type and commit: text_type with pressEnterAfter:true types the text AND sends it (that ' +
            'is how a chat or search box is submitted); input_tap({ keys: ["enter"] }) presses a key ' +
            'wherever focus is; click_at drives the real mouse. Prefer uia_* over pixel-hunting — a UIA ' +
            'name is exact and a coordinate is a guess — and fall back to screen_set_of_marks when a ' +
            'page exposes no accessibility tree. A window_focus miss now lists the windows that DO ' +
            'exist: read that list and pick a real one instead of repeating the same call.',
        '14. browser_* is for the OTHER case: a site the user is NOT signed into, a flow to run ' +
            'repeatably or headlessly, or reading a page\'s DOM. It drives OUR OWN profile, so a ' +
            'signed-in site shows a sign-in or QR-pairing wall — and if browser_goto or browser_status ' +
            'reports `wall`, STOP rather than clicking a screen that cannot go anywhere: relay what ' +
            '`wallExplanation` says and use rule 12 for their signed-in session, or have them sign in ' +
            'once with headless:false if ours is the right one.',
        '15. When a task needs a detail only the user has — a contact\'s real name, an account, a ' +
            'preference — call goal_ask_user for it EARLY. Guessing and then clicking around the wrong ' +
            'page is how a run stalls; one question is cheaper than ten failed attempts.',
        // ── Irreversible actions ─────────────────────────────────────────────
        // A real request asked for exactly this and there was no way to do it:
        // "Dakota is my girlfriend … please verify before sending the message."
        '16. Before anything IRREVERSIBLE on the user\'s behalf — sending a message or email, posting, ' +
            'submitting a form, buying something, deleting something — call user_confirm with the EXACT ' +
            'content in `details` (who it goes to and the full text). It BLOCKS until they answer. If it ' +
            'is refused, do not do it, do not rephrase it, and do not look for another route to the same ' +
            'action: say it was not done. Never report something as sent unless user_confirm returned ' +
            'approved:true.',
        // ── Not repeating a failure ──────────────────────────────────────────
        // Observed: three identical `window_focus` calls, each `window not found`,
        // until the stall detector stopped the run. The next attempt after a
        // failure must CHANGE something.
        '17. If a call fails, the next attempt must be DIFFERENT — a different name, selector or ' +
            'approach. Two identical failures in a row means the plan is wrong, not that it needs a third ' +
            'try. After a second failure, re-read what the tool actually said, try one genuinely different ' +
            'approach, and if that fails call goal_ask_user instead of repeating.',
        // Rule 18 exists because a real run on the goal above did TWENTY-FOUR steps
        // and not one of them was an action: uia_snapshot and perception_recent, over
        // and over, while the stall detector did the stopping. Rules 12-13 said HOW to
        // act and rule 7 forbade repeating, but nothing said that looking again is not
        // progress — so the model kept looking, which is the one thing that can never
        // find the target it could not find the first time.
        '18. LOOK, THEN ACT — do not keep looking. Reading the screen again does not reveal more: the ' +
            'same tool returns the same result, and a result that was cut stays cut (and says so). After ' +
            'at most two looks, DO something with what you have: click the element you found, or type into ' +
            'the box you found. If you truly cannot find the target, ask a NARROWER question — uia_find ' +
            'for one element by name, screen_ocr for the words on screen, a smaller region — or call ' +
            'goal_ask_user. A run whose every step is a read is a failed run, however many steps it takes.',
        '',
        // The tools list below is in REGISTRATION order, which puts ~25 read tools
        // before the first acting one — and four real runs in a row anchored on
        // reading and never called an acting tool at all. This block exists so the
        // ACTING tools are salient by name at the point of choosing, instead of
        // something to be discovered at the end of a long list of readers.
        '== HOW TO ACT ON THIS PC (reading changes nothing — only these change the screen) ==',
        'click_at({x,y}) — click a real point.  uia_invoke({name}) — activate a named element.  ' +
            'text_type({text, pressEnterAfter:true}) — type it and send it.  input_tap({keys:["enter"]}) — press a key.  ' +
            'window_focus({processName|titleContains}) — bring a window forward.  ' +
            'If you know roughly where the thing is, ACT; a coordinate that is close beats another read that shows you nothing new.',
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
            lastPublishedGoalSlug: null,
        };
    }

    // ── Dependency seams ─────────────────────────────────────────────────
    _lazyLoadLlm() {
        if (this._llm) return this._llm;
        if (this._llmClient) { this._llm = this._llmClient; return this._llm; }
        // Lazy require to avoid circular deps at server boot. Routed through the
        // `LLM_PROVIDERS.md` provider seam (llm-provider.js), which ALWAYS proxies through the
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

    /**
     * Announce which goal this run is working on.
     *
     * Published once per run rather than per step: the console needs one line
     * saying WHAT is being worked on (and against what step budget), not sixty.
     * Called from the outer loop, so a run that ever swaps goals reports the
     * swap instead of quietly working on something else.
     */
    _publishGoal() {
        const g = this.state.currentGoal;
        if (!g || this.state.lastPublishedGoalSlug === g.slug) return;
        this.state.lastPublishedGoalSlug = g.slug;
        this._publish('agent.goal', {
            goalSlug: g.slug,
            goalName: g.name || g.slug,
            horizon: g.horizon || null,
            status: g.status || 'active',
            priority: typeof g.priority === 'number' ? g.priority : null,
            maxSteps: this.state.maxSteps,
        });
    }

    // ── O-O-G-P-A stage methods ──────────────────────────────────────────

    /** OBSERVE — assemble one Frame: tool surface + workspace context + skill hints + perception. */
    async observe() {
        this.state.step++;
        this.state.stepsSinceReeval++;
        this.state.lastTick = nowIso();
        this._publish('agent.step', { goalSlug: this.state.currentGoal?.slug, step: this.state.step, maxSteps: this.state.maxSteps, lastTickAt: this.state.lastTick, modelId: this.state.modelId });

        const toolSchemas = this.registry.toolSchemasForLlm();
        const toolNames = toolSchemas.map(t => t.function.name);

        // Workspace context is refreshed every step ON PURPOSE ("ensures memory
        // edits land"), and that stays true. What was wrong was retrying it every
        // step while the workspace was REFUSING us: a 60-step run logged
        // `workspace context fetch failed: … 429: Too many workspace read
        // requests. Slow down.` on every single tick — hammering the limiter that
        // was already rejecting it. After a failure we now wait CONTEXT_RETRY_STEPS
        // before trying again; a success still refreshes every step.
        //
        // ⚠️ This is NOT what caused the LLM 429s that burned the step budget:
        // "Too many workspace read requests" and "Too many AI requests" are
        // separate limiters. It is a real, logged fault on its own (every orient
        // ran with NO workspace context), not the cause of the loop.
        const sinceContextFailure = this.state.step - (this.state.contextFailedStep ?? -Infinity);
        let wsContextString = this.state.wsContextString || '';
        if (sinceContextFailure >= this.config.CONTEXT_RETRY_STEPS) {
            try {
                const ctxPreview = await this.wsClient.getContext({ message: this.state.currentGoal?.name });
                wsContextString = ctxPreview?.workspaceContext || '';
                this.state.wsContextString = wsContextString;
                this.state.contextFailedStep = null;
            } catch (e) {
                this.state.contextFailedStep = this.state.step;
                this.log('[agent] workspace context fetch failed:', e.message);
            }
        }

        // Find skills (cached + workspace) that might match this goal. Best-effort,
        // backing off the same way when the workspace is refusing reads.
        const sinceSkillFailure = this.state.step - (this.state.skillFailedStep ?? -Infinity);
        let skillHints = this.state.skillHints || [];
        if (sinceSkillFailure >= this.config.CONTEXT_RETRY_STEPS) {
            try {
                skillHints = await findRelevantSkills(this.state.currentGoal, { wsClient: this.wsClient, log: this.log, skillModule: this._skillModule() });
                this.state.skillHints = skillHints;
                this.state.skillFailedStep = null;
            } catch (e) {
                this.state.skillFailedStep = this.state.step;
                this.log('[agent] skill hint resolution failed:', e.message);
            }
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

        // What this step is about to reason over — the console's situation line.
        // A run whose log is only tool names has no way to distinguish "it saw
        // the dialog and clicked Save" from "it could not see anything".
        this._publish('agent.observe', {
            goalSlug: this.state.currentGoal?.slug,
            step: this.state.step,
            contextBytes: wsContextString.length,
            skills: (skillHints || []).map((s) => s.slug || s.name).filter(Boolean).slice(0, 3),
            hasPerception: !!perceptionContext,
        });

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
        try {
            // `BACKLOG.md`: fetch a larger pool (4× topK, floor 12) so semantic
            // ranking below has candidates to choose from — then rank by token
            // overlap with the current situation instead of taking the N most
            // recent lessons unconditionally.
            const pool = await this.memory.recallLessons(Math.max(this.config.LESSON_TOPK * 4, 12));
            lessons = this._rankLessons(pool, frame);
        }
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

    /**
     * `BACKLOG.md` semantic lesson recall — rank the recent-lessons pool by token
     * overlap with the current situation (goal + context + perception) using
     * critic.recall, then backfill any remaining slots with the most recent
     * unmatched lessons. Replaces the old "most recent N, unconditionally"
     * recall with "most relevant first, still bounded to topK".
     */
    _rankLessons(pool, frame) {
        const list = Array.isArray(pool) ? pool : [];
        const topK = this.config.LESSON_TOPK;
        if (!list.length || list.length <= topK) return list;

        const situation = [
            this.state.currentGoal?.content || this.state.currentGoal?.slug || '',
            frame?.wsContextString || '',
            frame?.perceptionContext || '',
        ].join(' ');

        let ranked = [];
        try { ranked = this.critic.recall(situation, list, topK) || []; }
        catch (e) { this.log('[agent] lesson ranking failed:', e.message); }

        if (ranked.length >= topK) return ranked.slice(0, topK);
        // Few semantically-matching lessons: backfill with the most recent
        // unmatched ones so the block still carries up to topK lessons.
        const picked = new Set(ranked);
        const backfill = list.filter((l) => !picked.has(l)).slice(0, topK - ranked.length);
        return ranked.concat(backfill);
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
                // Log the transition, not just the fact: "goal status=done" reached
                // a user once with no way to tell whether the run had done anything
                // first, because the step count was dropped from the message. The
                // step count here is what distinguishes "this request never ran"
                // from "it ran and was cut short", and that distinction is the whole
                // diagnosis.
                this.log(`[agent] goal ${this.state.currentGoal.slug} is "${fresh?.status || 'missing'}" `
                    + `— stopping after ${this.state.step} step(s)`);
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
            // The count is the whole value of this reason: "stalled" alone tells a
            // reader nothing they can act on, and it was being thrown away here —
            // computed for the event, then replaced with that bare word before
            // being returned. `stop-reason.js` reads the count back out.
            const reason = `stalled after ${this.state.stallCount} consecutive no-progress ticks`;
            if (this.state.currentGoal?.autoAbandon === true) {
                try { await this.wsClient.upsertGoal(this.state.currentGoal.slug, { status: 'blocked' }); }
                catch (e) { this.log('[agent] stall block persist failed:', e.message); }
                this._publish('goal.blocked', { goalSlug: this.state.currentGoal?.slug, reason });
            } else {
                this._publish('goal.stalled', { goalSlug: this.state.currentGoal?.slug, reason });
            }
            return { status: 'terminal', reason };
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

        // An answer arrived, so whatever run of failures preceded this is over.
        // Cleared HERE (not in tick) so "consecutive" means what it says.
        this.state.consecutiveLlmErrors = 0;

        const text = (result?.text || '').trim();
        const toolCalls = result?.toolCalls || [];

        // The model's own words for this step, which are the reason for the
        // action it is about to take. Before this, a run read as `▶ screen_capture`
        // repeated with nothing on screen saying why any of it was happening.
        // The stop sentinel is stripped: it is a protocol token, not reasoning.
        const reasoning = clip(text.replace(/<<GOAL_DONE>>/gi, '').trim(), THOUGHT_MAX);
        if (reasoning) {
            this._publish('agent.thought', {
                goalSlug: this.state.currentGoal?.slug,
                step: this.state.step,
                text: reasoning,
                willCall: toolCalls.map((tc) => tc.function.name),
            });
        }

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

            // ⚠️ A repeated identical action is NOT progress, and the critic cannot
            // see that: it scores ok/error, and screen_capture returns ok every time.
            // A real run called screen_capture TWENTY times in a row and ended on
            // max-steps-reached, because all twenty looked like successes — the same
            // blindness that let window_focus repeat three times earlier.
            //
            // Prompt rule 7 already said "Avoid spamming screen_capture". Prose was
            // demonstrably not enough, so the loop notices mechanically — and, more
            // importantly, says so IN THE RESULT the model reads next, at the moment
            // it matters rather than as advice it has already forgotten.
            const fingerprint = `${tc.function.name}:${JSON.stringify(argsObj)}`;
            const repeats = this._countRepeats(fingerprint);
            const stuck = repeats >= this.config.REPEAT_ACTION_LIMIT;

            // ⚠️ READING IS NOT PROGRESS — and this is the third time prose failed to
            // establish that. Rule 18 says "look, then act", and a real run ignored it
            // and spent ALL 15 steps reading (window_list, perception_recent,
            // uia_snapshot, screen_capture) with no acting call in any of them, before
            // the stall detector stopped it. The screen cannot change until something
            // acts on it, so a run of reads is measured here rather than requested.
            //
            // Category comes from the registry, so this needs no list of read tools to
            // keep in sync — a new read tool is covered the moment it is registered.
            const category = this.registry.get?.(tc.function.name)?.category;
            const isRead = category === 'safe-read';
            this.state.consecutiveReads = isRead ? (this.state.consecutiveReads || 0) + 1 : 0;
            const readStreak = this.state.consecutiveReads >= this.config.READ_STREAK_LIMIT;

            // Compact tool result for next turn — full result already in action log
            //
            // ⚠️ A truncation that is not ANNOUNCED is a trap. A real run read the
            // screen 24 times and never once acted: a whole UIA tree was cut to 800
            // chars, usually mid-JSON so it could not be reasoned over, and re-reading
            // produced the SAME 800 chars. The model kept reading, hoping for more,
            // and only one of those steps was ever an attempt to ACT.
            // So a capped result must say it is capped, say how much was dropped, and
            // say what WOULD show more — otherwise it invites exactly the repeat it
            // cannot satisfy.
            const cap = this.config.RESULT_PREVIEW_CHARS;
            const rawResult = out.ok
                ? (typeof out.result === 'string' ? out.result : JSON.stringify(out.result ?? null))
                : String(out.error ?? '');
            const oversized = rawResult.length > cap;
            const shaped = oversized ? shapeOversizedResult(rawResult, cap) : null;
            const summary = JSON.stringify({
                ok: out.ok,
                ...(out.ok ? { result: oversized ? shaped.text : out.result } : { error: rawResult }),
                ...(oversized ? { cutFrom: rawResult.length, shapedAs: shaped.kind } : {}),
                mode: out.mode,
                durationMs: out.durationMs,
            }).slice(0, cap + 1200);

            const notes = [];
            if (oversized && shaped.kind === 'digest') {
                // The elements are named WITH coordinates, so this is directly
                // actionable — say so, or the model treats it as another read.
                // Also: this is always the window that happened to be IN FRONT (a real
                // run read VS Code four times while the goal was a browser), and
                // uia_find searches the whole desktop — two facts the model cannot
                // infer from a list of element names.
                notes.push(
                    `HARNESS: the full result was ${rawResult.length} characters, so it is listed above as `
                    + `${shaped.kept} of ${shaped.total} elements — name, type and screen coordinates. `
                    + 'Those coordinates are clickable: act on one with click_at({ x, y }), or uia_invoke({ name: "..." }). '
                    + 'Reading the same window again returns this same list, so do not re-read it. '
                    + 'This is whatever window was in FRONT — if it is not the app you need, call window_focus first. '
                    + 'A browser TAB that is not the active tab is not rendered at all, so nothing of its page appears here: '
                    + 'find the tab itself by name (uia_find({ name: "Google Messages" })) and uia_invoke or click_at it to switch to it. '
                    + 'And uia_find({ name: "..." }) searches the WHOLE desktop, so you can jump straight to a named '
                    + 'element (a person, a button, a folder) without reading or focusing anything first.'
                );
            } else if (oversized) {
                notes.push(
                    `HARNESS: that result was CUT from ${rawResult.length} characters to ${cap}. `
                    + 'Reading it again would cut in exactly the same place — it CANNOT show you more, so do not re-read it. '
                    + 'Ask a NARROWER question instead: uia_find to search for one element by name, a smaller region, or screen_ocr for the words on screen.'
                );
            }
            if (stuck) {
                notes.push(
                    `HARNESS: STOP — this is identical call ${repeats} to ${tc.function.name} in a row, and nothing changed as a result. `
                    + 'Repeating it cannot make progress: it is not a way to look harder, and it is not a way to wait for something. '
                    + 'Do something DIFFERENT now — act on what you have already seen (uia_invoke, click_at, text_type), '
                    + 'use a different tool to get the information, or ask the user with goal_ask_user.'
                );
            } else if (readStreak) {
                notes.push(
                    `HARNESS: you have READ the screen ${this.state.consecutiveReads} times in a row without acting on it. `
                    + 'That cannot succeed: the screen will not change until you change it. Act NOW on something you have already seen — '
                    + 'click_at or uia_invoke on an element you found, or text_type into a box you found. '
                    + 'If you genuinely cannot find the target, call goal_ask_user and say exactly what you cannot find.'
                );
            }
            this.state.history.push({
                role: 'tool',
                tool_call_id: tc.id || `${tc.function.name}_${this.state.step}`,
                content: notes.length ? `${summary}\n\n${notes.join('\n\n')}` : summary,
            });
            this.log(`[agent] step ${this.state.step} tool=${tc.function.name} ok=${out.ok}`);
            outcomes.push({ name: tc.function.name, args: argsObj, out, repeated: stuck, readStreak });
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

        // A repeated identical action, or a run of reads with no action, is NO
        // PROGRESS even when every call "succeeded". The critic scores ok/error and
        // every read returns ok — so 15 reads scored as 15 successes and stallCount
        // stayed at 0. The detector was working; it was being told the run was fine.
        const repeated = outcomes.some((o) => o.repeated);
        const readStreak = outcomes.some((o) => o.readStreak);
        if (delta <= 0 || repeated || readStreak) this.state.stallCount++;
        else this.state.stallCount = 0;

        // The critic writes one idempotent lesson per failing tick (Phase 4).
        //
        // Skipped while the account is refusing requests: this is an OPTIONAL
        // self-improvement call, it cannot succeed during an outage, and each attempt
        // spends another request against the very limit it is already over — so these
        // extra calls deepen the rate limit they are waiting out.
        if (delta < 0 && !this.state.consecutiveLlmErrors) {
            const slug = await this.critic.writeLesson(action, outcome, {
                wsClient: this.wsClient,
                goalSlug: this.state.currentGoal?.slug,
                log: this.log,
            });
            if (slug) this.state.lastLesson = slug;
        }

        // Reflection — skipped during an outage for the same reason as the lesson above.
        if (this.state.step % REFLECT_EVERY === 0 && !this.state.consecutiveLlmErrors) {
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

    /**
     * How many times, consecutively, this exact action (tool + args) has now run.
     *
     * A ring of 6 is plenty — the limit is 3, and a longer window would let a
     * repeat hide behind unrelated calls and never be seen as a repeat at all.
     */
    _countRepeats(fingerprint) {
        const ring = this.state.recentFingerprints || (this.state.recentFingerprints = []);
        ring.push(fingerprint);
        if (ring.length > 6) ring.shift();
        let n = 0;
        for (let i = ring.length - 1; i >= 0 && ring[i] === fingerprint; i--) n++;
        return n;
    }

    /**
     * The LLM did not answer. Decide whether to wait or to stop.
     *
     * This used to return `{ stop: false, idle: false, reason: 'llm-error' }`,
     * which meant three things at once, all wrong:
     *   - retry IMMEDIATELY (idle:false selects the 400 ms working delay),
     *   - never reach `reflect()`, which is the only thing that moves
     *     `stallCount` — so the stall detector was blind to it,
     *   - still spend a step, because `observe()` had already incremented it.
     *
     * A rate-limited account therefore spun at ~1/sec and burned the full budget
     * in silence. Verified in `main.log`: 26 consecutive
     * `LLM error: Too many AI requests for your account` lines, then
     * `loop exited: max-steps-reached (steps=60)` — while the user saw only a
     * spinner and a rising step count, which reads as "it is stuck in a loop".
     *
     * So: a failure is REFUNDED (the budget is for attempts, and an outage is not
     * an attempt — otherwise "60 steps" quietly means fewer than 60 tries), the
     * wait grows, and a run of failures ends the run with a reason that explains
     * itself instead of "max steps reached".
     */
    _onLlmError() {
        const n = (this.state.consecutiveLlmErrors = (this.state.consecutiveLlmErrors || 0) + 1);
        if (this.state.step > 0) this.state.step--;

        const max = this.config.LLM_ERROR_MAX_CONSECUTIVE;
        const wait = Math.min(
            this.config.LLM_ERROR_BACKOFF_MS * Math.pow(2, n - 1),
            this.config.LLM_ERROR_BACKOFF_MAX_MS
        );
        // Published so a UI has something to show. Without it, the step counter is
        // the only moving part — and the refund above deliberately holds it still,
        // so the run reads as frozen on "Step 1 of 60" for ~58s while it is really
        // working through a bounded backoff. A pause must say that it is a pause.
        this._publish('agent.llm-retry', {
            goalSlug: this.state.currentGoal?.slug,
            attempt: n,
            maxAttempts: max,
            waitMs: n >= max ? 0 : wait,
            message: 'the AI service is not accepting requests (rate limited) — waiting before trying again',
        });
        if (n >= max) {
            this.state.stopReason = 'llm-unavailable';
            this.log(`[agent] stopping: ${n} consecutive LLM failures — the model is not answering`);
            return { stop: true, reason: 'llm-unavailable' };
        }
        this.log(`[agent] LLM failure ${n}/${max} — waiting ${wait}ms before retrying`);
        return { stop: false, idle: false, reason: 'llm-error', sleepMs: wait };
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
            return this._onLlmError();
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
            this._publishGoal();
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
            // A tick may name its own wait (LLM backoff); otherwise idle ticks
            // sleep long and working ticks barely pause.
            const sleepMs = r.sleepMs ?? (r.idle ? this.config.IDLE_SLEEP_MS : STEP_DELAY_MS);
            await new Promise(res => setTimeout(res, sleepMs));

            // Meta-loop (OpenClaw-style self-reflection): every META_EVERY_ACTIONS
            // steps, review the recent action log and append a written note. Also
            // skipped during an LLM outage — it is another optional call.
            if (this.state.step - this.state.lastMetaStep >= this.config.META_EVERY_ACTIONS) {
                this.state.lastMetaStep = this.state.step;
                if (!this.state.consecutiveLlmErrors) await this._runMetaReflection();
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

        // ...and the same cadence re-reads the GOAL LIST, not just this run. The
        // backend TTL (6h) is what keeps this from being an LLM call every 50
        // steps — and it is what the /simple review panel reads back, so a long
        // run keeps that panel current without anyone pressing a button.
        if (typeof this.wsClient?.requestGoalReview === 'function') {
            this.wsClient.requestGoalReview(false).catch((e) => {
                this.log('[agent] periodic goal review skipped:', e.message);
            });
        }
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
            lastPublishedGoalSlug: null,
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

/**
 * Make an oversized result USEFUL, not merely shorter.
 *
 * A real `uia_snapshot` of a VS Code window is 23,720 characters holding 110 named
 * elements. The old shaper kept the first 800 characters — which is the window
 * caption buttons and the first menu item, because each node serialised
 * automationId, className, depth, enabled, offscreen, width and height alongside its
 * name. So the model saw "Minimize, Maximize, Close, File", and nothing else, and
 * reading again returned those same four names. SIX real runs read the screen and
 * never once acted, because there was never an element it could act ON. It never
 * called uia_find because nothing suggested anything was there to find.
 *
 * So an oversized element list is DIGESTED rather than cut: name, control type and
 * coordinates — exactly what click_at needs — and dozens fit where four did.
 * Anything else falls back to a plain cut, and both announce themselves.
 *
 * @returns {{text: string, kind: 'digest'|'cut', kept?: number, total?: number}}
 */
function shapeOversizedResult(raw, cap) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length) {
            const header = `window: ${parsed.window || '(unknown)'} — ${parsed.nodes.length} elements`
                + (parsed.truncated ? ' (the tool itself capped the tree)' : '');
            const lineFor = (n) => `- ${n.name || '(unnamed)'} [${n.controlType || n.type || 'element'}] x=${n.x} y=${n.y}`;
            const hint = (m) => `[${m} more elements omitted — uia_find({ name: "..." }) to find one by name]`;
            // Reserve room for the omitted-hint from the START. Adding it after the
            // budget check is how the first version of this overshot the cap it
            // promised (875 > 800) — the cap is a promise to the caller, not a target.
            const reserve = 96;
            const kept = [];
            let used = header.length;
            for (const n of parsed.nodes) {
                const line = lineFor(n);
                if (used + line.length + 1 + reserve > cap) break;
                kept.push(line);
                used += line.length + 1;
            }
            if (!kept.length) throw new Error('nothing fits');
            const total = parsed.nodes.length;
            let text = [header, ...kept, hint(total - kept.length)].join('\n');
            // Belt and braces: a long header or wide coordinates can still push it
            // over, so trim until it genuinely fits.
            while (text.length > cap && kept.length > 0) {
                kept.pop();
                text = [header, ...kept, hint(total - kept.length)].join('\n');
            }
            return { text, kind: 'digest', kept: kept.length, total };
        }
    } catch { /* not JSON, or nothing fit — fall through to a plain cut */ }
    return { text: raw.slice(0, cap), kind: 'cut' };
}

module.exports = { createAgentLoop, AgentLoop, shapeOversizedResult };
