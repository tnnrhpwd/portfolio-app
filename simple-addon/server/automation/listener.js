/**
 * ContinuousListener — the "always-on" feedback loop behind the addon's
 * Listener toggle (O-O-G-P-A plan §6.3 "continuous" autonomy level).
 *
 * When enabled it runs on a cadence and autonomously keeps work moving:
 *   1. If every agent loop is idle and an active goal is waiting, start one.
 *   2. Analyze the pattern learner; a high-confidence, NON-DESTRUCTIVE
 *      suggestion is auto-promoted to a goal and the loop started on it.
 *   3. Form NEW goals from the current situation via the LLM; non-destructive,
 *      high-confidence proposals are self-created and run, and every proposal
 *      is surfaced for manual accept ("goal suggestions").
 *
 * Safety (hard stops, always enforced):
 *   - the permission kill switch blocks every tick;
 *   - only suggestions whose tools are all `safe-read` / `sandboxed-write`
 *     are ever auto-started — anything riskier is left for the human;
 *   - per-goal and per-suggestion cooldowns prevent re-starting the same
 *     work in a tight loop.
 *
 * The listener never blocks the HTTP server: each tick is fully async and
 * runs on a setInterval. It is a thin policy layer over the existing loop,
 * pattern learner, and workspace client.
 */

const crypto = require('crypto');

const CHECK_INTERVAL_MS = 60_000;      // how often to evaluate
const CONFIDENCE_THRESHOLD = 0.7;      // min confidence to auto-create/start
const GOAL_COOLDOWN_MS = 10 * 60_000;  // don't re-start the same goal within 10m
const FORM_GOALS_COOLDOWN_MS = 5 * 60_000; // how often to run goal formation
const MAX_PROPOSED = 10;               // cap the surfaced proposal list
const NON_DESTRUCTIVE = new Set(['safe-read', 'sandboxed-write']);

const FORM_GOALS_PROMPT = [
    'You are the goal-formation stage of a Windows automation agent.',
    'Given the context, propose 1-3 concrete, USEFUL, NON-DESTRUCTIVE automation goals the agent could pursue next.',
    'Prefer tasks that read/organize/search local files, look things up in the browser, or prepare short reports.',
    'For each goal list only real tool names the agent actually has: fs_list, fs_read, window_list, process_list, browser_open, browser_goto, screen_capture, uia_snapshot.',
    'Reply with ONLY a JSON array: [{"title":"...","description":"...","tools":["fs_list","..."],"confidence":0.0-1.0}].',
].join(' ');

class ContinuousListener {
    constructor({
        permissions,
        learner,
        wsClient,
        registry,
        events = null,
        log = () => {},
        llmClient = null,     // LLM client for self-forming goals from context
        perception = null,    // () => string | Promise<string> — current screen/context
        startLoop,            // (goalSlug|null) => void
        getRunningCount,      // () => number
    }) {
        this.permissions = permissions;
        this.learner = learner;
        this.wsClient = wsClient;
        this.registry = registry;
        this.events = events;
        this.log = log;
        this.llmClient = llmClient;
        this.perception = perception;
        this.startLoop = startLoop;
        this.getRunningCount = getRunningCount;

        this._timer = null;
        this._enabled = false;
        this._lastCheck = null;
        this._actedSequenceKeys = new Set();
        this._goalCooldown = new Map(); // slug -> last-started timestamp
        this._proposed = [];            // self-formed goal proposals (surfaced)
        this._proposedIds = new Set();
        this._lastFormed = 0;
    }

    isEnabled() { return this._enabled; }

    /** Enable/disable and persist the choice. Returns the new state. */
    setEnabled(enabled) {
        const next = !!enabled;
        if (next === this._enabled) return this.status();
        this._enabled = next;
        try { this.permissions.save({ continuousMode: next }); }
        catch (e) { this.log('[listener] persist failed:', e.message); }
        if (next) this._startTimer();
        else this._stopTimer();
        this._publish(next ? 'listener.started' : 'listener.stopped', {});
        this.log(`[listener] ${next ? 'enabled' : 'disabled'}`);
        return this.status();
    }

    /** Restore persisted state without re-persisting (called at mount). */
    initFromConfig() {
        const enabled = !!this.permissions.load().continuousMode;
        if (enabled) { this._enabled = true; this._startTimer(); }
    }

    /** Stop the timer without persisting a disable (used on automation remount). */
    dispose() {
        this._enabled = false;
        this._stopTimer();
    }

    status() {
        return {
            enabled: this._enabled,
            lastCheck: this._lastCheck,
            actedOn: [...this._actedSequenceKeys],
            proposed: this._proposed.length,
            goalCooldowns: [...this._goalCooldown.entries()].map(([slug, ts]) => ({ slug, at: ts })),
        };
    }

    _startTimer() {
        if (this._timer) return;
        this._timer = setInterval(() => this._tick().catch((e) => this.log('[listener] tick error:', e.message)), CHECK_INTERVAL_MS);
        // Run one tick immediately so enabling has a visible effect.
        this._tick().catch((e) => this.log('[listener] first tick error:', e.message));
    }

    _stopTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    _publish(type, data) {
        if (!this.events) return;
        try { this.events.publish(type, data); } catch { /* never let a listener kill the bus */ }
    }

    async _tick() {
        this._lastCheck = Date.now();
        const cfg = this.permissions.load();
        if (cfg.globalKillSwitch) return; // hard stop

        await this._maybeStartIdleLoop();
        await this._maybeAutoStartSuggestions();
        await this._maybeFormGoals();
    }

    /** "Always ready to start": if nothing is running and a goal waits, start it. */
    async _maybeStartIdleLoop() {
        if (this.getRunningCount() > 0) return;
        let next = null;
        try { next = await this.wsClient.getNextGoal(); }
        catch { return; }
        if (!next?.slug) return;
        if (this._isCoolingDown(next.slug)) return;
        this._goalCooldown.set(next.slug, Date.now());
        this._publish('listener.goal-started', { goalSlug: next.slug, source: 'idle' });
        this.log(`[listener] starting idle loop on ${next.slug}`);
        this.startLoop(null); // primary loop picks the next active goal
    }

    /** Promote high-confidence, non-destructive suggestions to goals and run them. */
    async _maybeAutoStartSuggestions() {
        let suggestions = [];
        try { suggestions = await this.learner.analyze(); }
        catch { suggestions = []; }
        for (const s of Array.isArray(suggestions) ? suggestions : []) {
            if (!s?.sequenceKey || this._actedSequenceKeys.has(s.sequenceKey)) continue;
            if (!this._isNonDestructive(s.tools)) {
                this.log(`[listener] skipping non-destructive-only suggestion ${s.title || s.sequenceKey} (tools: ${(s.tools || []).join(', ')})`);
                continue;
            }
            if (this._confidence(s) < CONFIDENCE_THRESHOLD) continue;

            const slug = this._slugFor(s);
            try {
                await this.wsClient.upsertGoal(slug, {
                    name: String(s.title || 'Learned automation').slice(0, 80),
                    content: [s.description, `Repeated steps: ${(s.tools || []).join(' → ')}`].filter(Boolean).join('\n'),
                    status: 'active',
                    priority: 70,
                    maxSteps: 60,
                    autoAbandon: true, // auto-created, non-destructive: may self-block on stall
                    createdBy: 'listener',
                    successCriteria: 'The task described has been completed.',
                });
                this._actedSequenceKeys.add(s.sequenceKey);
                this._goalCooldown.set(slug, Date.now());
                this._publish('goal.created', { slug, name: s.title, createdBy: 'listener' });
                this._publish('listener.goal-started', { goalSlug: slug, source: 'suggestion', sequenceKey: s.sequenceKey });
                this.log(`[listener] auto-started goal ${slug} from suggestion ${s.sequenceKey}`);
                this.startLoop(slug);
            } catch (e) {
                this.log(`[listener] auto-start failed for ${s.sequenceKey}:`, e.message);
            }
        }
    }

    /** Self-formed goal proposals (surfaced to the user for accept/reject). */
    proposed() { return this._proposed.map((p) => ({ ...p })); }

    /** Accept a proposal → create the goal and start the loop on it. */
    async acceptProposal(id) {
        const p = this._proposed.find((x) => x.id === id);
        if (!p) return { ok: false, error: 'proposal not found' };
        const slug = this._slugFor({ title: p.title, sequenceKey: p.id });
        try {
            await this.wsClient.upsertGoal(slug, {
                name: String(p.title).slice(0, 80),
                content: p.description,
                status: 'active',
                priority: 60,
                maxSteps: 60,
                autoAbandon: true,
                createdBy: 'proposal-accepted',
                successCriteria: 'The task described has been completed.',
            });
        } catch (e) {
            return { ok: false, error: e.message };
        }
        this._goalCooldown.set(slug, Date.now());
        this._publish('goal.created', { slug, name: p.title, createdBy: 'proposal-accepted' });
        this.startLoop(slug);
        return { ok: true, slug, name: p.title };
    }

    /**
     * Goal formation: ask the LLM to propose NEW goals from the current
     * situation. Non-destructive, high-confidence proposals are self-formed
     * (created + started); every proposal is surfaced for manual accept.
     */
    async _maybeFormGoals() {
        if (!this.llmClient) return;
        if (Date.now() - this._lastFormed < FORM_GOALS_COOLDOWN_MS) return;
        this._lastFormed = Date.now();

        const context = await this._situationContext();
        let proposals = [];
        try {
            const resp = await this.llmClient.chat({
                message: context,
                systemPrompt: FORM_GOALS_PROMPT,
                temperature: 0.3,
                maxLength: 800,
            });
            proposals = this._parseProposals(resp?.text);
        } catch (e) {
            this.log('[listener] goal formation failed:', e.message);
            return;
        }

        for (const p of Array.isArray(proposals) ? proposals : []) {
            if (!p?.title || !p?.description) continue;
            const id = this._proposalId(p);
            if (this._proposedIds.has(id)) continue;
            this._proposedIds.add(id);

            const record = {
                id,
                title: String(p.title).slice(0, 80),
                description: String(p.description),
                tools: Array.isArray(p.tools) ? p.tools.map(String) : [],
                confidence: this._clampConfidence(p.confidence),
                source: 'formed',
                createdAt: Date.now(),
            };
            this._proposed.unshift(record);
            if (this._proposed.length > MAX_PROPOSED) this._proposed.pop();
            this._publish('listener.proposed', record);

            // Self-form only non-destructive, high-confidence goals.
            if (record.confidence >= CONFIDENCE_THRESHOLD && this._isNonDestructive(record.tools)) {
                const slug = this._slugFor({ title: record.title, sequenceKey: id });
                if (this._isCoolingDown(slug)) continue;
                try {
                    await this.wsClient.upsertGoal(slug, {
                        name: record.title,
                        content: record.description,
                        status: 'active',
                        priority: 60,
                        maxSteps: 60,
                        autoAbandon: true,
                        createdBy: 'listener-formed',
                        successCriteria: 'The task described has been completed.',
                    });
                    this._goalCooldown.set(slug, Date.now());
                    this._publish('goal.created', { slug, name: record.title, createdBy: 'listener-formed' });
                    this._publish('listener.goal-started', { goalSlug: slug, source: 'formed', proposalId: id });
                    this.log(`[listener] self-formed goal ${slug}`);
                    this.startLoop(slug);
                } catch (e) {
                    this.log('[listener] self-form start failed:', e.message);
                }
            }
        }
    }

    async _situationContext() {
        const parts = [];
        try {
            const goals = await this.wsClient.listGoals({ status: 'active' });
            const entries = (goals?.entries) || (Array.isArray(goals) ? goals : []);
            const names = entries.map((g) => g.name || g.slug).slice(0, 5);
            parts.push(`Active goals: ${names.length ? names.join(', ') : '(none)'}`);
        } catch {}
        try {
            const actions = await this.wsClient.getRecentActions(10);
            const tools = (Array.isArray(actions) ? actions : []).map((a) => a.tool || a.name).filter(Boolean);
            if (tools.length) parts.push(`Recent actions: ${tools.join(' → ')}`);
        } catch {}
        if (this.perception) {
            try {
                const p = await this.perception();
                if (p) parts.push(`Current context: ${String(p).slice(0, 300)}`);
            } catch {}
        }
        parts.push('Propose concrete automation goals the agent could work on next.');
        return parts.join('\n');
    }

    _parseProposals(text) {
        try {
            const m = String(text || '').match(/\[[\s\S]*\]/);
            if (!m) return [];
            const arr = JSON.parse(m[0]);
            return Array.isArray(arr) ? arr : [];
        } catch { return []; }
    }

    _proposalId(p) {
        return 'prop-' + crypto.createHash('sha1')
            .update(String(p.title || '') + '|' + String(p.description || ''))
            .digest('hex').slice(0, 12);
    }

    _clampConfidence(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(1, n));
    }

    /** A suggestion is non-destructive only if every tool maps to a safe category. */
    _isNonDestructive(tools) {
        const list = Array.isArray(tools) ? tools : [];
        if (!list.length) return false;
        const byName = new Map();
        try { for (const t of this.registry.list()) byName.set(t.name, t.category); } catch { return false; }
        for (const name of list) {
            const cat = byName.get(name);
            if (!cat || !NON_DESTRUCTIVE.has(cat)) return false;
        }
        return true;
    }

    _confidence(s) { return typeof s.confidence === 'number' ? s.confidence : 0; }

    _slugFor(s) {
        const base = String(s.title || s.sequenceKey || 'learned-task')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'learned-task';
        return `${base}-${String(s.sequenceKey).replace(/[^a-z0-9]+/g, '').slice(0, 8)}`;
    }

    _isCoolingDown(slug) {
        const ts = this._goalCooldown.get(slug);
        return !!ts && (Date.now() - ts) < GOAL_COOLDOWN_MS;
    }
}

module.exports = { ContinuousListener, CHECK_INTERVAL_MS, CONFIDENCE_THRESHOLD, GOAL_COOLDOWN_MS, FORM_GOALS_COOLDOWN_MS, MAX_PROPOSED, NON_DESTRUCTIVE };
