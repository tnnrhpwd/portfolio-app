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
const { uiaFind, uiaInvoke, uiaGetText } = require('./tools/uia');
const { goalUpdate, goalCreate, goalAskUser } = require('./tools/goal');
const { inputHold, inputTap } = require('./tools/input');
const { findVisualTarget } = require('./vision-fusion');

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
    registry.register(uiaFind);
    registry.register(uiaGetText);

    // Sandboxed writes
    registry.register(fsWrite);
    registry.register(clipboardWrite);

    // System
    registry.register(windowFocus);
    registry.register(uiaInvoke);
    registry.register(inputHold);
    registry.register(inputTap);

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
                resolve({ approved: false, reason: 'approval timed out' });
            }, timeoutMs);
            pendingApprovals.set(id, {
                id, toolName, args, createdAt: Date.now(),
                resolve: (answer) => { clearTimeout(timer); resolve(answer); },
            });
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
        res.json(permissions.save(req.body || {}));
    });
    app.post('/api/automation/permissions/kill', (req, res) => {
        const cfg = permissions.save({ globalKillSwitch: true });
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

    log('[automation] mounted: tools=' + registry.list().length);
    return { registry, permissions, agentLoop: _agentLoop };
}

module.exports = {
    mountAutomation,
    registry,
    permissions,
    workspaceClient: wsClient,
};
