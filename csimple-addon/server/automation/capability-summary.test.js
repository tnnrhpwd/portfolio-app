/**
 * Standalone unit tests for the pre-run capability summary
 * (capability-summary.js).
 *
 * The real tool-registry is replaced with a controllable fake via
 * require.cache BEFORE capability-summary.js (and the tools/skill.js it
 * pulls in for `_normaliseStep`) load, so no real tools/permissions are
 * exercised and category lookups are deterministic — same technique as
 * tools/skill.test.js.
 *
 * Run with: `node csimple-addon/server/automation/capability-summary.test.js`
 * Exit code 0 on success, 1 on first failure.
 */

const registryPath = require.resolve('./tool-registry');
const wsPath = require.resolve('./workspace-client');

const TOOL_CATEGORIES = {
    click_at: 'safe-read',
    uia_invoke: 'safe-read',
    find_and_click_visual: 'safe-read',
    text_type: 'sandboxed-write',
    input_tap: 'safe-read',
    window_focus: 'safe-read',
    shell_run: 'shell',
    skill_run: 'safe-read',
    fs_write: 'destructive',
};

const fakeRegistry = {
    get(name) {
        const category = TOOL_CATEGORIES[name];
        return category ? { name, category } : undefined;
    },
    async executeTool() { throw new Error('not used in this test'); },
};
require.cache[registryPath] = { id: registryPath, filename: registryPath, loaded: true, exports: fakeRegistry };
require.cache[wsPath] = {
    id: wsPath, filename: wsPath, loaded: true,
    exports: { async getSkill() { throw new Error('workspace disabled in test'); } },
};

const { summarizeCapabilities } = require('./capability-summary');

let failed = 0;
let total = 0;

function check(name, cond, detail) {
    total++;
    if (cond) {
        console.log(`  PASS  ${name}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    }
}

function skillWith(steps, declaredCategories) {
    const s = { name: 'demo', slug: 'demo', steps, params: [], metadata: {} };
    if (declaredCategories) s.declaredCategories = declaredCategories;
    return s;
}

// ─── Basic summary + counts ─────────────────────────────────────────────────
{
    const skill = skillWith([
        { tool: 'window_focus', args: { titleContains: 'Chrome' } },
        { tool: 'click_at', args: { x: 1, y: 1 } },
        { tool: 'click_at', args: { x: 2, y: 2 } },
        { tool: 'text_type', args: { text: 'hello' } },
        { tool: 'shell_run', args: { command: 'echo hi' } },
    ]);
    const out = summarizeCapabilities(skill);
    check('summary includes "type text"', out.summary.includes('type text'));
    check('summary counts repeated action (2x)', out.summary.includes('click on the screen (2x)'));
    check('summary includes shell command line', out.summary.includes('run 1 shell command'));
    check('actualCategories includes shell', out.actualCategories.includes('shell'));
    check('toolCounts click_at is 2', out.toolCounts.click_at === 2);
}

// ─── open_app style shell_run gets a friendlier description ────────────────
{
    const skill = skillWith([{ tool: 'shell_run', args: { command: 'Start-Process "notepad.exe"' } }]);
    const out = summarizeCapabilities(skill);
    check('open_app phrasing detected', out.summary.some(s => s.includes('open notepad.exe')));
}

// ─── _marker steps and unrecognised steps are skipped ──────────────────────
{
    const skill = skillWith([
        { tool: '_marker', args: { label: 'x' } },
        { type: 'not_a_real_type' },
        { tool: 'click_at', args: { x: 1, y: 1 } },
    ]);
    const out = summarizeCapabilities(skill);
    check('marker/unrecognised steps excluded from summary', out.summary.length === 1);
}

// ─── Loop bodies are flattened (control-flow expansion) ────────────────────
{
    const skill = skillWith([
        {
            type: 'loop_n_times',
            times: 3,
            body: [{ tool: 'fs_write', args: { path: 'a.txt', content: 'x' } }],
        },
    ]);
    const out = summarizeCapabilities(skill);
    check('loop body tool counted once per body occurrence (not multiplied by times)', out.toolCounts.fs_write === 1);
    check('loop body category surfaced', out.actualCategories.includes('destructive'));
}

// ─── No declaredCategories → no mismatches (no claim made) ─────────────────
{
    const skill = skillWith([{ tool: 'shell_run', args: { command: 'echo hi' } }]);
    const out = summarizeCapabilities(skill);
    check('no declaration → no mismatches', out.mismatches.length === 0);
    check('no declaration → declaredCategories empty', out.declaredCategories.length === 0);
}

// ─── declaredCategories understating actual → mismatch flagged ────────────
{
    const skill = skillWith(
        [{ tool: 'shell_run', args: { command: 'echo hi' } }, { tool: 'click_at', args: { x: 1, y: 1 } }],
        ['safe-read'],
    );
    const out = summarizeCapabilities(skill);
    check('undeclared category flagged as mismatch', out.mismatches.some(m => m.category === 'shell' && m.tool === 'shell_run'));
    check('declared category NOT flagged', !out.mismatches.some(m => m.category === 'safe-read'));
}

// ─── declaredCategories matching actual → no mismatch ──────────────────────
{
    const skill = skillWith([{ tool: 'shell_run', args: { command: 'echo hi' } }], ['shell']);
    const out = summarizeCapabilities(skill);
    check('accurately declared category → no mismatch', out.mismatches.length === 0);
}

// ─── Unknown tool (not in registry) → 'unknown' category, still summarised ─
{
    const skill = skillWith([{ tool: 'totally_unregistered_tool', args: {} }]);
    const out = summarizeCapabilities(skill);
    check('unknown tool falls back to generic description', out.summary.includes('run totally_unregistered_tool'));
    check('unknown tool category is "unknown"', out.actualCategories.includes('unknown'));
}

// ─── Invalid input ──────────────────────────────────────────────────────────
{
    let threw = false;
    try { summarizeCapabilities({}); } catch { threw = true; }
    check('invalid skill (no steps) throws', threw);
}

console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
