/**
 * skill_run — execute a previously-recorded-and-compiled skill by slug.
 *
 * Lookup order:
 *   1. Local cache (in-memory, populated by compile/save endpoints)
 *   2. Workspace API (kind='skill', slug=<slug>) — content is the compiled JSON
 *
 * Each step:
 *   { tool: '<registered tool name>', args: { ... } }
 *
 * Args support template substitution: any string value matching
 *   ${param.<name>}
 * is replaced with the corresponding entry from the caller's `params` arg.
 * Missing params raise an error (no silent undefined).
 *
 * Execution stops on the first failing step unless `continueOnError: true`.
 * Returns:
 *   { skill, steps: [ { tool, args, ok, error?, result? } ], failed }
 */

const path = require('path');

const registry = require('../tool-registry');
const wsClient = require('../workspace-client');

// In-memory cache: slug → skill object. Populated by the compile-and-save
// route, so newly-created skills are runnable immediately without a round
// trip to the backend.
const _localCache = new Map();

// Lazily-constructed shared LLM client for the repair fallback. Mirrors the
// pattern in agent-loop.js so a step that fails can ask the model to amend its
// arguments against a fresh UI snapshot.
let _sharedLlm = null;

function cacheSkill(skill) {
    if (!skill || !skill.slug) throw new Error('cacheSkill requires .slug');
    _localCache.set(skill.slug, skill);
}

function getCachedSkill(slug) {
    return _localCache.get(slug) || null;
}

async function loadSkill(slug) {
    const cached = _localCache.get(slug);
    if (cached) return cached;
    try {
        const item = await wsClient.getSkill(slug);
        // The workspace stores the compiled JSON as `content`.
        const content = item?.content || item?.attrs?.content;
        if (!content) throw new Error('skill workspace item has no content');
        const skill = typeof content === 'string' ? JSON.parse(content) : content;
        _localCache.set(slug, skill);
        return skill;
    } catch (e) {
        throw new Error(`skill not found: ${slug} (${e.message})`);
    }
}

function substituteArgs(args, params) {
    if (args === null || args === undefined) return args;
    if (typeof args === 'string') {
        return args.replace(/\$\{param\.([a-zA-Z0-9_]+)\}/g, (_, name) => {
            if (!(name in params)) throw new Error(`missing skill param: ${name}`);
            return String(params[name]);
        });
    }
    if (Array.isArray(args)) return args.map(v => substituteArgs(v, params));
    if (typeof args === 'object') {
        const out = {};
        for (const k of Object.keys(args)) out[k] = substituteArgs(args[k], params);
        return out;
    }
    return args;
}

/**
 * Resolve an LLM client for the repair fallback. Prefers a client injected via
 * `ctx.llm` (tests / explicit wiring); otherwise lazily constructs the addon's
 * GitHubModelsService the same way agent-loop.js does. Returns null when no
 * client can be built (repair then silently no-ops).
 */
function _resolveLlm(ctx) {
    if (ctx && ctx.llm && typeof ctx.llm.chat === 'function') return ctx.llm;
    if (_sharedLlm) return _sharedLlm;
    try {
        const { GitHubModelsService } = require('../../github-models-service');
        const client = new GitHubModelsService();
        try {
            const fs = require('fs');
            const os = require('os');
            const cfgPath = path.join(os.homedir(), 'Documents', 'CSimple', 'Resources', 'settings.json');
            if (fs.existsSync(cfgPath)) {
                const s = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
                if (s.githubToken) client.setToken(s.githubToken);
            }
        } catch {}
        _sharedLlm = client;
        return client;
    } catch {
        return null;
    }
}

/**
 * Pull the first JSON object out of an LLM text reply, tolerating code fences
 * and surrounding prose. Returns null if nothing parseable is found.
 */
function _extractJsonObject(text) {
    if (typeof text !== 'string') return null;
    let s = text.trim();
    // Strip ```json ... ``` fences if present.
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    if (fence) s = fence[1].trim();
    // Find the first balanced {...} block.
    const start = s.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                const candidate = s.slice(start, i + 1);
                try { return JSON.parse(candidate); } catch { return null; }
            }
        }
    }
    return null;
}

/**
 * Ask the LLM to repair a failed skill step. Captures a fresh interactive UIA
 * snapshot for grounding, then asks the model to either amend the tool args or
 * abort. Best-effort: any failure (no LLM, snapshot error, unparseable reply)
 * resolves to a null/abort decision so the caller falls back to its normal
 * stop-on-fail behavior.
 *
 * @returns {Promise<{action:'retry',args:object}|{action:'abort',reason:string}|null>}
 */
async function repairStep({ skill, step, resolvedArgs, error, ctx }) {
    const llm = _resolveLlm(ctx);
    if (!llm) return null;

    // Grounding: a fresh, compact view of the current UI. Best-effort.
    let snapshot = null;
    try {
        const snap = await registry.executeTool('uia_snapshot', { mode: 'interactive', maxNodes: 120 }, ctx);
        if (snap && snap.ok) snapshot = snap.result;
    } catch { /* snapshot is optional grounding */ }

    let snapshotStr = '';
    try { snapshotStr = JSON.stringify(snapshot).slice(0, 4000); } catch { snapshotStr = 'null'; }

    const systemPrompt = [
        'You repair a single failed step of a recorded Windows UI-automation skill.',
        'A step is a call to one tool with arguments. The previous attempt failed.',
        'Using the CURRENT UI snapshot, decide whether amended arguments could make the SAME tool succeed.',
        'Only change the arguments — never change which tool is called.',
        'Reply with ONLY a JSON object, no prose:',
        '  {"action":"retry","args":{...}}   to retry the same tool with new args',
        '  {"action":"abort","reason":"..."} if no argument change can plausibly fix it',
    ].join('\n');

    const userMessage = [
        `Skill: ${skill.name || skill.slug}`,
        `Tool: ${step.tool}`,
        `Failed args: ${JSON.stringify(resolvedArgs)}`,
        `Error: ${String(error || '').slice(0, 500)}`,
        '',
        'Current UI snapshot (interactive controls):',
        snapshotStr,
    ].join('\n');

    let reply;
    try {
        reply = await llm.chat({
            message: userMessage,
            systemPrompt,
            temperature: 0,
            maxLength: 400,
        });
    } catch {
        return null;
    }

    const decision = _extractJsonObject(reply?.text || '');
    if (!decision || typeof decision !== 'object') return null;
    if (decision.action === 'retry' && decision.args && typeof decision.args === 'object') {
        return { action: 'retry', args: decision.args };
    }
    if (decision.action === 'abort') {
        return { action: 'abort', reason: String(decision.reason || 'model declined to repair') };
    }
    return null;
}

const skillRun = {
    name: 'skill_run',
    category: 'system',
    description:
        'Run a previously-recorded skill by slug. Skills are sequences of UI ' +
        'automation steps recorded with the desktop addon. Pass `params` to ' +
        'substitute ${param.name} placeholders in step arguments. Stops on the ' +
        'first failing step by default. When a step fails, the model is asked ' +
        'once (repair fallback) to amend the args against a fresh UI snapshot and retry.',
    parameters: {
        type: 'object',
        required: ['slug'],
        properties: {
            slug: { type: 'string', description: 'Skill slug (lowercase, dashes).' },
            params: { type: 'object', description: 'Key/value substitutions for ${param.x} placeholders.' },
            continueOnError: { type: 'boolean', description: 'If true, continue executing remaining steps after a failure.' },
            stepDelayMs: { type: 'integer', description: 'Delay between steps in ms. Default 150.' },
            repair: { type: 'boolean', description: 'If true (default), when a step fails ask the model to amend the args against a fresh UI snapshot and retry once.' },
            maxRepairs: { type: 'integer', description: 'Max LLM repair attempts per step. Default 1.' },
            cache: {
                type: 'object',
                description: 'Optional inline skill object to register in the local cache before lookup. ' +
                             'Useful for ephemeral / test runs where the skill is not saved to the workspace.',
            },
        },
    },
    async run(args, ctx) {
        if (!args || !args.slug) throw new Error('slug is required');
        // Allow an ephemeral skill to be supplied inline (tests, ad-hoc runs).
        if (args.cache && args.cache.slug === args.slug) {
            cacheSkill(args.cache);
        }
        const skill = await loadSkill(args.slug);
        const params = args.params || {};
        const stepDelay = Math.max(0, args.stepDelayMs ?? 150);
        const continueOnError = !!args.continueOnError;
        const repairEnabled = args.repair !== false;
        const maxRepairs = Math.max(0, args.maxRepairs ?? 1);
        const results = [];
        let failed = false;
        let repairsTotal = 0;

        // Execute one step's tool and normalize the registry envelope.
        const execStep = async (tool, stepArgs) => {
            try {
                const out = await registry.executeTool(tool, stepArgs, ctx);
                const ok = !out?.error;
                return { ok, result: out, error: ok ? undefined : (out.error || 'tool returned error') };
            } catch (e) {
                return { ok: false, result: undefined, error: e.message };
            }
        };

        for (let i = 0; i < skill.steps.length; i++) {
            const step = skill.steps[i];

            // Markers are inert; surface them for trace clarity but don't execute.
            if (step.tool === '_marker') {
                results.push({ index: i, tool: '_marker', args: step.args, ok: true, marker: true });
                continue;
            }

            let resolvedArgs;
            try {
                resolvedArgs = substituteArgs(step.args || {}, params);
            } catch (e) {
                failed = true;
                results.push({ index: i, tool: step.tool, args: step.args, ok: false, error: e.message });
                if (!continueOnError) break;
                continue;
            }

            let attempt = await execStep(step.tool, resolvedArgs);
            const repairs = [];

            // LLM repair fallback: on failure, ask the model to amend args and retry.
            let usedArgs = resolvedArgs;
            let repairCount = 0;
            while (!attempt.ok && repairEnabled && repairCount < maxRepairs) {
                repairCount++;
                let decision = null;
                try {
                    decision = await repairStep({ skill, step, resolvedArgs: usedArgs, error: attempt.error, ctx });
                } catch { decision = null; }

                if (!decision || decision.action !== 'retry') {
                    repairs.push({ attempt: repairCount, action: decision?.action || 'none', reason: decision?.reason });
                    break;
                }
                repairsTotal++;
                usedArgs = decision.args;
                const retried = await execStep(step.tool, usedArgs);
                repairs.push({ attempt: repairCount, action: 'retry', args: usedArgs, ok: retried.ok, error: retried.error });
                attempt = retried;
            }

            results.push({
                index: i,
                tool: step.tool,
                args: usedArgs,
                ok: attempt.ok,
                result: attempt.result,
                error: attempt.ok ? undefined : attempt.error,
                ...(repairs.length ? { repairs } : {}),
            });

            if (!attempt.ok) {
                failed = true;
                if (!continueOnError) break;
            }

            if (stepDelay > 0 && i < skill.steps.length - 1) {
                await new Promise(r => setTimeout(r, stepDelay));
            }
        }

        const summary = {
            slug: skill.slug,
            name: skill.name,
            stepsTotal: skill.steps.length,
            stepsRun: results.length,
            repairsTotal,
            failed,
            steps: results,
        };
        try { ctx?.addAction?.({ tool: 'skill_run', args, result: { slug: skill.slug, stepsRun: results.length, repairsTotal, failed } }); } catch {}
        return summary;
    },
};

module.exports = { skillRun, cacheSkill, getCachedSkill, loadSkill, substituteArgs,
    repairStep, _extractJsonObject, _resolveLlm,
    getAllCachedSkills: () => Array.from(_localCache.values()),
};
