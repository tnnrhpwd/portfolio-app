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
const events = require('../events');
const permissions = require('../permissions');
const { checkAsyncKeyState } = require('./input');

// In-memory cache: slug → skill object. Populated by the compile-and-save
// route, so newly-created skills are runnable immediately without a round
// trip to the backend.
const _localCache = new Map();

// Lazily-constructed shared LLM client for the repair fallback. Mirrors the
// pattern in agent-loop.js so a step that fails can ask the model to amend its
// arguments against a fresh UI snapshot.
let _sharedLlm = null;

// Deterministic compatibility downgrades for skills authored against older/
// alternate tool names. These are intentionally static (no LLM required).
const TOOL_ALIASES = Object.freeze({
    click_visual: 'find_and_click_visual',
    vision_click: 'find_and_click_visual',
    app_open: 'open_app',
    open_application: 'open_app',
    type: 'text_type',
    say_text: 'audio_speak',
});

const TOOL_FALLBACKS = Object.freeze({
    uia_invoke: 'find_and_click_visual',
});

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
        // Routed through the §7.1 provider seam (llm-provider.js) instead of
        // instantiating GitHubModelsService directly — same returned shape
        // (`.setToken`/`.chat`), so the token-resolution logic below is unchanged.
        const { createLlmProvider } = require('../llm-provider');
        const client = createLlmProvider();
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

function _hasTool(name) {
    if (typeof registry.get !== 'function') return true;
    return !!registry.get(name);
}

function _sleep(ms) {
    const delay = Math.max(0, Number(ms) || 0);
    if (delay <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, delay));
}

function _resolveToolCompatibility(toolName) {
    const originalTool = String(toolName || '').trim();
    if (!originalTool) {
        return { status: 'unsupported', originalTool, resolvedTool: null, reason: 'step tool is missing' };
    }
    if (_hasTool(originalTool)) {
        return { status: 'compatible', originalTool, resolvedTool: originalTool };
    }
    const alias = TOOL_ALIASES[originalTool];
    if (alias && _hasTool(alias)) {
        return {
            status: 'degraded',
            originalTool,
            resolvedTool: alias,
            reason: `tool "${originalTool}" mapped to "${alias}"`,
        };
    }
    const fallback = TOOL_FALLBACKS[originalTool];
    if (fallback && _hasTool(fallback)) {
        return {
            status: 'degraded',
            originalTool,
            resolvedTool: fallback,
            reason: `tool "${originalTool}" fell back to "${fallback}"`,
        };
    }
    return {
        status: 'unsupported',
        originalTool,
        resolvedTool: originalTool,
        reason: `tool "${originalTool}" is not available on this addon version`,
    };
}

function _collectCompatibilityFindings(steps, out, pathPrefix = '') {
    for (let i = 0; i < (steps || []).length; i++) {
        const step = steps[i];
        const at = pathPrefix ? `${pathPrefix}.${i}` : String(i);
        const normalised = _normaliseStep(step);
        if (!normalised) {
            out.push({
                path: at,
                status: 'unsupported',
                originalTool: step?.tool || step?.type || 'unknown',
                resolvedTool: null,
                reason: `unknown step type: ${step?.type || step?.tool || 'unknown'}`,
            });
            continue;
        }
        if (normalised._controlFlow) {
            if (Array.isArray(normalised.body)) _collectCompatibilityFindings(normalised.body, out, `${at}.body`);
            continue;
        }
        if (normalised.tool === '_marker') continue;
        out.push({ path: at, ..._resolveToolCompatibility(normalised.tool) });
    }
}

function analyzeSkillCompatibility(skill) {
    if (!skill || !Array.isArray(skill.steps)) {
        throw new Error('analyzeSkillCompatibility: invalid skill (expected .steps array)');
    }
    const findings = [];
    _collectCompatibilityFindings(skill.steps, findings);
    const compatibleCount = findings.filter(f => f.status === 'compatible').length;
    const degradedCount = findings.filter(f => f.status === 'degraded').length;
    const unsupportedCount = findings.filter(f => f.status === 'unsupported').length;
    return {
        compatibleCount,
        degradedCount,
        unsupportedCount,
        hasUnsupported: unsupportedCount > 0,
        findings,
    };
}

function _deriveVisualQuery(step, resolvedArgs) {
    if (!step || !step.tool) return null;
    if (step.tool === 'uia_invoke') {
        const parts = [resolvedArgs?.name, resolvedArgs?.automationId, resolvedArgs?.controlType]
            .map(v => String(v || '').trim())
            .filter(Boolean);
        return parts.length ? parts.join(' ') : null;
    }
    if (step.tool === 'click_at') {
        return 'the same target that was expected at this click location';
    }
    return null;
}

async function _attemptVisualRetarget({ step, resolvedArgs, error, ctx }) {
    const description = _deriveVisualQuery(step, resolvedArgs);
    if (!description) {
        return { attempted: false };
    }
    events.publish('skill.repair.attempt', {
        strategy: 'visual-retarget',
        tool: step.tool,
        error: String(error || '').slice(0, 200),
    });
    try {
        const out = await registry.executeTool('find_and_click_visual', { description }, ctx);
        const ok = !out?.error;
        if (ok) {
            events.publish('skill.repair.success', { strategy: 'visual-retarget', tool: step.tool });
            return {
                attempted: true,
                ok: true,
                attempt: {
                    ok: true,
                    result: out,
                    error: undefined,
                    tool: 'find_and_click_visual',
                    compatibility: {
                        status: 'degraded',
                        originalTool: step.tool,
                        resolvedTool: 'find_and_click_visual',
                        reason: 'visual retarget fallback',
                    },
                },
                repairRecord: {
                    strategy: 'visual-retarget',
                    action: 'retry',
                    tool: 'find_and_click_visual',
                    query: description,
                    ok: true,
                    provenance: {
                        originalTool: step.tool,
                        originalArgs: resolvedArgs,
                        originalError: String(error || ''),
                    },
                },
            };
        }
        events.publish('skill.repair.failed', {
            strategy: 'visual-retarget',
            tool: step.tool,
            error: String(out?.error || 'visual retarget failed'),
        });
        return {
            attempted: true,
            ok: false,
            error: out?.error || 'visual retarget failed',
            repairRecord: {
                strategy: 'visual-retarget',
                action: 'none',
                reason: out?.error || 'visual retarget failed',
                query: description,
                provenance: {
                    originalTool: step.tool,
                    originalArgs: resolvedArgs,
                    originalError: String(error || ''),
                },
            },
        };
    } catch (e) {
        events.publish('skill.repair.failed', {
            strategy: 'visual-retarget',
            tool: step.tool,
            error: String(e.message || e),
        });
        return {
            attempted: true,
            ok: false,
            error: e.message,
            repairRecord: {
                strategy: 'visual-retarget',
                action: 'none',
                reason: e.message,
                query: description,
                provenance: {
                    originalTool: step.tool,
                    originalArgs: resolvedArgs,
                    originalError: String(error || ''),
                },
            },
        };
    }
}

async function _evaluateSuccessCriteria(skill, summary, ctx) {
    const criteria = skill?.successCriteria;
    if (!criteria) {
        return { status: 'indeterminate', success: null, reasonCode: 'NO_CRITERIA', detail: 'skill has no successCriteria' };
    }
    if (summary.failed) {
        return { status: 'failed', success: false, reasonCode: 'STEP_FAILED', detail: 'one or more steps failed' };
    }
    if (typeof criteria === 'string') {
        return {
            status: 'indeterminate',
            success: null,
            reasonCode: 'STRING_CRITERIA_UNCHECKABLE',
            detail: criteria.slice(0, 500),
        };
    }
    if (typeof criteria !== 'object') {
        return { status: 'indeterminate', success: null, reasonCode: 'INVALID_CRITERIA', detail: 'criteria must be an object' };
    }
    if (criteria.type === 'step_ok') {
        const index = Number(criteria.index);
        if (!Number.isInteger(index) || index < 0) {
            return { status: 'indeterminate', success: null, reasonCode: 'INVALID_STEP_INDEX', detail: 'step_ok requires non-negative integer index' };
        }
        const step = summary.steps[index];
        if (!step) return { status: 'failed', success: false, reasonCode: 'STEP_MISSING', detail: `step ${index} not found` };
        if (step.ok) return { status: 'passed', success: true, reasonCode: 'STEP_OK', detail: `step ${index} succeeded` };
        return { status: 'failed', success: false, reasonCode: 'STEP_NOT_OK', detail: `step ${index} failed` };
    }
    if (criteria.type === 'tool_succeeded') {
        const tool = String(criteria.tool || '').trim();
        if (!tool) {
            return { status: 'indeterminate', success: null, reasonCode: 'INVALID_TOOL', detail: 'tool_succeeded requires tool name' };
        }
        const ok = summary.steps.some(s => s && s.ok && s.tool === tool);
        return ok
            ? { status: 'passed', success: true, reasonCode: 'TOOL_SEEN_OK', detail: `tool ${tool} succeeded` }
            : { status: 'failed', success: false, reasonCode: 'TOOL_NOT_SEEN_OK', detail: `tool ${tool} did not succeed` };
    }
    if (criteria.type === 'clipboard_contains') {
        const text = String(criteria.text || '');
        if (!text) {
            return { status: 'indeterminate', success: null, reasonCode: 'INVALID_CLIPBOARD_TEXT', detail: 'clipboard_contains requires text' };
        }
        try {
            const clip = await registry.executeTool('clipboard_read', {}, ctx);
            const clipText = String(clip?.result?.text || clip?.result || '');
            const ok = clipText.toLowerCase().includes(text.toLowerCase());
            return ok
                ? { status: 'passed', success: true, reasonCode: 'CLIPBOARD_MATCH', detail: 'clipboard contains expected text' }
                : { status: 'failed', success: false, reasonCode: 'CLIPBOARD_MISMATCH', detail: 'clipboard does not contain expected text' };
        } catch (e) {
            return { status: 'indeterminate', success: null, reasonCode: 'CLIPBOARD_CHECK_ERROR', detail: e.message };
        }
    }
    if (criteria.type === 'window_focused') {
        const titleIncludes = String(criteria.titleIncludes || '').trim();
        if (!titleIncludes) {
            return { status: 'indeterminate', success: null, reasonCode: 'INVALID_WINDOW_MATCH', detail: 'window_focused requires titleIncludes' };
        }
        try {
            const list = await registry.executeTool('window_list', { onlyVisible: true, max: 50 }, ctx);
            const windows = Array.isArray(list?.result?.windows) ? list.result.windows : [];
            const active = windows.find(w => w && w.isForeground);
            const activeTitle = String(active?.title || '');
            const ok = activeTitle.toLowerCase().includes(titleIncludes.toLowerCase());
            return ok
                ? { status: 'passed', success: true, reasonCode: 'WINDOW_MATCH', detail: `foreground window matched "${titleIncludes}"` }
                : { status: 'failed', success: false, reasonCode: 'WINDOW_MISMATCH', detail: `foreground window did not match "${titleIncludes}"` };
        } catch (e) {
            return { status: 'indeterminate', success: null, reasonCode: 'WINDOW_CHECK_ERROR', detail: e.message };
        }
    }
    return {
        status: 'indeterminate',
        success: null,
        reasonCode: 'UNSUPPORTED_CRITERIA_TYPE',
        detail: `unsupported successCriteria type: ${String(criteria.type || '')}`,
    };
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
const _MOUSE_PHRASE_RE = /^(?:((?:left|right|middle))(?:[\s_-]+(?:mouse(?:[\s_-]*(?:button|click))?|button|click))(?:[\s_-]+(?:down|up|hold|held|press|pressed))?|((?:lmb|rmb|mmb)))$/i;
function _splitKeysAndButtons(keys, existingButtons) {
    const buttons = new Set((existingButtons || []).map(b => String(b).toLowerCase()));
    const realKeys = [];
    for (const k of (keys || [])) {
        const raw = String(k).trim().replace(/^["']|["']$/g, '');
        const m = _MOUSE_PHRASE_RE.exec(raw);
        if (m) {
            const matched = (m[1] || m[2] || '').toLowerCase();
            const btn = matched === 'lmb' ? 'left' : matched === 'rmb' ? 'right' : matched === 'mmb' ? 'middle' : matched;
            if (btn) buttons.add(btn);
        }
        else realKeys.push(k);
    }
    return { keys: realKeys, mouseButtons: Array.from(buttons) };
}

// Steps that act on a specific application window (taps, holds, typing) but
// don't repeat `focusWindowTitle` on every single step of a macro will drift
// onto whatever window the OS decides is foreground by the time they run —
// e.g. the terminal/editor that launched the macro, a loading-screen focus
// hiccup, etc. That's the root cause behind "Escape doesn't unpause the
// game" and "the mouse click doesn't register in the game at all" (a click
// sent while some other window is focused just clicks that other window,
// which looks like nothing happened, or like a stray single click). Carry
// the most recently established target window (from `open_app.windowTitleContains`
// or any step's explicit `focusWindowTitle`) forward as the default for
// every subsequent window-targeted step that doesn't set its own, so a
// macro only has to name its target window once.
function _defaultFocusTitle(step, focusCtx) {
    return step.focusWindowTitle || (focusCtx && focusCtx.title) || undefined;
}

// Update the shared sticky-focus holder from a raw (un-normalised) step,
// BEFORE that step is normalised/executed, so its own effect is visible to
// itself too (e.g. an `open_app` step's `windowTitleContains` becomes the
// default focus target starting with that very step's own execution).
function _updateFocusCtx(step, focusCtx) {
    if (!focusCtx || !step) return;
    const t = step.type || step.tool;
    if (t === 'open_app' && step.windowTitleContains) {
        focusCtx.title = step.windowTitleContains;
    } else if (step.focusWindowTitle) {
        focusCtx.title = step.focusWindowTitle;
    }
}

function _normaliseStep(step, focusCtx) {
    // Already a legacy recorded-skill step (has `tool` field)
    if (step.tool && !step.type) return { tool: step.tool, args: step.args || {} };
    // Some steps have both — prefer `type` when present (NL compiled)
    const t = step.type || step.tool;
    switch (t) {
        case 'key_tap': {
            const { keys, mouseButtons } = _splitKeysAndButtons(step.keys, step.mouseButtons);
            return { tool: 'input_tap', args: { keys, mouseButtons, repeat: step.repeat || 1, focusWindowTitle: _defaultFocusTitle(step, focusCtx) } };
        }
        case 'key_hold': {
            const { keys, mouseButtons } = _splitKeysAndButtons(step.keys, step.mouseButtons);
            return { tool: 'input_hold', args: { keys, mouseButtons, durationMs: step.duration_ms || 500, focusWindowTitle: _defaultFocusTitle(step, focusCtx) } };
        }
        case 'type_text':
            return { tool: 'text_type', args: { text: step.text, focusWindowTitle: _defaultFocusTitle(step, focusCtx), pressEnterAfter: step.pressEnterAfter } };
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

function _resolveLoopVirtualKey(keyName) {
    const name = String(keyName || 'Escape').trim();
    const map = {
        Escape: 27,
        Space: 32,
        Enter: 13,
        Tab: 9,
        Backspace: 8,
        Delete: 46,
        Insert: 45,
        Home: 36,
        End: 35,
        PageUp: 33,
        PageDown: 34,
        Left: 37,
        Up: 38,
        Right: 39,
        Down: 40,
        F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
        F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
    };
    if (map[name] !== undefined) return map[name];
    if (name.length === 1) {
        const c = name.toUpperCase().charCodeAt(0);
        if (c >= 65 && c <= 90) return c;
        if (c >= 48 && c <= 57) return c;
    }
    return 27;
}

function _coalesceLoopHoldSteps(body, focusCtx) {
    const out = [];
    for (let i = 0; i < (body || []).length; i++) {
        const a = _normaliseStep(body[i], focusCtx);
        const b = i + 1 < (body || []).length ? _normaliseStep(body[i + 1], focusCtx) : null;
        if (
            a && b &&
            !a._controlFlow && !b._controlFlow &&
            a.tool === 'input_hold' && b.tool === 'input_hold'
        ) {
            const da = Math.max(50, a.args?.durationMs || 500);
            const db = Math.max(50, b.args?.durationMs || 500);
            const sameDuration = da === db;
            const sameFocus = String(a.args?.focusWindowTitle || '') === String(b.args?.focusWindowTitle || '');
            const sameFgRule = !!a.args?.requireForeground === !!b.args?.requireForeground;
            if (sameDuration && sameFocus && sameFgRule) {
                const merged = {
                    tool: 'input_hold',
                    args: {
                        durationMs: da,
                        focusWindowTitle: a.args?.focusWindowTitle || b.args?.focusWindowTitle,
                        requireForeground: !!a.args?.requireForeground,
                        keys: Array.from(new Set([...(a.args?.keys || []), ...(b.args?.keys || [])])),
                        mouseButtons: Array.from(new Set([...(a.args?.mouseButtons || []), ...(b.args?.mouseButtons || [])])),
                    },
                };
                out.push(merged);
                i++;
                continue;
            }
        }
        if (a) out.push(a);
    }
    return out;
}

/**
 * Execute a control-flow step (loop or screenshot check).
 */
async function _execControlFlow(cf, { params, stepDelay, continueOnError, repairEnabled, maxRepairs, ctx, skill, focusCtx }) {
    if (cf.type === 'screenshot_check') {
        if (!permissions.hasCloudVisionConsent()) {
            return {
                tool: 'screenshot_check',
                ok: false,
                error: 'Cloud vision consent required before screenshot_check can send frames to the model.',
                consentRequired: 'cloudVision.granted',
            };
        }
        try {
            const screenOut = await registry.executeTool('screen_capture', { returnInline: true }, ctx);
            if (!screenOut?.ok) return { tool: 'screenshot_check', ok: true, skipped: 'screen capture failed', condition: cf.condition };
            // Use vision description to check condition
            const { createLlmProvider } = require('../llm-provider');
            const llm = _resolveLlm(ctx) || createLlmProvider();
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
                _updateFocusCtx(bodyStep, focusCtx);
                const n = _normaliseStep(bodyStep, focusCtx);
                if (!n) continue;
                if (n._controlFlow) continue; // no nested loops
                let ra = {};
                try { ra = substituteArgs(n.args || {}, params); } catch {}
                const out = await _execToolStep(n.tool, ra, ctx);
                allResults.push({
                    iteration: i,
                    tool: out.tool || n.tool,
                    ok: out.ok,
                    error: out.error,
                    compatibility: out.compatibility,
                });
                if (!out.ok && !continueOnError) { failed = true; break; }
                if (stepDelay > 0) await new Promise(r => setTimeout(r, stepDelay));
            }
            if (failed) break;
        }
        return { tool: 'loop_n_times', times: cf.times, ok: !failed, iterations: allResults.length, steps: allResults };
    }

    if (cf.type === 'loop_until_key') {
        // On Windows, poll key state with GetAsyncKeyState(vk). This avoids
        // console-dependent checks that are unreliable for background automation.
        const allResults = [];
        let iteration = 0;
        let failed = false;
        let stoppedByKey = false;
        const MAX_ITER = cf.maxIterations || 10000;
        const keyName = cf.key || 'Escape';
        const vk = _resolveLoopVirtualKey(keyName);
        // Poll the stop key directly via input.js's checkAsyncKeyState instead
        // of going through registry.executeTool('shell_run', ...). Checking
        // whether the loop's OWN declared stop key is pressed is not a new
        // user-facing action -- it's just re-reading the exact key the skill
        // author already named as this loop's stop condition -- so it must
        // never be blockable by the shell/system permission gate. Routing it
        // through the gated shell_run tool meant a permission denial or
        // revocation mid-run (e.g. the user's 'shell' category flipping to
        // 'ask'/'deny') made every poll silently resolve to "not pressed",
        // so Escape could never stop the loop -- exactly the "pressing
        // Escape doesn't end the loop" bug reports.
        const checkKey = async () => {
            try {
                return await checkAsyncKeyState(vk);
            } catch { return false; }
        };
        // input_hold already polls GetAsyncKeyState(VK_ESCAPE) internally
        // every ~50ms for the *entire* duration of its own hold and reports
        // `reason: "escape-pressed"` the instant it sees it — that is far
        // lower-latency than a fresh checkKey() poll, which spawns a whole
        // new PowerShell process (hundreds of ms) and can only observe the
        // key state at the single instant it happens to run. Re-polling
        // between every body step also released the held keys/mouse button
        // for that whole round-trip, which is what made a continuous hold
        // look like a stutter of separate single clicks. When the loop's
        // stop key is Escape, trust the hold's own signal instead of
        // re-checking; only fall back to checkKey() at the top of each
        // iteration (for non-hold bodies, and to catch a tap that happens
        // between iterations).
        const trustHoldEscapeSignal = vk === 0x1B;

        const coalescedBody = _coalesceLoopHoldSteps(cf.body || [], focusCtx);
        while (iteration < MAX_ITER) {
            const pressed = await checkKey();
            if (pressed) { stoppedByKey = true; break; }
            for (const n of coalescedBody) {
                if (!n || n._controlFlow) continue;
                // Skip the extra poll immediately before an input_hold step —
                // that hold will detect Escape itself (see above), and an
                // extra round-trip here would just reintroduce the gap
                // between held actions that caused the stutter. Non-hold
                // steps (taps, waits, etc.) keep the eager poll so a stop
                // request is still honoured promptly between quick actions.
                const skipPreCheck = trustHoldEscapeSignal && n.tool === 'input_hold';
                if (!skipPreCheck) {
                    const stepPressed = await checkKey();
                    if (stepPressed) { stoppedByKey = true; break; }
                }
                let ra = {};
                try { ra = substituteArgs(n.args || {}, params); } catch {}
                const out = await _execToolStep(n.tool, ra, ctx);
                allResults.push({
                    iteration,
                    tool: out.tool || n.tool,
                    ok: out.ok,
                    error: out.error,
                    compatibility: out.compatibility,
                });
                if (trustHoldEscapeSignal && out.tool === 'input_hold' && out.result?.result?.reason === 'escape-pressed') {
                    stoppedByKey = true;
                    break;
                }
                if (!out.ok && !continueOnError) { failed = true; break; }
                if (stepDelay > 0) await new Promise(r => setTimeout(r, stepDelay));
            }
            if (failed || stoppedByKey) break;
            iteration++;
        }

        return { tool: 'loop_until_key', key: keyName, ok: !failed, iterations: iteration, stoppedByKey, steps: allResults };
    }

    return { tool: cf.type, ok: false, error: 'unhandled control-flow type' };
}

async function _execToolStep(tool, stepArgs, ctx) {
    const compatibility = _resolveToolCompatibility(tool);
    if (compatibility.status === 'unsupported') {
        return { ok: false, result: undefined, error: compatibility.reason, compatibility, tool };
    }
    try {
        const out = await registry.executeTool(compatibility.resolvedTool, stepArgs, ctx);
        const ok = !out?.error;
        return {
            ok,
            result: out,
            error: ok ? undefined : (out.error || 'tool returned error'),
            compatibility,
            tool: compatibility.resolvedTool,
        };
    } catch (e) {
        return {
            ok: false,
            result: undefined,
            error: e.message,
            compatibility,
            tool: compatibility.resolvedTool,
        };
    }
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
            repairBackoffMs: {
                type: 'integer',
                description: 'Backoff delay (ms) between repair attempts. Default 200.',
            },
            maxCriteriaRepairs: {
                type: 'integer',
                description: 'Max repair attempts triggered when all steps succeed but successCriteria still fails ' +
                             '(§5.6). Default 1. Set to 0 to disable this repair path (per-step repair on tool ' +
                             'errors, controlled by maxRepairs, is unaffected).',
            },
            allowUnsupported: {
                type: 'boolean',
                description: 'If false (default), block run when any step resolves as unsupported on this addon version.',
            },
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
        const repairBackoffMs = Math.max(0, args.repairBackoffMs ?? 200);
        const maxCriteriaRepairs = Math.max(0, args.maxCriteriaRepairs ?? 1);
        const allowUnsupported = !!args.allowUnsupported;
        const results = [];
        let failed = false;
        let repairsTotal = 0;
        const compatibility = analyzeSkillCompatibility(skill);
        // Sticky target-window tracker shared across this run and any nested
        // loop bodies. `open_app.windowTitleContains` (or any step's explicit
        // `focusWindowTitle`) becomes the default for every subsequent
        // window-targeted step (key_tap/key_hold/type_text) that doesn't name
        // its own — see `_defaultFocusTitle` for why this matters.
        const focusCtx = { title: null };

        if (compatibility.hasUnsupported && !allowUnsupported) {
            const blocked = compatibility.findings.filter(f => f.status === 'unsupported');
            const short = blocked.slice(0, 3).map(f => `${f.path}: ${f.reason}`).join('; ');
            throw new Error(
                `skill has ${blocked.length} unsupported step(s); ` +
                `set allowUnsupported=true to run partial execution. ${short}`
            );
        }

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
            _updateFocusCtx(step, focusCtx);
            const normalised = _normaliseStep(step, focusCtx);
            if (!normalised) {
                results.push({ index: i, tool: step.type || step.tool, args: step, ok: false, error: `unknown step type: ${step.type}` });
                if (!continueOnError) { failed = true; break; }
                failed = true;
                continue;
            }

            // Control-flow steps (loops) are handled recursively, not via the registry.
            if (normalised._controlFlow) {
                const cfResult = await _execControlFlow(normalised, { params, stepDelay, continueOnError, repairEnabled, maxRepairs, ctx, skill, focusCtx });
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

            let attempt = await _execToolStep(normalised.tool, resolvedArgs, ctx);
            const repairs = [];

            // LLM repair fallback: on failure, ask the model to amend args and retry.
            let usedArgs = resolvedArgs;
            let repairCount = 0;
            while (!attempt.ok && repairEnabled && repairCount < maxRepairs) {
                repairCount++;
                events.publish('skill.repair.attempt', {
                    strategy: 'llm-amend',
                    tool: normalised.tool,
                    attempt: repairCount,
                    error: String(attempt.error || '').slice(0, 200),
                });
                const visual = await _attemptVisualRetarget({
                    step: normalised,
                    resolvedArgs: usedArgs,
                    error: attempt.error,
                    ctx,
                });
                if (visual.attempted) {
                    repairs.push({
                        attempt: repairCount,
                        strategy: visual.repairRecord.strategy,
                        action: visual.repairRecord.action,
                        tool: visual.repairRecord.tool,
                        query: visual.repairRecord.query,
                        ok: !!visual.ok,
                        reason: visual.error,
                        provenance: visual.repairRecord.provenance,
                    });
                    if (visual.ok && visual.attempt) {
                        repairsTotal++;
                        attempt = visual.attempt;
                        break;
                    }
                }
                if (repairBackoffMs > 0) {
                    await _sleep(repairBackoffMs * repairCount);
                }
                let decision = null;
                try {
                    decision = await repairStep({ skill, step: normalised, resolvedArgs: usedArgs, error: attempt.error, ctx });
                } catch { decision = null; }

                if (!decision || decision.action !== 'retry') {
                    events.publish('skill.repair.failed', {
                        strategy: 'llm-amend',
                        tool: normalised.tool,
                        attempt: repairCount,
                        reason: String(decision?.reason || 'model declined or produced no repair'),
                    });
                    repairs.push({
                        attempt: repairCount,
                        strategy: 'llm-amend',
                        action: decision?.action || 'none',
                        reason: decision?.reason,
                        provenance: {
                            originalTool: normalised.tool,
                            originalArgs: usedArgs,
                            originalError: String(attempt.error || ''),
                        },
                    });
                    break;
                }
                repairsTotal++;
                usedArgs = decision.args;
                const retried = await _execToolStep(normalised.tool, usedArgs, ctx);
                if (retried.ok) {
                    events.publish('skill.repair.success', {
                        strategy: 'llm-amend',
                        tool: normalised.tool,
                        attempt: repairCount,
                    });
                } else {
                    events.publish('skill.repair.failed', {
                        strategy: 'llm-amend',
                        tool: normalised.tool,
                        attempt: repairCount,
                        reason: String(retried.error || 'retry failed'),
                    });
                }
                repairs.push({
                    attempt: repairCount,
                    strategy: 'llm-amend',
                    action: 'retry',
                    args: usedArgs,
                    ok: retried.ok,
                    error: retried.error,
                    provenance: {
                        originalTool: normalised.tool,
                        originalArgs: resolvedArgs,
                        originalError: String(attempt.error || ''),
                    },
                });
                attempt = retried;
            }

            results.push({
                index: i,
                tool: attempt.tool || normalised.tool,
                args: usedArgs,
                ok: attempt.ok,
                result: attempt.result,
                error: attempt.ok ? undefined : attempt.error,
                compatibility: attempt.compatibility,
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
            compatibility,
            steps: results,
        };
        const allStepsOk = !failed;
        let outcome = await _evaluateSuccessCriteria(skill, summary, ctx);
        summary.outcome = outcome;
        if (outcome.status === 'failed') {
            summary.failed = true;
        }

        // ── successCriteria-triggered repair (§5.6) ──────────────────────
        // Every step reported ok, but the end-state check still failed —
        // e.g. a click landed on the wrong control, or the UI moved after
        // the last action. Distinct from the per-step repair loop above
        // (which only fires on a hard tool-execution error): here we retry
        // the LAST executed step via the same LLM repair fallback, telling
        // it *why* (the failed criteria), then re-check the criteria. Only
        // engages when the retry budget remains and no step already failed
        // (a step failure already got its own repair attempts above).
        let criteriaRepairsAttempted = 0;
        if (allStepsOk && outcome.status === 'failed' && repairEnabled && maxCriteriaRepairs > 0 && results.length > 0) {
            while (criteriaRepairsAttempted < maxCriteriaRepairs && outcome.status === 'failed') {
                const lastResult = [...results].reverse().find(r => r && r.tool !== '_marker' && r.ok);
                if (!lastResult) break;

                criteriaRepairsAttempted++;
                const criteriaError = `successCriteria failed: ${outcome.reasonCode} — ${outcome.detail}`;
                events.publish('skill.repair.attempt', {
                    strategy: 'criteria-retry',
                    tool: lastResult.tool,
                    attempt: criteriaRepairsAttempted,
                    error: criteriaError.slice(0, 200),
                });

                let decision = null;
                try {
                    decision = await repairStep({
                        skill,
                        step: { tool: lastResult.tool, args: lastResult.args },
                        resolvedArgs: lastResult.args,
                        error: criteriaError,
                        ctx,
                    });
                } catch { decision = null; }

                if (!decision || decision.action !== 'retry') {
                    events.publish('skill.repair.failed', {
                        strategy: 'criteria-retry',
                        tool: lastResult.tool,
                        attempt: criteriaRepairsAttempted,
                        reason: String(decision?.reason || 'model declined or produced no repair'),
                    });
                    lastResult.repairs = lastResult.repairs || [];
                    lastResult.repairs.push({
                        attempt: criteriaRepairsAttempted,
                        strategy: 'criteria-retry',
                        action: decision?.action || 'none',
                        reason: decision?.reason,
                        provenance: { originalTool: lastResult.tool, originalArgs: lastResult.args, originalError: criteriaError },
                    });
                    break;
                }

                repairsTotal++;
                const retried = await _execToolStep(lastResult.tool, decision.args, ctx);
                lastResult.repairs = lastResult.repairs || [];
                lastResult.repairs.push({
                    attempt: criteriaRepairsAttempted,
                    strategy: 'criteria-retry',
                    action: 'retry',
                    args: decision.args,
                    ok: retried.ok,
                    error: retried.error,
                    provenance: { originalTool: lastResult.tool, originalArgs: lastResult.args, originalError: criteriaError },
                });

                if (retried.ok) {
                    events.publish('skill.repair.success', { strategy: 'criteria-retry', tool: lastResult.tool, attempt: criteriaRepairsAttempted });
                    lastResult.args = decision.args;
                    lastResult.result = retried.result;
                    lastResult.ok = true;
                    lastResult.error = undefined;
                    summary.failed = false; // re-open the criteria check instead of short-circuiting to STEP_FAILED
                    outcome = await _evaluateSuccessCriteria(skill, summary, ctx);
                    summary.outcome = outcome;
                    if (outcome.status === 'failed') summary.failed = true;
                } else {
                    events.publish('skill.repair.failed', {
                        strategy: 'criteria-retry',
                        tool: lastResult.tool,
                        attempt: criteriaRepairsAttempted,
                        reason: String(retried.error || 'retry failed'),
                    });
                    lastResult.ok = false;
                    lastResult.error = retried.error;
                    summary.failed = true;
                    outcome = await _evaluateSuccessCriteria(skill, summary, ctx);
                    summary.outcome = outcome;
                    break;
                }
            }
            summary.repairsTotal = repairsTotal;
            summary.criteriaRepairsAttempted = criteriaRepairsAttempted;
        }
        try {
            ctx?.addAction?.({
                tool: 'skill_run',
                args,
                result: {
                    slug: skill.slug,
                    stepsRun: results.length,
                    repairsTotal,
                    failed: summary.failed,
                    outcome,
                },
            });
        } catch {}
        return summary;
    },
};

module.exports = { skillRun, cacheSkill, getCachedSkill, loadSkill, substituteArgs,
    repairStep, _extractJsonObject, _resolveLlm, _normaliseStep, analyzeSkillCompatibility,
    getAllCachedSkills: () => Array.from(_localCache.values()),
};
