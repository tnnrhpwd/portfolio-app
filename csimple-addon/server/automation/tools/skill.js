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

/**
 * Map an NL-compiler step (type field) to a registry tool call (tool + args),
 * or flag it as a control-flow type. Returns null for unrecognised types.
 *
 * @returns {{ tool: string, args: object } | { _controlFlow: true, ... } | null}
 */
// Some older/LLM-authored key_tap / key_hold steps stuff a mouse-button phrase
// (e.g. "left mouse button", "left click", "right-click") into the `keys`
// array instead of using the dedicated `mouseButtons` field — resolveKey()
// in tools/input.js rejects those as unknown keyboard keys, so the whole
// step throws synchronously and the macro appears to "do nothing" instantly.
// Split them out here so both old and new skill JSON work.
const _MOUSE_PHRASE_RE = /^(left|right|middle)[\s_-]*(mouse)?[\s_-]*(button|click)$/i;
function _splitKeysAndButtons(keys, existingButtons) {
    const buttons = new Set((existingButtons || []).map(b => String(b).toLowerCase()));
    const realKeys = [];
    for (const k of (keys || [])) {
        const m = _MOUSE_PHRASE_RE.exec(String(k).trim());
        if (m) buttons.add(m[1].toLowerCase());
        else realKeys.push(k);
    }
    return { keys: realKeys, mouseButtons: Array.from(buttons) };
}

function _normaliseStep(step) {
    // Already a legacy recorded-skill step (has `tool` field)
    if (step.tool && !step.type) return { tool: step.tool, args: step.args || {} };
    // Some steps have both — prefer `type` when present (NL compiled)
    const t = step.type || step.tool;
    switch (t) {
        case 'key_tap': {
            const { keys, mouseButtons } = _splitKeysAndButtons(step.keys, step.mouseButtons);
            return { tool: 'input_tap', args: { keys, mouseButtons, repeat: step.repeat || 1, focusWindowTitle: step.focusWindowTitle } };
        }
        case 'key_hold': {
            const { keys, mouseButtons } = _splitKeysAndButtons(step.keys, step.mouseButtons);
            return { tool: 'input_hold', args: { keys, mouseButtons, durationMs: step.duration_ms || 500, focusWindowTitle: step.focusWindowTitle } };
        }
        case 'type_text':
            return { tool: 'text_type', args: { text: step.text, focusWindowTitle: step.focusWindowTitle, pressEnterAfter: step.pressEnterAfter } };
        case 'wait_ms':
            // No explicit wait tool — use a synthetic shell sleep
            return { tool: 'shell_run', args: { command: `Start-Sleep -Milliseconds ${Math.max(0, step.ms || 500)}`, shell: 'powershell' } };
        case 'click_at':
            return { tool: 'click_at', args: { x: step.x, y: step.y, button: step.button || 'left' } };
        case 'click_visual':
            return { tool: 'find_and_click_visual', args: { target: step.target, query: step.target } };
        case 'open_app':
            // open_app is a real registered tool (tools/open-app.js) that
            // launches the process and POLLS for its main window before
            // returning + focusing it — this is what prevents the classic
            // "launched Minecraft then immediately sent Escape/WASD to the
            // wrong window" failure mode of the old raw Start-Process alias.
            return {
                tool: 'open_app',
                args: {
                    name: step.name,
                    args: step.args,
                    windowTitleContains: step.windowTitleContains,
                    waitMs: step.waitMs,
                },
            };
        case 'shell_run':
            return { tool: 'shell_run', args: { command: step.command, shell: step.shell } };
        case 'uia_invoke':
            return { tool: 'uia_invoke', args: { name: step.name, automationId: step.automationId, controlType: step.controlType } };
        case 'skill_run':
            return { tool: 'skill_run', args: { slug: step.slug, params: step.params } };
        case 'speak':
            return { tool: 'audio_speak', args: { text: step.text, rate: step.rate, volume: step.volume } };
        case 'goal_done':
            return { tool: 'goal_update', args: { status: 'done' } };
        case 'screenshot_check':
            // Control-flow: capture screen, describe, check condition
            return { _controlFlow: true, type: 'screenshot_check', condition: step.condition, onFail: step.onFail || 'continue' };
        case 'loop_until_key':
            return { _controlFlow: true, type: 'loop_until_key', key: step.key || 'Escape', body: step.body || [], maxIterations: step.maxIterations || 10000 };
        case 'loop_n_times':
            return { _controlFlow: true, type: 'loop_n_times', times: Math.min(step.times || 1, 10000), body: step.body || [] };
        case '_marker':
            return { tool: '_marker', args: step.args || {} };
        default:
            return null;
    }
}

/**
 * Execute a control-flow step (loop or screenshot check).
 */
async function _execControlFlow(cf, { params, stepDelay, continueOnError, repairEnabled, maxRepairs, ctx, skill }) {
    if (cf.type === 'screenshot_check') {
        try {
            const screenOut = await registry.executeTool('screen_capture', { returnInline: true }, ctx);
            if (!screenOut?.ok) return { tool: 'screenshot_check', ok: true, skipped: 'screen capture failed', condition: cf.condition };
            // Use vision description to check condition
            const { GitHubModelsService } = require('../../github-models-service');
            const llm = _resolveLlm(ctx) || new GitHubModelsService();
            const resp = await llm.chat({
                model: 'openai/gpt-4o-mini',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: `Answer YES or NO only: ${cf.condition}` },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenOut.result?.base64}`, detail: 'low' } },
                    ],
                }],
                max_tokens: 10,
            });
            const answer = (resp?.choices?.[0]?.message?.content || '').trim().toUpperCase();
            const passed = answer.startsWith('YES');
            return { tool: 'screenshot_check', ok: true, condition: cf.condition, passed, answer };
        } catch (e) {
            return { tool: 'screenshot_check', ok: false, error: e.message };
        }
    }

    if (cf.type === 'loop_n_times') {
        const allResults = [];
        let failed = false;
        for (let i = 0; i < cf.times; i++) {
            for (const bodyStep of (cf.body || [])) {
                const n = _normaliseStep(bodyStep);
                if (!n) continue;
                if (n._controlFlow) continue; // no nested loops
                let ra = {};
                try { ra = substituteArgs(n.args || {}, params); } catch {}
                const out = await registry.executeTool(n.tool, ra, ctx).catch(e => ({ ok: false, error: e.message }));
                allResults.push({ iteration: i, tool: n.tool, ok: !!out?.ok, error: out?.error });
                if (!out?.ok && !continueOnError) { failed = true; break; }
                if (stepDelay > 0) await new Promise(r => setTimeout(r, stepDelay));
            }
            if (failed) break;
        }
        return { tool: 'loop_n_times', times: cf.times, ok: !failed, iterations: allResults.length, steps: allResults };
    }

    if (cf.type === 'loop_until_key') {
        // On Windows, poll a PowerShell key-state check to detect the escape key.
        // This is a best-effort implementation — accuracy depends on polling interval.
        const allResults = [];
        let iteration = 0;
        const MAX_ITER = cf.maxIterations || 10000;
        const keyName = cf.key || 'Escape';
        const PS_KEY_CODE = { Escape: 27, F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F12: 123, Space: 32 };
        const vk = PS_KEY_CODE[keyName] || 27;
        const checkKey = async () => {
            try {
                const out = await registry.executeTool('shell_run', {
                    command: `[System.Windows.Forms.Control]::IsKeyLocked([System.Windows.Forms.Keys]::None) -or ([System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::${keyName}) 2>$null) -or (([System.Console]::KeyAvailable) -and ([System.Console]::ReadKey($true).Key -eq [System.ConsoleKey]::Escape)) -or (Get-AsKeyState ${vk})`,
                    shell: 'powershell',
                    silent: true,
                }, ctx).catch(() => ({ ok: false }));
                return out?.ok && String(out?.result?.stdout || '').trim().toLowerCase() === 'true';
            } catch { return false; }
        };

        while (iteration < MAX_ITER) {
            const pressed = await checkKey();
            if (pressed) break;
            for (const bodyStep of (cf.body || [])) {
                const n = _normaliseStep(bodyStep);
                if (!n || n._controlFlow) continue;
                let ra = {};
                try { ra = substituteArgs(n.args || {}, params); } catch {}
                const out = await registry.executeTool(n.tool, ra, ctx).catch(e => ({ ok: false, error: e.message }));
                allResults.push({ iteration, tool: n.tool, ok: !!out?.ok });
                if (stepDelay > 0) await new Promise(r => setTimeout(r, stepDelay));
            }
            iteration++;
        }
        return { tool: 'loop_until_key', key: keyName, ok: true, iterations: iteration, steps: allResults };
    }

    return { tool: cf.type, ok: false, error: 'unhandled control-flow type' };
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

            // ── NL-compiled step type normalisation ──────────────────────────
            // The NL compiler emits steps with a `type` field (e.g. `key_tap`,
            // `loop_until_key`, `speak`) rather than a `tool` field. Map these
            // to tool names or handle them natively (for control-flow types).
            const normalised = _normaliseStep(step);
            if (!normalised) {
                results.push({ index: i, tool: step.type || step.tool, args: step, ok: false, error: `unknown step type: ${step.type}` });
                if (!continueOnError) { failed = true; break; }
                failed = true;
                continue;
            }

            // Control-flow steps (loops) are handled recursively, not via the registry.
            if (normalised._controlFlow) {
                const cfResult = await _execControlFlow(normalised, { params, stepDelay, continueOnError, repairEnabled, maxRepairs, ctx, skill });
                results.push({ index: i, ...cfResult });
                if (!cfResult.ok) { failed = true; if (!continueOnError) break; }
                continue;
            }

            let resolvedArgs;
            try {
                resolvedArgs = substituteArgs(normalised.args || {}, params);
            } catch (e) {
                failed = true;
                results.push({ index: i, tool: normalised.tool, args: normalised.args, ok: false, error: e.message });
                if (!continueOnError) break;
                continue;
            }

            let attempt = await execStep(normalised.tool, resolvedArgs);
            const repairs = [];

            // LLM repair fallback: on failure, ask the model to amend args and retry.
            let usedArgs = resolvedArgs;
            let repairCount = 0;
            while (!attempt.ok && repairEnabled && repairCount < maxRepairs) {
                repairCount++;
                let decision = null;
                try {
                    decision = await repairStep({ skill, step: normalised, resolvedArgs: usedArgs, error: attempt.error, ctx });
                } catch { decision = null; }

                if (!decision || decision.action !== 'retry') {
                    repairs.push({ attempt: repairCount, action: decision?.action || 'none', reason: decision?.reason });
                    break;
                }
                repairsTotal++;
                usedArgs = decision.args;
                const retried = await execStep(normalised.tool, usedArgs);
                repairs.push({ attempt: repairCount, action: 'retry', args: usedArgs, ok: retried.ok, error: retried.error });
                attempt = retried;
            }

            results.push({
                index: i,
                tool: normalised.tool,
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
    repairStep, _extractJsonObject, _resolveLlm, _normaliseStep,
    getAllCachedSkills: () => Array.from(_localCache.values()),
};
