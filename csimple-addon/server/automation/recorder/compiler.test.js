/**
 * Standalone unit tests for the skill compiler.
 *
 * Not part of the scenario runner (which targets tools, not pure JS modules).
 * Run with: `node csimple-addon/server/automation/recorder/compiler.test.js`
 *
 * Exit code 0 on success, 1 on first failure. Output is single-line summaries
 * matching the eval runner's style.
 */

const { compileRecording, slugify, _firstSignificantSubstring } = require('./compiler');

let failed = 0;
let total = 0;

function assert(name, cond, detail) {
    total++;
    if (cond) {
        console.log(`  PASS  ${name}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    }
}

// ─── slugify ──────────────────────────────────────────────────────────────
assert('slugify lowercases + dashes', slugify('Hello World!') === 'hello-world');
assert('slugify strips leading/trailing dashes', slugify('---abc---') === 'abc');
assert('slugify defaults to "skill" for empty', slugify('') === 'skill');
assert('slugify truncates long names', slugify('a'.repeat(200)).length === 60);

// ─── _firstSignificantSubstring ───────────────────────────────────────────
assert('app-name extraction: "Doc - Word" → "Word"', _firstSignificantSubstring('Doc - Word') === 'Word');
assert('keeps title if single segment', _firstSignificantSubstring('Calculator') === 'Calculator');
assert('falls back to first segment if last has digits',
    _firstSignificantSubstring('Long title - User123') === 'Long title');

// ─── compileRecording ─────────────────────────────────────────────────────
function recording(events, header = {}, footer = {}) {
    return {
        sessionId: 'test',
        header: { type: 'header', ts: 1000, data: { name: 'unit-test', ...header } },
        events,
        footer: { type: 'footer', ts: 9000, data: { eventCount: events.length, durationMs: 8000, ...footer } },
    };
}

// 1. Empty recording → empty skill.
{
    const sk = compileRecording(recording([]));
    assert('empty recording → 0 steps', sk.steps.length === 0);
    assert('skill carries metadata', sk.metadata.sourceSessionId === 'test');
}

// 2. focus_change only → one window_focus step.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'focus_change', data: { windowTitle: 'Notepad - foo.txt', processName: 'notepad' } },
    ]));
    assert('focus_change → window_focus step', sk.steps.length === 1 && sk.steps[0].tool === 'window_focus');
    assert('window_focus uses titleContains', sk.steps[0].args.titleContains === 'foo.txt' || sk.steps[0].args.titleContains === 'Notepad');
}

// 3. Click within 500ms of focus_change is dropped.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2100, type: 'mouse_click', data: { x: 100, y: 100, button: 'left' } },
    ]));
    assert('click within 500ms of focus dropped', sk.steps.length === 1);
}

// 4. Click after 500ms is kept.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2700, type: 'mouse_click', data: { x: 100, y: 100, button: 'left' } },
    ]));
    assert('click after 500ms kept', sk.steps.length === 2 && sk.steps[1].tool === 'click_at');
    assert('click_at has x/y', sk.steps[1].args.x === 100 && sk.steps[1].args.y === 100);
}

// 5. Duplicate consecutive focus titles collapse.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 3000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 4000, type: 'focus_change', data: { windowTitle: 'App' } },
    ]));
    assert('duplicate focuses collapse', sk.steps.length === 1);
}

// 6. mouse_move events alone produce no steps.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'mouse_move', data: { x: 10, y: 10 } },
        { ts: 2100, type: 'mouse_move', data: { x: 20, y: 20 } },
        { ts: 2200, type: 'mouse_move', data: { x: 30, y: 30 } },
    ]));
    assert('mouse_move alone produces no steps', sk.steps.length === 0);
}

// 7. Marker events surface as _marker steps.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'marker', data: { label: 'checkpoint-A' } },
    ]));
    assert('marker → _marker step', sk.steps.length === 1 && sk.steps[0].tool === '_marker');
    assert('marker label preserved', sk.steps[0].args.label === 'checkpoint-A');
}

// 8. Empty/invalid title focus_change is ignored.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'focus_change', data: { windowTitle: '' } },
        { ts: 3000, type: 'focus_change', data: { windowTitle: '   ' } },
    ]));
    assert('blank focus titles ignored', sk.steps.length === 0);
}

// 9. Double-clicks (clicks within minClickGapMs) are deduped.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2700, type: 'mouse_click', data: { x: 50, y: 50, button: 'left' } },
        { ts: 2720, type: 'mouse_click', data: { x: 50, y: 50, button: 'left' } }, // dedupe (20ms gap < 80ms default)
    ]));
    assert('rapid duplicate clicks deduped', sk.steps.filter(s => s.tool === 'click_at').length === 1);
}

console.log('');
if (failed === 0) {
    console.log(`compiler.test: ${total}/${total} PASS`);
    process.exit(0);
} else {
    console.log(`compiler.test: ${failed}/${total} FAILED`);
    process.exit(1);
}
