/**
 * Automation entry point — wires the tool registry, permission store, and
 * Express endpoints into the existing CSimple addon server.
 *
 * Call `mountAutomation(app, { cloudRelay, ... })` once from server/index.js
 * after the Express app is constructed.
 *
 * Exposed endpoints (all local, addon-only; no auth — the addon binds to
 * 127.0.0.1 by default and the user has already authenticated to the
 * frontend, which forwards their token via /api/cloud/auth):
 *
 *   GET  /api/automation/tools           - list registered tools + schemas
 *   POST /api/automation/execute         - { name, args, goalSlug? } → result
 *   GET  /api/automation/permissions     - current permission state
 *   PUT  /api/automation/permissions     - partial update
 *   POST /api/automation/permissions/kill - emergency stop (sets killSwitch)
 *
 *   POST /api/agent/start                - begin agent loop on next active goal
 *   POST /api/agent/stop                 - stop loop
 *   GET  /api/agent/status               - { running, currentGoal, lastTick }
 *   POST /api/agent/approve              - approve/deny a pending tool call
 *                                          (queued by the permission UI)
 */

const registry = require('./tool-registry');
const permissions = require('./permissions');
const wsClient = require('./workspace-client');

const shell = require('./tools/shell');
const { fsRead, fsWrite, fsList } = require('./tools/fs');
const { windowList, windowFocus, processList, processKill, clipboardRead, clipboardWrite } = require('./tools/system');
const screen = require('./tools/screen');
const screenRelay = require('./tools/screen-relay');
const { screenOcr } = require('./tools/ocr');
const { screenSetOfMarks } = require('./tools/set-of-marks');
const {
    browserOpen, browserGoto, browserClick, browserFill,
    browserText, browserEval, browserScreenshot, browserStatus, browserClose,
} = require('./tools/browser');
const { uiaFind, uiaInvoke, uiaGetText, uiaSnapshot } = require('./tools/uia');
const { perceptionRecent } = require('./perception');
const { goalUpdate, goalCreate, goalAskUser } = require('./tools/goal');
const { inputHold, inputTap, clickAt } = require('./tools/input');
const { findVisualTarget } = require('./vision-fusion');

const recorder = require('./recorder');
const { compileRecording } = require('./recorder/compiler');
const { skillRun, cacheSkill, getCachedSkill } = require('./tools/skill');

const events = require('./events');
const triggers = require('./triggers');

const { createAgentLoop } = require('./agent-loop');

let _agentLoop = null;
let _pendingApprovals = new Map(); // id -> { resolve, toolName, args, createdAt }

function registerAllTools() {
    // Safe / read-only
    registry.register(fsRead);
    registry.register(fsList);
    registry.register(windowList);
    registry.register(processList);
    registry.register(clipboardRead);
    registry.register(screen);
    registry.register(screenOcr);
    registry.register(screenSetOfMarks);
    // Browser (Chromium via playwright-core)
    registry.register(browserOpen);
    registry.register(browserGoto);
    registry.register(browserClick);
    registry.register(browserFill);
    registry.register(browserText);
    registry.register(browserEval);
    registry.register(browserScreenshot);
    registry.register(browserStatus);
    registry.register(browserClose);
    registry.register(uiaFind);
    registry.register(uiaGetText);
    registry.register(uiaSnapshot);
    registry.register(perceptionRecent);

    // Sandboxed writes
    registry.register(fsWrite);
    registry.register(clipboardWrite);
    registry.register(screenRelay);

    // System
    registry.register(windowFocus);
    registry.register(uiaInvoke);
    registry.register(inputHold);
    registry.register(inputTap);
    registry.register(clickAt);

    // Destructive
    registry.register(processKill);

    // Shell
    registry.register(shell);

    // Goal management (talks to backend)
    registry.register(goalUpdate);
    registry.register(goalCreate);
    registry.register(goalAskUser);

    // Vision+UIA fusion (multimodal click fallback)
    registry.register(findVisualTarget);

    // Recorded-skill runner
    registry.register(skillRun);
}

/**
 * Approval flow: tools that need user OK call permissions.requestApproval(),
 * which calls the registered requester. We push approval requests through an
 * in-memory queue keyed by id; the renderer (permission center) polls
 * /api/agent/pending and POSTs /api/agent/approve with the decision.
 *
 * If no renderer is connected within `timeoutMs`, the request is denied.
 */
function defaultApprovalRequester({ pendingApprovals, timeoutMs = 60_000, autoApproveFn }) {
    return async (toolName, args) => {
        // Synchronous auto-approve (e.g. for shell allow-list matches).
        if (autoApproveFn) {
            const auto = autoApproveFn(toolName, args);
            if (auto?.approved) return { approved: true, approvedBy: auto.approvedBy || 'auto-allow' };
        }
        const id = `apr_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        return await new Promise((resolve) => {
            const timer = setTimeout(() => {
                pendingApprovals.delete(id);
                events.publish('approval.resolved', { id, approved: false, reason: 'timeout' });
                resolve({ approved: false, reason: 'approval timed out' });
            }, timeoutMs);
            pendingApprovals.set(id, {
                id, toolName, args, createdAt: Date.now(),
                resolve: (answer) => { clearTimeout(timer); resolve(answer); },
            });
            events.publish('approval.pending', { id, toolName, args, createdAt: Date.now() });
            console.log(`[automation] APPROVAL NEEDED ${id} → ${toolName} ${JSON.stringify(args).slice(0, 200)}`);
        });
    };
}

/**
 * Shell allow-list auto-approval: if the command matches any allow pattern
 * and the category is 'ask', short-circuit the prompt.
 */
function shellAutoApprove(toolName, args) {
    if (toolName !== 'shell_run') return null;
    const cfg = permissions.load();
    const cmd = String(args?.command || '');
    for (const pat of cfg.shellAllowPatterns || []) {
        try { if (new RegExp(pat, 'i').test(cmd)) return { approved: true, approvedBy: `auto-allow:${pat}` }; }
        catch {}
    }
    return null;
}

function mountAutomation(app, { cloudRelay, log = console.log } = {}) {
    registerAllTools();

    // Wire the workspace client to whichever token the cloud relay holds.
    wsClient.setTokenGetter(() => cloudRelay?._token || null);

    permissions.setApprovalRequester(
        defaultApprovalRequester({
            pendingApprovals: _pendingApprovals,
            autoApproveFn: shellAutoApprove,
        })
    );

    const ctxFactory = (extra = {}) => ({
        log,
        addAction: async (record) => {
            try { await wsClient.appendAction(record); }
            catch (e) { log('[automation] action audit failed:', e.message); }
        },
        ...extra,
    });

    // ─── Tool catalog & ad-hoc execution ───────────────────────────────────────
    app.get('/api/automation/tools', (req, res) => {
        const tools = registry.list().map(t => ({
            name: t.name,
            category: t.category,
            description: t.description,
            parameters: t.parameters,
            effectiveMode: permissions.effectiveMode(t),
        }));
        res.json({ count: tools.length, tools });
    });

    app.post('/api/automation/execute', async (req, res) => {
        const { name, args, goalSlug } = req.body || {};
        if (!name) return res.status(400).json({ error: 'name is required' });
        const ctx = ctxFactory({ goalSlug });
        const out = await registry.executeTool(name, args || {}, ctx);
        res.json(out);
    });

    // ─── Permissions API ────────────────────────────────────────────────────
    app.get('/api/automation/permissions', (req, res) => {
        res.json(permissions.load());
    });
    app.put('/api/automation/permissions', (req, res) => {
        const before = permissions.load();
        const after = permissions.save(req.body || {});
        // Diff at the top level to give subscribers a useful changedKeys list.
        const changedKeys = [];
        for (const k of Object.keys(req.body || {})) {
            if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changedKeys.push(k);
        }
        if (changedKeys.length) events.publish('permissions.changed', { changedKeys });
        res.json(after);
    });
    app.post('/api/automation/permissions/kill', (req, res) => {
        const cfg = permissions.save({ globalKillSwitch: true });
        events.publish('permissions.changed', { changedKeys: ['globalKillSwitch'], killSwitch: true });
        // Also stop the agent loop if running.
        if (_agentLoop?.running) _agentLoop.stop('kill switch');
        res.json(cfg);
    });

    // ─── Pending approvals (long-poll for the permission center UI) ─────────
    app.get('/api/automation/pending-approvals', (req, res) => {
        res.json({
            approvals: Array.from(_pendingApprovals.values()).map(a => ({
                id: a.id, toolName: a.toolName, args: a.args, createdAt: a.createdAt,
            })),
        });
    });
    app.post('/api/automation/approve', (req, res) => {
        const { id, approved, reason } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id is required' });
        const entry = _pendingApprovals.get(id);
        if (!entry) return res.status(404).json({ error: 'approval not found or expired' });
        _pendingApprovals.delete(id);
        entry.resolve({ approved: !!approved, reason, approvedBy: 'user' });
        events.publish('approval.resolved', { id, approved: !!approved, reason });
        res.json({ ok: true });
    });

    // ─── Agent loop control ─────────────────────────────────────────────────
    _agentLoop = createAgentLoop({
        wsClient,
        registry,
        contextFactory: ctxFactory,
        log,
    });

    app.post('/api/agent/start', async (req, res) => {
        try {
            const started = await _agentLoop.start(req.body || {});
            res.json(started);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/agent/stop', (req, res) => {
        const reason = (req.body && req.body.reason) || 'user requested stop';
        _agentLoop.stop(reason);
        res.json({ stopped: true, reason });
    });
    app.get('/api/agent/status', (req, res) => {
        res.json(_agentLoop.status());
    });

    // ─── Live event stream (SSE) ────────────────────────────────────────────
    // Subscribers (web UI panel, remote approver, mobile dashboard relay)
    // get a server-sent-events feed of automation telemetry: tool calls,
    // agent steps, recorder state, pending approvals, permission edits.
    //
    // Query params:
    //   sinceSeq=N — replay events from the ring buffer with seq > N
    //                before streaming live ones (default: replay last 20)
    //   types=tool.start,tool.end — comma-separated allow-list filter
    app.get('/api/agent/events', (req, res) => {
        const sinceSeq = Number.parseInt(req.query.sinceSeq, 10) || 0;
        const allow = req.query.types
            ? new Set(String(req.query.types).split(',').map(s => s.trim()).filter(Boolean))
            : null;

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();

        const send = (ev) => {
            if (allow && !allow.has(ev.type)) return;
            try {
                res.write(`id: ${ev.seq}\n`);
                res.write(`event: ${ev.type}\n`);
                res.write(`data: ${JSON.stringify(ev)}\n\n`);
            } catch {
                // Connection closed mid-write; let the cleanup path handle it.
            }
        };

        // Replay recent events first so a late subscriber catches up.
        const replay = sinceSeq > 0 ? events.recent(500, sinceSeq) : events.recent(20);
        for (const ev of replay) send(ev);

        const unsub = events.subscribe(send);

        // Heartbeat every 25s to keep proxies / Electron's net stack from
        // collapsing the long-lived connection.
        const hb = setInterval(() => {
            try { res.write(': heartbeat\n\n'); } catch {}
        }, 25_000);

        req.on('close', () => {
            clearInterval(hb);
            unsub();
        });
    });

    // ─── Demonstration recorder ─────────────────────────────────────────────
    // Recording is a user-initiated, foreground operation. These routes are
    // local-only (same loopback binding as the rest of the addon). They do
    // not go through the LLM tool registry — recording must always be the
    // user's deliberate choice, never the agent's.
    app.post('/api/recorder/start', async (req, res) => {
        try {
            const name = (req.body && req.body.name) || `recording`;
            const info = await recorder.start({ name });
            events.publish('recorder.started', { sessionId: info.sessionId, name });
            res.json({ ok: true, ...info });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
    app.post('/api/recorder/stop', async (req, res) => {
        try {
            const result = await recorder.stop();
            events.publish('recorder.stopped', {
                sessionId: result.sessionId,
                eventCount: result.eventCount,
                durationMs: result.durationMs,
            });
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
    app.post('/api/recorder/marker', (req, res) => {
        try {
            const label = (req.body && req.body.label) || '';
            res.json(recorder.appendMarker(label));
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
    app.get('/api/recorder/status', (req, res) => {
        res.json(recorder.status());
    });
    app.get('/api/recorder/list', async (req, res) => {
        try { res.json({ recordings: await recorder.list() }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.get('/api/recorder/:sessionId', async (req, res) => {
        try { res.json(await recorder.read(req.params.sessionId)); }
        catch (e) { res.status(404).json({ error: e.message }); }
    });
    app.delete('/api/recorder/:sessionId', async (req, res) => {
        try { res.json(await recorder.remove(req.params.sessionId)); }
        catch (e) { res.status(404).json({ error: e.message }); }
    });

    // ─── Skill compile / save / list / run ──────────────────────────────────
    // Compile a recording into a skill object (does NOT save).
    app.post('/api/skill/compile', async (req, res) => {
        try {
            const { sessionId, name, description } = req.body || {};
            if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
            const recording = await recorder.read(sessionId);
            const skill = compileRecording(recording, { name, description });
            res.json({ skill });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // Save a skill: cache locally + persist to workspace (kind='skill').
    app.post('/api/skill/save', async (req, res) => {
        try {
            const { skill } = req.body || {};
            if (!skill || !skill.slug) return res.status(400).json({ error: 'skill.slug is required' });
            cacheSkill(skill);
            // Best-effort persist to workspace; local cache is the source of truth
            // for immediate runs even if the user is signed out.
            let persisted = null;
            try {
                persisted = await wsClient.upsertSkill(skill.slug, {
                    name: skill.name,
                    content: JSON.stringify(skill),
                    tags: ['demonstration', 'compiled-v' + (skill.metadata?.compilerVersion ?? 1)],
                });
            } catch (e) {
                persisted = { error: e.message };
            }
            res.json({ ok: true, slug: skill.slug, persisted });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // Look up a skill (local cache first, workspace second).
    app.get('/api/skill/:slug', async (req, res) => {
        const slug = req.params.slug;
        const local = getCachedSkill(slug);
        if (local) return res.json({ source: 'local', skill: local });
        try {
            const item = await wsClient.getSkill(slug);
            const content = item?.content || item?.attrs?.content;
            const skill = typeof content === 'string' ? JSON.parse(content) : content;
            if (skill) cacheSkill(skill);
            res.json({ source: 'workspace', skill });
        } catch (e) {
            res.status(404).json({ error: e.message });
        }
    });

    // ─── Trigger engine routes ──────────────────────────────────────────────
    // Triggers are user-configured automation rules (cron/file/hotkey) that
    // enqueue a goal into the agent loop. The actual `configure()` and
    // `loadFromDisk()` calls happen from main.js (which has the Electron
    // app context). These routes provide CRUD.
    app.get('/api/triggers', (req, res) => {
        res.json({ triggers: triggers.list() });
    });
    app.post('/api/triggers', (req, res) => {
        try {
            const t = triggers.add(req.body || {});
            events.publish('trigger.added', { id: t.id, kind: t.kind, goalSlug: t.goalSlug });
            res.json({ ok: true, trigger: t });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
    app.put('/api/triggers/:id', (req, res) => {
        try {
            const t = triggers.update(req.params.id, req.body || {});
            events.publish('trigger.updated', { id: t.id, kind: t.kind });
            res.json({ ok: true, trigger: t });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
    app.delete('/api/triggers/:id', (req, res) => {
        const ok = triggers.remove(req.params.id);
        if (ok) events.publish('trigger.removed', { id: req.params.id });
        res.json({ ok });
    });

    log('[automation] mounted: tools=' + registry.list().length);
    return { registry, permissions, agentLoop: _agentLoop, triggers, events };
}

module.exports = {
    mountAutomation,
    registry,
    permissions,
    workspaceClient: wsClient,
    recorder,
    events,
    triggers,
};
