/**
 * Tool Registry — central place that defines every automation tool the LLM
 * (or the agent loop) may call on the user's Windows PC.
 *
 * Each tool has:
 *   - name: snake_case identifier exposed to the LLM (function-calling)
 *   - category: one of permissions.js categories
 *   - description: what the LLM sees
 *   - parameters: JSON Schema (object) for arguments
 *   - run(args, ctx): async impl. ctx = { dryRun, log, addAction, abortSignal }
 *
 * `executeTool(name, args, ctx)` handles:
 *   1. Schema-light validation (args must be an object)
 *   2. Permission gate (asks user if required, supports kill switch + dry-run)
 *   3. Tool execution with try/catch + duration + truncation
 *   4. Cloud audit-log via ctx.addAction
 */

const permissions = require('./permissions');

const _tools = new Map();

/** Register a tool. Throws if name conflicts. */
function register(tool) {
    if (!tool || !tool.name) throw new Error('Tool requires a name');
    if (_tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    if (!tool.category) throw new Error(`Tool ${tool.name} missing category`);
    if (typeof tool.run !== 'function') throw new Error(`Tool ${tool.name} missing run()`);
    _tools.set(tool.name, tool);
}

function list() {
    return Array.from(_tools.values());
}

function get(name) {
    return _tools.get(name);
}

/**
 * OpenAI function-calling schema for every registered tool.
 * Suitable to pass directly as `tools` in a chat.completions call.
 */
function toolSchemasForLlm() {
    return list().map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters || { type: 'object', properties: {} },
        },
    }));
}

/**
 * Execute a tool by name. Always returns { ok, result?, error?, mode, durationMs }.
 * Never throws.
 */
async function executeTool(name, args, ctx = {}) {
    const startedAt = Date.now();
    const tool = _tools.get(name);
    if (!tool) {
        return { ok: false, error: `Unknown tool: ${name}`, durationMs: 0 };
    }
    if (args && typeof args !== 'object') {
        return { ok: false, error: 'args must be an object', durationMs: 0 };
    }
    const safeArgs = args || {};

    // Permission gate
    const approval = await permissions.requestApproval(tool, safeArgs, {
        userInitiated: !!ctx.userInitiated,
    });
    if (!approval.ok) {
        const durationMs = Date.now() - startedAt;
        const record = {
            tool: name, args: safeArgs, result: approval.reason,
            exitCode: -1, durationMs, approvedBy: 'denied',
        };
        ctx.addAction?.(record).catch(() => {});
        return { ok: false, error: approval.reason, mode: approval.mode, durationMs };
    }

    const runCtx = {
        dryRun: approval.mode === 'dry-run',
        log: ctx.log || (() => {}),
        abortSignal: ctx.abortSignal,
    };

    try {
        let result;
        if (runCtx.dryRun && typeof tool.dryRun === 'function') {
            result = await tool.dryRun(safeArgs, runCtx);
        } else if (runCtx.dryRun) {
            result = { dryRun: true, would: { tool: name, args: safeArgs } };
        } else {
            result = await tool.run(safeArgs, runCtx);
        }
        const durationMs = Date.now() - startedAt;
        const record = {
            tool: name, args: safeArgs, result,
            exitCode: result && typeof result === 'object' && typeof result.exitCode === 'number' ? result.exitCode : 0,
            durationMs, approvedBy: approval.approvedBy || (approval.mode === 'allow' ? 'auto' : approval.mode),
            goalSlug: ctx.goalSlug,
        };
        ctx.addAction?.(record).catch(() => {});
        return { ok: true, result, mode: approval.mode, durationMs };
    } catch (e) {
        const durationMs = Date.now() - startedAt;
        const error = e?.message || String(e);
        ctx.addAction?.({
            tool: name, args: safeArgs, result: error,
            exitCode: 1, durationMs, approvedBy: approval.approvedBy || 'auto',
            goalSlug: ctx.goalSlug,
        }).catch(() => {});
        return { ok: false, error, mode: approval.mode, durationMs };
    }
}

module.exports = {
    register,
    list,
    get,
    toolSchemasForLlm,
    executeTool,
};
