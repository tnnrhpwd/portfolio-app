/**
 * marketplaceCapabilities.js — server-side re-enforcement of the
 * declared-vs-actual capability/category mismatch check
 * (docs/new/csimple-agent-prompt.md §4.5, §6.2).
 *
 * §4.5's Definition of Done calls out that the publish endpoint "does not
 * independently re-run summarizeCapabilities's declared-vs-actual category
 * mismatch check server-side — that still only runs client-side via
 * POST /api/skill/capabilities". That's the same class of gap `scrubForPublish`
 * closed for PII/secrets: a malicious or buggy client could call
 * POST /api/data/market/skills directly with `declaredCategories: ['safe-read']`
 * while `steps` actually invoke `shell_run`/`process_kill`/etc, and nothing
 * server-side would ever catch or surface that mismatch.
 *
 * This module is a DELIBERATE, INDEPENDENT PORT of
 * `csimple-addon/server/automation/capability-summary.js`'s
 * `summarizeCapabilities` — NOT a cross-project `require()` of the addon's
 * copy, for the same two reasons documented in `marketplaceScrub.js`:
 *   1. `csimple-addon/` and `backend/` deploy independently.
 *   2. The addon's version resolves tool categories dynamically via
 *      `tool-registry.js` (which requires every tool module, Electron/Win32
 *      dependencies and all) and normalises steps via `tools/skill.js`
 *      `_normaliseStep`. Neither is available/desirable inside the backend
 *      process. This port instead uses a static TOOL_CATEGORY_MAP mirroring
 *      the addon's registered tool categories, and only understands the
 *      already-normalised `{ tool, args, body? }` step shape that
 *      `scrubForPublish` operates on (the addon's `type`-based nl-compiler
 *      step shape is resolved to `{tool,args}` client-side before publish).
 *
 * KEEP IN SYNC with `csimple-addon/server/automation/tool-registry.js`'s
 * registered tool categories (grep every tool file under
 * `csimple-addon/server/automation/tools/` for `category:`) — if a tool's
 * category changes there, or a new tool is added, mirror it here too.
 *
 * Server-side usage here is "belt and suspenders" like the scrub pass:
 * the backend independently computes the actual categories invoked by
 * `steps` and compares against the client-declared `declaredCategories`,
 * returning a `capabilitySummary` (with any `mismatches`) on the publish
 * response — the caller/UI still decides what to do with it (§6.2/§6.4:
 * mandatory pre-run confirmation UI is a separate, still-open item), but a
 * client can no longer make an undetected under-declaration at publish time.
 */

// Mirrors the category assigned to each tool at registration time in
// csimple-addon/server/automation/tools/*.js. Unknown/未-registered tool
// names resolve to 'unknown' (treated as most severe by CATEGORY_SEVERITY,
// same fallback behavior as the addon's summarizeCapabilities).
const TOOL_CATEGORY_MAP = {
    // audio.js
    audio_transcribe: 'safe-read',
    audio_speak: 'system',
    // browser.js
    browser_open: 'sandboxed-write',
    browser_goto: 'sandboxed-write',
    browser_click: 'sandboxed-write',
    browser_fill: 'sandboxed-write',
    browser_text: 'safe-read',
    browser_eval: 'shell',
    browser_screenshot: 'safe-read',
    browser_status: 'safe-read',
    browser_close: 'sandboxed-write',
    // fs.js
    fs_read: 'safe-read',
    fs_write: 'sandboxed-write',
    fs_list: 'safe-read',
    // goal.js
    goal_update: 'safe-read',
    goal_create: 'safe-read',
    goal_ask_user: 'safe-read',
    // input.js
    input_hold: 'system',
    input_tap: 'system',
    click_at: 'system',
    mouse_path: 'system',
    mouse_drag: 'system',
    // ocr.js
    screen_ocr: 'safe-read',
    // open-app.js
    open_app: 'system',
    // screen-relay.js
    screen_relay: 'sandboxed-write',
    // screen.js
    screen_capture: 'safe-read',
    // set-of-marks.js
    screen_set_of_marks: 'safe-read',
    // shell.js
    shell_run: 'shell',
    // tools/skill.js
    skill_run: 'system',
    // system.js
    window_list: 'safe-read',
    window_focus: 'system',
    process_list: 'safe-read',
    process_kill: 'destructive',
    clipboard_read: 'safe-read',
    clipboard_write: 'sandboxed-write',
    // text-type.js
    text_type: 'system',
    // uia.js
    uia_find: 'safe-read',
    uia_invoke: 'system',
    uia_get_text: 'safe-read',
    uia_snapshot: 'safe-read',
    // webcam.js
    webcam_capture: 'safe-read',
    // vision-fusion.js
    find_and_click_visual: 'system',
};

// Ordered least → most sensitive, mirrors permissions.js's category list.
const CATEGORY_SEVERITY = ['safe-read', 'sandboxed-write', 'shell', 'destructive', 'system'];

function _severity(category) {
    const i = CATEGORY_SEVERITY.indexOf(category);
    return i === -1 ? CATEGORY_SEVERITY.length : i; // unknown categories treated as most severe
}

/**
 * Recursively flatten a step list (already-normalised `{tool, args, body?}`
 * shape only — the shape `scrubForPublish` produces) into its resolved
 * `{tool, args}` calls, expanding loop `.body` arrays.
 */
function _flattenSteps(steps) {
    const out = [];
    for (const step of steps || []) {
        if (!step || typeof step !== 'object') continue;
        if (Array.isArray(step.body)) {
            out.push(..._flattenSteps(step.body));
            continue;
        }
        if (!step.tool || step.tool === '_marker') continue;
        out.push({ tool: step.tool, args: step.args });
    }
    return out;
}

/**
 * Compute actual tool categories invoked by `steps` and compare against
 * `declaredCategories`, mirroring the addon's `summarizeCapabilities`
 * mismatch semantics (an absent/empty declaration makes no claim, so
 * nothing can contradict it).
 *
 * @param {object} skill - `{ steps, declaredCategories? }`
 * @returns {{ actualCategories: string[], declaredCategories: string[], mismatches: Array<{category:string, tool:string}>, toolCounts: Record<string, number> }}
 */
function summarizeCapabilities(skill) {
    if (!skill || !Array.isArray(skill.steps)) {
        throw new Error('summarizeCapabilities: invalid skill (expected .steps array)');
    }

    const calls = _flattenSteps(skill.steps);
    const toolCounts = {};
    const actualCategorySet = new Set();
    const mismatchTools = new Map(); // category → Set(tool)

    const declaredCategories = Array.isArray(skill.declaredCategories) ? skill.declaredCategories : [];
    const declaredSet = new Set(declaredCategories);

    for (const { tool } of calls) {
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
        const category = TOOL_CATEGORY_MAP[tool] || 'unknown';
        actualCategorySet.add(category);
        if (!declaredSet.has(category)) {
            if (!mismatchTools.has(category)) mismatchTools.set(category, new Set());
            mismatchTools.get(category).add(tool);
        }
    }

    const actualCategories = Array.from(actualCategorySet).sort((a, b) => _severity(b) - _severity(a));

    const mismatches = declaredCategories.length === 0
        ? []
        : Array.from(mismatchTools.entries())
            .flatMap(([category, tools]) => Array.from(tools).map(tool => ({ category, tool })))
            .sort((a, b) => _severity(b.category) - _severity(a.category));

    return { actualCategories, declaredCategories, mismatches, toolCounts };
}

module.exports = { summarizeCapabilities, TOOL_CATEGORY_MAP, CATEGORY_SEVERITY };
