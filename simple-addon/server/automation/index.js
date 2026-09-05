/**
 * Automation entry point — wires the tool registry, permission store, and
 * Express endpoints into the existing Simple addon server.
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
 *
 *   GET    /api/workspace-profiles          - list saved window-layout profiles
 *   GET    /api/workspace-profiles/:name    - full profile (windows + rects)
 *   POST   /api/workspace-profiles          - { name } → capture current windows, save
 *   POST   /api/workspace-profiles/:name/restore - reposition/relaunch saved windows
 *   POST   /api/workspace-profiles/:name/update  - re-capture current windows, overwrite existing profile
 *   DELETE /api/workspace-profiles/:name    - delete a saved profile
 */

const registry = require('./tool-registry');
const permissions = require('./permissions');
const wsClient = require('./workspace-client');

const shell = require('./tools/shell');
const { fsRead, fsWrite, fsList } = require('./tools/fs');
const { windowList, windowFocus, windowSnapshot, windowSetRect, processList, processKill, clipboardRead, clipboardWrite } = require('./tools/system');
const workspaceProfiles = require('./workspace-profiles');
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
const { inputHold, inputTap, clickAt, mousePath, mouseDrag } = require('./tools/input');
const { openApp } = require('./tools/open-app');
const { findVisualTarget } = require('./vision-fusion');

const recorder = require('./recorder');
const { compileRecording } = require('./recorder/compiler');
const { generalizeSkill } = require('./recorder/generalize');
const { inferParams } = require('./recorder/infer-params');
const { scrubForPublish } = require('./recorder/scrub');
const { summarizeCapabilities } = require('./capability-summary');
const { skillRun, cacheSkill, getCachedSkill, uncacheSkill, getAllCachedSkills, analyzeSkillCompatibility } = require('./tools/skill');

const events = require('./events');
const triggers = require('./triggers');
const skillHotkeys = require('./skill-hotkeys');
const runHistory = require('./run-history');

const { createAgentLoop } = require('./agent-loop');
const { compile: nlCompile, editSteps: nlEditSteps } = require('./nl-compiler');
const { getPerceptionBus, frameToContextString } = require('./perception-bus');
const { getPredictor } = require('./predictor');
const { getPatternLearner } = require('./pattern-learner');
const { audioTranscribe, audioSpeak } = require('./tools/audio');
const { webcamCapture } = require('./tools/webcam');
const { textType } = require('./tools/text-type');
const { getAudioStreamManager } = require('../audio-stream-manager');

let _agentLoop = null;             // primary (legacy) agent loop
const _agentPool = new Map();       // goalSlug → AgentLoop (multi-agent pool)
const MAX_CONCURRENT_AGENTS = 3;
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
    registry.register(windowSnapshot);
    registry.register(windowSetRect);
    registry.register(uiaInvoke);
    registry.register(inputHold);
    registry.register(inputTap);
    registry.register(clickAt);
    registry.register(mousePath);
    registry.register(mouseDrag);
    registry.register(openApp);

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

    // Multimodal perception
    registry.register(audioTranscribe);
    registry.register(audioSpeak);
    registry.register(webcamCapture);
    registry.register(textType);
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
    // Reset tool registry so a server restart doesn't hit "Duplicate tool" errors.
    // The _tools Map is a module-level singleton that survives require() cache between restarts.
    registry.reset();
    registerAllTools();

    // Wire the workspace client to whichever token the cloud relay holds.
    wsClient.setTokenGetter(() => cloudRelay?._token || null);

    // Best-effort: if a token is already present at mount time (e.g. the
    // automation router was re-mounted after a settings change while the
    // user stayed signed in), pull+merge cloud consent state once so this
    // mount reflects grants/revokes made elsewhere. Never blocks mounting.
    if (cloudRelay?._token) {
        permissions.pullAndMergeConsentsFromCloud().catch(() => {});
    }

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
        if (changedKeys.length) {
            // Include the resolved kill-switch state directly so subscribers
            // (e.g. the frontend's kill-switch banner) can react without a
            // round-trip re-fetch of the full permission config.
            events.publish('permissions.changed', { changedKeys, killSwitch: !!after.globalKillSwitch });
        }
        res.json(after);
    });
    app.post('/api/automation/permissions/kill', (req, res) => {
        const cfg = permissions.save({ globalKillSwitch: true });
        events.publish('permissions.changed', { changedKeys: ['globalKillSwitch'], killSwitch: true });
        // Also stop the agent loop if running.
        if (_agentLoop?.running) _agentLoop.stop('kill switch');
        res.json(cfg);
    });
    app.get('/api/automation/consents', (req, res) => {
        const cfg = permissions.load();
        res.json({
            dataCapture: cfg.dataCapture || permissions.DEFAULTS.dataCapture,
            cloudVision: cfg.cloudVision || permissions.DEFAULTS.cloudVision,
        });
    });
    app.put('/api/automation/consents', (req, res) => {
        const {
            keyboardCapture,
            cloudVision,
            cloudVisionPolicyVersion,
        } = req.body || {};
        const { config, changes } = permissions.updateConsents({
            keyboardCapture,
            cloudVision,
            cloudVisionPolicyVersion,
        });
        if (!changes.length) {
            return res.status(400).json({ error: 'No consent fields provided. Use keyboardCapture and/or cloudVision.' });
        }
        events.publish('permissions.changed', {
            changedKeys: changes.map(c => c.key),
            source: 'automation.consents',
            changes,
        });
        res.json({
            ok: true,
            dataCapture: config.dataCapture || permissions.DEFAULTS.dataCapture,
            cloudVision: config.cloudVision || permissions.DEFAULTS.cloudVision,
            changes,
        });
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

    // ─── Agent loop pool ────────────────────────────────────────────────────
    // Primary loop (legacy): one loop, picks next active goal automatically.
    // Pool: up to MAX_CONCURRENT_AGENTS loops, each bound to a specific goal.
    _agentLoop = createAgentLoop({
        wsClient,
        registry,
        contextFactory: ctxFactory,
        log,
    });

    function _getOrCreateLoop(goalSlug) {
        if (!goalSlug) return _agentLoop;
        if (_agentPool.has(goalSlug)) return _agentPool.get(goalSlug);
        if (_agentPool.size >= MAX_CONCURRENT_AGENTS) {
            throw new Error(`Max concurrent agents (${MAX_CONCURRENT_AGENTS}) reached. Stop one first.`);
        }
        const loop = createAgentLoop({ wsClient, registry, contextFactory: ctxFactory, log });
        _agentPool.set(goalSlug, loop);
        return loop;
    }

    function _poolStatus() {
        const primary = _agentLoop.status();
        const workers = [];
        for (const [slug, loop] of _agentPool) {
            const s = loop.status();
            workers.push({ goalSlug: slug, ...s });
            // Clean up finished workers
            if (!s.running) _agentPool.delete(slug);
        }
        return { ...primary, workers, workerCount: workers.length };
    }

    app.post('/api/agent/start', async (req, res) => {
        try {
            const { goalSlug } = req.body || {};
            const loop = _getOrCreateLoop(goalSlug || null);
            const started = await loop.start(req.body || {});
            res.json({ ...started, poolSize: _agentPool.size + 1 });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/agent/stop', (req, res) => {
        const reason = (req.body && req.body.reason) || 'user requested stop';
        const { goalSlug } = req.body || {};
        if (goalSlug && _agentPool.has(goalSlug)) {
            _agentPool.get(goalSlug).stop(reason);
            _agentPool.delete(goalSlug);
        } else {
            _agentLoop.stop(reason);
            // Also stop all pool workers
            for (const [slug, loop] of _agentPool) { loop.stop(reason); _agentPool.delete(slug); }
        }
        res.json({ stopped: true, reason });
    });
    app.get('/api/agent/status', (req, res) => {
        res.json(_poolStatus());
    });
    // List goals available to bind a trigger to (workspace items of kind='goal').
    // Used by the Triggers tab so users pick a goal by name instead of typing
    // its slug by hand.
    app.get('/api/agent/goals', async (req, res) => {
        try {
            const list = await wsClient.listGoals();
            const entries = (list && list.entries) || (Array.isArray(list) ? list : []);
            res.json({
                goals: entries.map(g => ({
                    slug: g.slug,
                    name: g.name || g.title || g.slug,
                    status: g.status,
                })),
            });
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });
    // Stop a specific worker by goal slug
    app.delete('/api/agent/worker/:goalSlug', (req, res) => {
        const slug = req.params.goalSlug;
        if (_agentPool.has(slug)) {
            _agentPool.get(slug).stop('user stopped worker');
            _agentPool.delete(slug);
            res.json({ ok: true, stopped: slug });
        } else {
            res.status(404).json({ error: 'worker not found' });
        }
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
    app.get('/api/recorder/consent-status', (req, res) => {
        const cfg = permissions.load();
        res.json({
            dataCapture: cfg.dataCapture || permissions.DEFAULTS.dataCapture,
            cloudVision: cfg.cloudVision || permissions.DEFAULTS.cloudVision,
        });
    });
    app.post('/api/recorder/start', async (req, res) => {
        try {
            const name = (req.body && req.body.name) || `recording`;
            const confirmSensitiveCapture = !!(req.body && req.body.confirmSensitiveCapture);
            if (!permissions.hasKeyboardCaptureConsent()) {
                if (!confirmSensitiveCapture) {
                    return res.status(403).json({
                        error: 'Keyboard capture consent required. Re-submit with confirmSensitiveCapture=true to grant.',
                        consentRequired: 'dataCapture.keyboard',
                    });
                }
                permissions.grantKeyboardCaptureConsent();
                events.publish('permissions.changed', { changedKeys: ['dataCapture.keyboard'], source: 'recorder.start' });
            }
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
    // Rename/duplicate a saved recording (local-only, mirrors the skill
    // rename/duplicate actions so recordings get the same list actions).
    app.post('/api/recorder/:sessionId/rename', async (req, res) => {
        try {
            const { name } = req.body || {};
            res.json(await recorder.rename(req.params.sessionId, name));
        } catch (e) { res.status(400).json({ error: e.message }); }
    });
    app.post('/api/recorder/:sessionId/duplicate', async (req, res) => {
        try {
            const { name } = req.body || {};
            res.json(await recorder.duplicate(req.params.sessionId, name || req.params.sessionId));
        } catch (e) { res.status(400).json({ error: e.message }); }
    });

    // ─── Workspace Profiles (save/restore window layouts) ──────────────────
    app.get('/api/workspace-profiles', async (req, res) => {
        try { res.json({ profiles: await workspaceProfiles.list() }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.get('/api/workspace-profiles/:name', async (req, res) => {
        try { res.json(await workspaceProfiles.get(req.params.name)); }
        catch (e) { res.status(404).json({ error: e.message }); }
    });
    app.post('/api/workspace-profiles', async (req, res) => {
        const { name, includeDashboard } = req.body || {};
        if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
        try {
            const profile = await workspaceProfiles.save(name, { includeDashboard: !!includeDashboard });
            events.publish('workspace.saved', { name: profile.name, windowCount: profile.windows.length });
            res.json(profile);
        } catch (e) { res.status(400).json({ error: e.message }); }
    });
    app.post('/api/workspace-profiles/:name/restore', async (req, res) => {
        try {
            const result = await workspaceProfiles.restore(req.params.name);
            events.publish('workspace.restored', result);
            res.json(result);
        } catch (e) { res.status(404).json({ error: e.message }); }
    });
    app.post('/api/workspace-profiles/:name/update', async (req, res) => {
        const { includeDashboard } = req.body || {};
        try {
            const profile = await workspaceProfiles.update(req.params.name, { includeDashboard });
            events.publish('workspace.updated', { name: profile.name, windowCount: profile.windows.length });
            res.json(profile);
        } catch (e) { res.status(404).json({ error: e.message }); }
    });
    app.delete('/api/workspace-profiles/:name', async (req, res) => {
        try { res.json(await workspaceProfiles.remove(req.params.name)); }
        catch (e) { res.status(404).json({ error: e.message }); }
    });

    // ─── Skill hotkeys (macro keyboard shortcuts) ───────────────────────────
    // These MUST be declared before the `/api/skill/:slug` param route below so
    // that `/api/skill/hotkeys` is not swallowed as a slug lookup.
    //
    // The web app owns the source of truth (skills live in the DB, each with an
    // optional `hotkey`). It pushes the full desired binding map here; main.js
    // performs the actual globalShortcut registration via the onHotkeyChange
    // callback wired in skillHotkeys.configure().
    app.get('/api/skill/hotkeys', (req, res) => {
        res.json({ hotkeys: skillHotkeys.list() });
    });
    app.post('/api/skill/hotkeys', (req, res) => {
        try {
            const mappings = (req.body && req.body.hotkeys) || [];
            const result = skillHotkeys.setAll(mappings);
            events.publish('skill.hotkeys.updated', {
                count: result.registered.length,
                skipped: result.skipped.length,
            });
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // ─── Local run history (recent skill runs, manual + trigger-fired) ─────
    // Must be declared before `/api/skill/:slug` so `/api/skill/runs` isn't
    // swallowed as a slug lookup. Durable on-device record of the last N skill
    // runs, so the dashboard can answer "did my 9am trigger actually run?"
    // after the fact — the live run console only covers a run while it's in
    // flight, and the event ring buffer doesn't survive a restart.
    app.get('/api/skill/runs', (req, res) => {
        const limit = Number.parseInt(req.query.limit, 10) || 50;
        res.json({ runs: runHistory.list({ limit }) });
    });
    app.delete('/api/skill/runs', (req, res) => {
        res.json(runHistory.clear());
    });

    // Run a saved skill by slug (resolves local cache → workspace). Goes through
    // the permission-gated tool registry exactly like the agent would — but with
    // `userInitiated: true` because this endpoint is only reachable from the
    // loopback UI (user clicked Run) or the Electron globalShortcut handler
    // (user pressed the bound hotkey). Both are direct user actions, so an
    // 'ask'-mode tool is fast-tracked to allow, matching chat behaviour.
    //
    // If `skill` is provided in the body, it's forwarded as `args.cache` so the
    // tool can execute without needing to hit the workspace API. This makes
    // Run-from-web work immediately after an addon restart (empty local cache)
    // and independent of cloud auth state.
    //
    // If the caller passes `runId` (a client-generated correlation id), it's
    // threaded through ctx → every tool.start/tool.end event published for
    // this run AND each of its nested steps (skill_run re-enters the registry
    // per step, and runId flows through runCtx — see tool-registry.js). This
    // lets a UI subscribe to /api/agent/events and reconstruct a live,
    // step-by-step console for exactly this run, even if other runs or agent
    // activity are happening at the same time.
    app.post('/api/skill/run', async (req, res) => {
        const startedAt = Date.now();
        const firedBy = req.body && req.body._firedBy; // trigger id when fired by the trigger engine
        try {
            const { slug, params, skill, marketplaceInstalled, confirmCapabilities, runId } = req.body || {};
            if (!slug) return res.status(400).json({ error: 'slug is required' });
            if (marketplaceInstalled && !confirmCapabilities) {
                const preview = (skill && Array.isArray(skill.steps)) ? summarizeCapabilities(skill) : null;
                return res.status(403).json({
                    error: 'Capability confirmation required before first run of a marketplace-installed skill.',
                    capabilityConfirmationRequired: true,
                    preview,
                });
            }
            const ctx = ctxFactory({ goalSlug: null, userInitiated: true, runId: runId || undefined });
            const args = { slug, params: params || {} };
            if (skill && skill.slug === slug) args.cache = skill;
            const out = await registry.executeTool('skill_run', args, ctx);
            const summary = out?.result || {};
            const failedStep = Array.isArray(summary.steps) ? summary.steps.find(s => s && s.error) : null;
            events.publish('skill.run', {
                slug,
                runId: runId || undefined,
                stepsRun: summary.stepsRun,
                failed: !!summary.failed,
                outcome: summary.outcome || null,
            });
            runHistory.append({
                runId: runId || null,
                slug,
                startedAt,
                finishedAt: Date.now(),
                durationMs: Date.now() - startedAt,
                stepsRun: summary.stepsRun ?? null,
                stepsTotal: summary.stepsTotal ?? (Array.isArray(summary.steps) ? summary.steps.length : null),
                failed: !!summary.failed || !!failedStep,
                outcome: summary.outcome || null,
                error: failedStep ? (failedStep.error || `${failedStep.tool || 'step'} failed`) : (out?.error || null),
                triggerId: firedBy ? String(firedBy) : null,
                source: firedBy ? 'trigger' : 'manual',
            });
            res.json(out);
        } catch (e) {
            runHistory.append({
                runId: null,
                slug: (req.body && req.body.slug) || 'unknown',
                startedAt,
                finishedAt: Date.now(),
                durationMs: Date.now() - startedAt,
                failed: true,
                error: e.message,
                triggerId: firedBy ? String(firedBy) : null,
                source: firedBy ? 'trigger' : 'manual',
            });
            res.status(400).json({ error: e.message });
        }
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

    // Generalize a compiled (literal) skill into a more robust abstracted form
    // via LLM re-derivation (docs/new/simple-agent-prompt.md §5.1). Accepts
    // either `sessionId` (compiles fresh, then generalizes) or an already-
    // compiled `skill` object, plus an optional `goalDescription` hint.
    // Best-effort: on LLM failure the original literal-step skill is returned
    // unchanged with `metadata.generalizeError` set — never a hard error.
    app.post('/api/skill/generalize', async (req, res) => {
        try {
            const { sessionId, skill: inputSkill, goalDescription, name, description } = req.body || {};
            let skill = inputSkill;
            if (!skill) {
                if (!sessionId) return res.status(400).json({ error: 'sessionId or skill is required' });
                const recording = await recorder.read(sessionId);
                skill = compileRecording(recording, { name, description });
            }
            const generalized = await generalizeSkill(skill, { goalDescription });
            res.json({ skill: generalized });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // Multi-demonstration parameter inference (§5.2). Opt-in: only invoked
    // when the caller explicitly supplies 2+ compiled skills of the SAME
    // task (e.g. via a "demonstrate again" affordance). Diffs the demos and
    // promotes varying literal values (typed text, target names, numeric
    // values) into `${param.x}` placeholders. Best-effort/never fatal: a
    // step-count mismatch or per-step kind mismatch degrades to a no-op /
    // partial result with `report.reason` or per-finding `skipped` notes
    // rather than an error — see recorder/infer-params.js header comment.
    app.post('/api/skill/infer-params', async (req, res) => {
        try {
            const { sessionIds, skills } = req.body || {};
            let demos = skills;
            if (!Array.isArray(demos) || demos.length < 2) {
                if (!Array.isArray(sessionIds) || sessionIds.length < 2) {
                    return res.status(400).json({ error: 'skills (2+) or sessionIds (2+) is required' });
                }
                demos = await Promise.all(sessionIds.map(async id => compileRecording(await recorder.read(id))));
            }
            const { skill: inferred, report } = inferParams(demos);
            res.json({ skill: inferred, report });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // Preview the privacy scrub pass on a skill before publishing (§6.1). Does
    // NOT save/publish anything — returns the scrubbed skill + a report of
    // every redaction made, so the frontend can render the mandatory
    // "what will be shared" review. The report never contains raw sensitive
    // values (see recorder/scrub.js), so it's safe to display directly.
    app.post('/api/skill/scrub', async (req, res) => {
        try {
            const { skill } = req.body || {};
            if (!skill || !Array.isArray(skill.steps)) return res.status(400).json({ error: 'skill.steps is required' });
            const { skill: scrubbed, report } = scrubForPublish(skill);
            res.json({ skill: scrubbed, report });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // Pre-run "what will this skill do" capability summary (§6.2). Read-only
    // — does not execute anything. Mandatory before first run of any skill
    // installed from the marketplace (§4.3); also usable for local skills.
    app.post('/api/skill/capabilities', async (req, res) => {
        try {
            const { skill } = req.body || {};
            if (!skill || !Array.isArray(skill.steps)) return res.status(400).json({ error: 'skill.steps is required' });
            res.json(summarizeCapabilities(skill));
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    // Pre-run tool-version compatibility analysis (§5.4). Resolves each step's
    // tool against the local registry, applying deterministic downgrade rules
    // where possible, and reports compatible/degraded/unsupported counts.
    app.post('/api/skill/compatibility', async (req, res) => {
        try {
            const { skill } = req.body || {};
            if (!skill || !Array.isArray(skill.steps)) return res.status(400).json({ error: 'skill.steps is required' });
            res.json(analyzeSkillCompatibility(skill));
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

    // List all of the user's skills (cloud workspace, kind='skill'), with full
    // content resolved for each so the dashboard can render step counts,
    // hotkeys, and source badges without a per-row round trip. Falls back to
    // whatever's in the local in-memory cache when there's no cloud auth
    // token yet (e.g. addon launched before signing in on the web app) or the
    // backend is unreachable — locally-created-but-unsynced skills still show.
    app.get('/api/skill', async (req, res) => {
        try {
            const list = await wsClient.listSkills();
            const entries = list?.entries || [];
            const skills = await Promise.all(entries.map(async (it) => {
                try {
                    const item = await wsClient.getSkill(it.slug);
                    const content = item?.content || item?.attrs?.content;
                    const skill = typeof content === 'string' ? JSON.parse(content) : content;
                    if (skill) cacheSkill(skill);
                    return { item: item || it, skill: skill || null };
                } catch {
                    return { item: it, skill: null };
                }
            }));
            res.json({ source: 'workspace', skills });
        } catch (e) {
            const skills = getAllCachedSkills().map(skill => ({
                item: { slug: skill.slug, name: skill.name || skill.slug },
                skill,
            }));
            res.json({ source: 'local', skills, error: e.message });
        }
    });

    // Delete a skill: drop the local cache entry + soft-delete the workspace
    // record (kind='skill'). Mirrors the web app's delete behaviour.
    app.delete('/api/skill/:slug', async (req, res) => {
        const slug = req.params.slug;
        try {
            uncacheSkill(slug);
            const result = await wsClient.deleteSkill(slug);
            res.json({ ok: true, slug, result });
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

    // ─── Marketplace routes (§4 of docs/new/simple-agent-prompt.md) ────────
    // Thin proxies to the shared backend's public/shared marketplace surface
    // (a SEPARATE namespace from the private per-user workspace skill store
    // above). The frontend is expected to have already run /api/skill/scrub
    // + /api/skill/capabilities locally before calling publish.
    app.post('/api/market/skills', async (req, res) => {
        try {
            const result = await wsClient.publishMarketSkill(req.body || {});
            res.json(result);
        } catch (e) {
            res.status(e.status || 400).json({ error: e.message });
        }
    });
    app.get('/api/market/skills', async (req, res) => {
        try {
            const { q, sort, page, perPage } = req.query || {};
            const result = await wsClient.searchMarketSkills({ q, sort, page, perPage });
            res.json(result);
        } catch (e) {
            res.status(e.status || 400).json({ error: e.message });
        }
    });
    app.get('/api/market/skills/:marketId/:version?', async (req, res) => {
        try {
            const result = await wsClient.getMarketSkill(req.params.marketId, req.params.version);
            res.json(result);
        } catch (e) {
            res.status(e.status || 404).json({ error: e.message });
        }
    });
    app.post('/api/market/skills/:marketId/install', async (req, res) => {
        try {
            const result = await wsClient.installMarketSkill(req.params.marketId, req.body?.version);
            res.json(result);
        } catch (e) {
            res.status(e.status || 400).json({ error: e.message });
        }
    });
    app.post('/api/market/skills/:marketId/rate', async (req, res) => {
        try {
            const result = await wsClient.rateMarketSkill(req.params.marketId, req.body || {});
            res.json(result);
        } catch (e) {
            res.status(e.status || 400).json({ error: e.message });
        }
    });
    app.post('/api/market/skills/:marketId/flag', async (req, res) => {
        try {
            const result = await wsClient.flagMarketSkill(req.params.marketId, req.body?.reason);
            res.json(result);
        } catch (e) {
            res.status(e.status || 400).json({ error: e.message });
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

    // ─── NL Macro Compiler ─────────────────────────────────────────────────
    // Converts English macro descriptions into executable skill step arrays.
    // Always proxied through the backend (compileNaturalViaBackend, via
    // nl-compiler.js) using the user's JWT -- Bedrock runs server-side only.
    app.post('/api/skill/compile-natural', async (req, res) => {
        try {
            const { description, context, noCache } = req.body || {};
            if (!description || typeof description !== 'string' || !description.trim()) {
                return res.status(400).json({ error: 'description is required' });
            }
            if (description.length > 2000) {
                return res.status(400).json({ error: 'description too long (max 2000 chars)' });
            }

            const result = await nlCompile(description.trim(), {
                context: typeof context === 'string' ? context.slice(0, 500) : undefined,
                noCache: !!noCache,
            });

            events.publish('skill.compiled-natural', { stepCount: result.steps?.length || 0 });
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(e.status || 400).json({
                error: e.message,
                ...(e.limiter ? { limiter: e.limiter } : {}),
                ...(e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
            });
        }
    });

    // Modify an EXISTING macro's steps via English instruction, e.g.
    // "press z after the shift click". Same backend-proxy-only path as
    // compile-natural.
    app.post('/api/skill/edit-natural', async (req, res) => {
        try {
            const { steps, instruction, context } = req.body || {};
            if (!Array.isArray(steps) || steps.length === 0) {
                return res.status(400).json({ error: 'steps must be a non-empty array' });
            }
            if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
                return res.status(400).json({ error: 'instruction is required' });
            }
            if (instruction.length > 1000) {
                return res.status(400).json({ error: 'instruction too long (max 1000 chars)' });
            }

            const result = await nlEditSteps(steps, instruction.trim(), {
                context: typeof context === 'string' ? context.slice(0, 500) : undefined,
            });

            events.publish('skill.edited-natural', { stepCount: result.steps?.length || 0 });
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(e.status || 400).json({
                error: e.message,
                ...(e.limiter ? { limiter: e.limiter } : {}),
                ...(e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
            });
        }
    });

    // ─── Voice / Audio endpoints ────────────────────────────────────────────
    const _audioMgr = getAudioStreamManager();

    app.get('/api/voice/status', (req, res) => {
        res.json(_audioMgr.getStatus());
    });

    app.post('/api/voice/listen', async (req, res) => {
        try {
            const { maxSeconds, silenceMs } = req.body || {};
            const result = await _audioMgr.listen({
                maxSeconds: Math.min(Number(maxSeconds) || 10, 60),
                silenceMs: Math.min(Number(silenceMs) || 800, 5000),
            });
            events.publish('voice.transcript', { text: (result?.text || '').slice(0, 200), wakeword: result?.wakeword_detected });
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/voice/stop', (req, res) => {
        _audioMgr.stopListening();
        res.json({ ok: true });
    });

    app.post('/api/voice/speak', async (req, res) => {
        try {
            const { text, rate, volume } = req.body || {};
            if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });
            await _audioMgr.speak(text.slice(0, 500), { rate: Number(rate) || 175, volume: Number(volume) || 1.0 });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/voice/devices', async (req, res) => {
        try {
            const devices = await _audioMgr.listDevices();
            res.json({ devices });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/voice/wakeword/start', (req, res) => {
        _audioMgr.startWakewordLoop();
        // Forward wakeword events to the SSE bus
        _audioMgr.on('wakeword', (msg) => {
            events.publish('voice.wakeword', { phrase: msg.phrase, remainder: msg.remainder });
        });
        res.json({ ok: true, wakewordLoop: true });
    });

    app.post('/api/voice/wakeword/stop', (req, res) => {
        _audioMgr.stopWakewordLoop();
        res.json({ ok: true, wakewordLoop: false });
    });

    // ─── Perception Bus ─────────────────────────────────────────────────────
    const _bus = getPerceptionBus();

    app.get('/api/perception/status', (req, res) => {
        res.json(_bus.getStatus());
    });

    app.get('/api/perception/frame', (req, res) => {
        const frame = _bus.getLatestFrame();
        if (!frame) return res.json({ frame: null, context: '(no data yet)' });
        // Strip raw base64 from HTTP response unless asked for
        const safe = { ...frame, screen: frame.screen ? { ...frame.screen, base64: undefined } : null };
        res.json({ frame: safe, context: frameToContextString(frame) });
    });

    app.get('/api/perception/history', (req, res) => {
        const history = _bus.getHistory().map(f => ({
            ts: f.ts, seq: f.seq,
            hasScreen: !!f.screen,
            window: f.window,
            audio: f.audio ? { transcript: f.audio.transcript?.slice(0, 100), confidence: f.audio.confidence } : null,
            gaze: f.gaze,
            recentActions: f.recentActions,
        }));
        res.json({ count: history.length, history });
    });

    // ─── Behavioral Predictor ───────────────────────────────────────────────
    const _predictor = getPredictor();

    // Hook predictor into tool execution audit
    registry.onExecuted((toolName, args) => {
        _predictor.record(toolName, args);
    });

    app.get('/api/agent/predictions', (req, res) => {
        res.json({
            predictions: _predictor.predict(),
            stats: _predictor.getStats(),
        });
    });

    // ─── Pattern Learner (proactive automation suggestions) ────────────────
    const _learner = getPatternLearner();
    _learner.configure({ wsClient });

    app.get('/api/agent/suggestions', async (req, res) => {
        try {
            const force = req.query.force === 'true';
            const suggestions = await _learner.analyze({ force });
            res.json({ suggestions, count: suggestions.length });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Accept a suggestion: turn the detected repeated pattern into a goal the
    // agent can pick up. We deliberately create a GOAL (agent-planned) rather
    // than fabricating a deterministic skill — the learner only keeps tool
    // fingerprints, not the exact args, so rebuilding precise steps would be
    // guesswork. A goal is the honest translation of "I do X → Y → Z often."
    app.post('/api/agent/suggestions/accept', async (req, res) => {
        try {
            const { title, description, tools } = req.body || {};
            if (!title && !description) return res.status(400).json({ error: 'suggestion title/description required' });
            const name = String(title || description || 'Automation').slice(0, 80);
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `suggestion-${Date.now()}`;
            const content = [
                description,
                Array.isArray(tools) && tools.length ? `Repeated steps: ${tools.join(' → ')}` : '',
            ].filter(Boolean).join('\n');
            await wsClient.upsertGoal(slug, {
                name,
                content,
                status: 'active',
                priority: 70,
                createdBy: 'suggestion',
                successCriteria: 'The task described has been completed.',
            });
            events.publish('goal.created', { slug, name, createdBy: 'suggestion' });
            res.json({ ok: true, slug, name });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Clipboard-to-Goal: read the system clipboard and create a goal from it.
    // Called by the tray menu "Create Goal from Clipboard" or the global hotkey.
    app.post('/api/agent/goal-from-clipboard', async (req, res) => {
        try {
            const clipOut = await registry.executeTool('clipboard_read', {}, ctxFactory({}));
            const text = clipOut?.result?.text?.trim() || clipOut?.result?.trim?.() || '';
            if (!text) return res.status(400).json({ error: 'Clipboard is empty' });
            const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'clipboard-goal';
            await wsClient.upsertGoal(slug, {
                name: text.slice(0, 80),
                content: text,
                status: 'active',
                priority: 75,
                createdBy: 'clipboard',
                successCriteria: 'The task described has been completed.',
            });
            events.publish('goal.created', { slug, name: text.slice(0, 80), createdBy: 'clipboard' });
            res.json({ ok: true, slug, text: text.slice(0, 200) });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    log('[automation] mounted: tools=' + registry.list().length);
    return { registry, permissions, agentLoop: _agentLoop, triggers, events, skillHotkeys, perceptionBus: _bus, predictor: _predictor, audioManager: _audioMgr, patternLearner: _learner };
}

module.exports = {
    mountAutomation,
    registry,
    permissions,
    workspaceClient: wsClient,
    recorder,
    events,
    triggers,
    skillHotkeys,
};
