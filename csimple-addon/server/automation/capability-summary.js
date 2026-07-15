/**
 * capability-summary.js — "what will this skill do" pre-run summary.
 *
 * Implements docs/new/csimple-agent-prompt.md §6.2: marketplace (and local)
 * skills must be inspectable before running. Every step already names a
 * tool call (directly, or via nl-compiler's `type` field, normalised through
 * `tools/skill.js` `_normaliseStep` — the exact same resolution the executor
 * uses at run time, so the summary can never drift from reality); this
 * module turns that into:
 *
 *   - a short, human-readable list of actions ("open Chrome", "type text",
 *     "click 3 things", "run 1 shell command"), for a non-technical user —
 *     never a wall of JSON.
 *   - the set of tool CATEGORIES actually invoked (safe-read/sandboxed-write/
 *     shell/destructive/system), resolved via tool-registry.js.
 *   - a mismatch list when `skill.declaredCategories` understates what the
 *     steps actually do (e.g. a skill claims only `safe-read` but a step
 *     resolves to a `shell_run`/`destructive`/`system` tool) — a red flag to
 *     surface prominently rather than trust the skill's own claim.
 *
 * Used by both the local skill-run flow and — once it exists — the
 * marketplace install/first-run flow (§4.3: mandatory for any skill
 * installed from the marketplace).
 */

const registry = require('./tool-registry');
const { _normaliseStep } = require('./tools/skill');

// Ordered least → most sensitive, mirrors permissions.js's category list.
const CATEGORY_SEVERITY = ['safe-read', 'sandboxed-write', 'shell', 'destructive', 'system'];

function _severity(category) {
    const i = CATEGORY_SEVERITY.indexOf(category);
    return i === -1 ? CATEGORY_SEVERITY.length : i; // unknown categories treated as most severe
}

// Human-readable phrasing per tool. Intentionally small/generic — a
// non-technical user needs the gist, not a technical trace. Anything not
// covered falls back to "run <tool>".
function _describeAction(tool, args) {
    switch (tool) {
        case 'window_focus': return 'switch to a window';
        case 'click_at': return 'click on the screen';
        case 'uia_invoke': return `click "${args?.name || args?.automationId || 'a UI element'}"`;
        case 'find_and_click_visual': return `click "${args?.target || args?.query || 'a UI element'}" (visually located)`;
        case 'text_type': return 'type text';
        case 'input_tap': return 'press a key';
        case 'input_hold': return 'hold a key';
        case 'mouse_path': return 'move the mouse';
        case 'mouse_drag': return 'drag/hold the mouse';
        case 'shell_run': {
            const cmd = String(args?.command || '').trim();
            const m = /^start-process\s+"([^"]+)"/i.exec(cmd);
            if (m) return `open ${m[1]}`;
            return 'run 1 shell command';
        }
        case 'skill_run': return `run another skill ("${args?.slug || 'unknown'}")`;
        case 'audio_speak': return 'speak out loud';
        case 'goal_update': return 'update the goal status';
        case 'webcam_capture': return 'capture a webcam photo';
        case 'audio_transcribe': return 'listen via the microphone';
        case 'clipboard_write': return 'write to the clipboard';
        case 'clipboard_read': return 'read the clipboard';
        case 'fs_write': return 'write a file';
        case 'fs_read': return 'read a file';
        default: return `run ${tool}`;
    }
}

/**
 * Recursively flatten a step list into its resolved { tool, args } calls,
 * expanding loop_until_key/loop_n_times bodies via _normaliseStep's
 * control-flow branch and skipping bookkeeping (_marker) / unrecognised
 * steps.
 */
function _flattenSteps(steps) {
    const out = [];
    for (const step of steps || []) {
        if (!step || typeof step !== 'object') continue;
        const normalised = _normaliseStep(step);
        if (!normalised) continue;
        if (normalised._controlFlow) {
            if (Array.isArray(normalised.body)) out.push(..._flattenSteps(normalised.body));
            continue;
        }
        if (normalised.tool === '_marker') continue;
        out.push(normalised);
    }
    return out;
}

/**
 * Build a pre-run capability summary for a skill.
 *
 * @param {object} skill - a compiled/generalized skill with a `.steps` array
 *   and optional `.declaredCategories` (string[]).
 * @returns {{
 *   summary: string[],
 *   actualCategories: string[],
 *   declaredCategories: string[],
 *   mismatches: Array<{category:string, tool:string}>,
 *   toolCounts: Record<string, number>,
 * }}
 */
function summarizeCapabilities(skill) {
    if (!skill || !Array.isArray(skill.steps)) {
        throw new Error('summarizeCapabilities: invalid skill (expected .steps array)');
    }

    const calls = _flattenSteps(skill.steps);

    const toolCounts = {};
    const actionCounts = new Map(); // description → count
    const actualCategorySet = new Set();
    const mismatchTools = new Map(); // category → Set(tool)

    const declaredCategories = Array.isArray(skill.declaredCategories) ? skill.declaredCategories : [];
    const declaredSet = new Set(declaredCategories);

    for (const { tool, args } of calls) {
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;

        const desc = _describeAction(tool, args);
        actionCounts.set(desc, (actionCounts.get(desc) || 0) + 1);

        const toolDef = registry.get(tool);
        const category = toolDef?.category || 'unknown';
        actualCategorySet.add(category);

        if (!declaredSet.has(category)) {
            if (!mismatchTools.has(category)) mismatchTools.set(category, new Set());
            mismatchTools.get(category).add(tool);
        }
    }

    const summary = Array.from(actionCounts.entries()).map(([desc, count]) => (
        count > 1 ? `${desc} (${count}x)` : desc
    ));

    const actualCategories = Array.from(actualCategorySet).sort((a, b) => _severity(b) - _severity(a));

    // Only flag mismatches when the skill actually declared categories — an
    // absent declaration means "no claim was made", not "nothing happens",
    // so there's nothing to contradict.
    const mismatches = declaredCategories.length === 0
        ? []
        : Array.from(mismatchTools.entries())
            .flatMap(([category, tools]) => Array.from(tools).map(tool => ({ category, tool })))
            .sort((a, b) => _severity(b.category) - _severity(a.category));

    return { summary, actualCategories, declaredCategories, mismatches, toolCounts };
}

module.exports = { summarizeCapabilities, _describeAction, _flattenSteps, CATEGORY_SEVERITY };
