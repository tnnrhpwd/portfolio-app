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

// 6. Tiny mouse jitter alone (below distance/duration thresholds) → no steps.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'mouse_move', data: { x: 10, y: 10 } },
        { ts: 2010, type: 'mouse_move', data: { x: 11, y: 11 } },
        { ts: 2020, type: 'mouse_move', data: { x: 12, y: 12 } },
    ]));
    assert('sub-threshold mouse jitter produces no steps', sk.steps.length === 0);
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

// 10. Key events → input_tap steps.
{
    const sk = compileRecording(recording([
        { ts: 1500, type: 'focus_change', data: { windowTitle: 'Notepad' } },
        { ts: 2100, type: 'key_down', data: { vk: 0x57, name: 'w' } },
        { ts: 2200, type: 'key_up',   data: { vk: 0x57, name: 'w' } },
        { ts: 2300, type: 'key_down', data: { vk: 0x1B, name: 'escape' } },
        { ts: 2350, type: 'key_up',   data: { vk: 0x1B, name: 'escape' } },
    ]));
    const taps = sk.steps.filter(s => s.tool === 'input_tap');
    assert('key_down → input_tap step', taps.length === 2);
    assert('input_tap carries key name', taps[0].args.keys[0] === 'w');
    assert('input_tap carries focusWindowTitle from last focus', taps[0].args.focusWindowTitle === 'Notepad');
    assert('escape key captured', taps[1].args.keys[0] === 'escape');
}

// 11. Modifier + key folded into a single input_tap combo.
{
    const sk = compileRecording(recording([
        { ts: 1500, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2100, type: 'key_down', data: { vk: 0x11, name: 'ctrl' } },
        { ts: 2150, type: 'key_down', data: { vk: 0x43, name: 'c' } },
        { ts: 2200, type: 'key_up',   data: { vk: 0x43, name: 'c' } },
        { ts: 2250, type: 'key_up',   data: { vk: 0x11, name: 'ctrl' } },
    ]));
    const taps = sk.steps.filter(s => s.tool === 'input_tap');
    assert('modifier + key emits ONE step', taps.length === 1);
    assert('modifier included in keys array', taps[0].args.keys.length === 2
        && taps[0].args.keys.includes('ctrl')
        && taps[0].args.keys.includes('c'));
}

// 12. Modifier released before main key → no combo carryover on next tap.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2100, type: 'key_down', data: { vk: 0x10, name: 'shift' } },
        { ts: 2150, type: 'key_up',   data: { vk: 0x10, name: 'shift' } },
        { ts: 2200, type: 'key_down', data: { vk: 0x41, name: 'a' } },
        { ts: 2250, type: 'key_up',   data: { vk: 0x41, name: 'a' } },
    ]));
    const taps = sk.steps.filter(s => s.tool === 'input_tap');
    assert('modifier released before tap → tap has no modifier', taps.length === 1
        && taps[0].args.keys.length === 1
        && taps[0].args.keys[0] === 'a');
}

// 13. Modifier-only keydown+keyup with no main key produces no step.
{
    const sk = compileRecording(recording([
        { ts: 2000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2100, type: 'key_down', data: { vk: 0x10, name: 'shift' } },
        { ts: 2500, type: 'key_up',   data: { vk: 0x10, name: 'shift' } },
    ]));
    assert('modifier-only press produces no input_tap',
        sk.steps.filter(s => s.tool === 'input_tap').length === 0);
}

// 14. Long key press (>= 200ms) → input_hold with durationMs.
{
    const sk = compileRecording(recording([
        { ts: 1500, type: 'focus_change', data: { windowTitle: 'Minecraft' } },
        { ts: 2000, type: 'key_down', data: { vk: 0x57, name: 'w' } },
        { ts: 4000, type: 'key_up',   data: { vk: 0x57, name: 'w' } },
    ]));
    const holds = sk.steps.filter(s => s.tool === 'input_hold');
    const taps = sk.steps.filter(s => s.tool === 'input_tap');
    assert('long press → input_hold (not tap)', holds.length === 1 && taps.length === 0);
    assert('input_hold has correct key', holds[0].args.keys[0] === 'w');
    assert('input_hold durationMs matches down→up delta', holds[0].args.durationMs === 2000);
    assert('input_hold carries focusWindowTitle', holds[0].args.focusWindowTitle === 'Minecraft');
}

// 15. Short press (< 200ms) still emits input_tap.
{
    const sk = compileRecording(recording([
        { ts: 1500, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2000, type: 'key_down', data: { vk: 0x57, name: 'w' } },
        { ts: 2050, type: 'key_up',   data: { vk: 0x57, name: 'w' } },
    ]));
    assert('short press → input_tap',
        sk.steps.filter(s => s.tool === 'input_tap').length === 1
        && sk.steps.filter(s => s.tool === 'input_hold').length === 0);
}

// 16. Modifier + long press → input_hold with modifier in keys array.
{
    const sk = compileRecording(recording([
        { ts: 1500, type: 'focus_change', data: { windowTitle: 'Game' } },
        { ts: 2000, type: 'key_down', data: { vk: 0x10, name: 'shift' } },
        { ts: 2050, type: 'key_down', data: { vk: 0x57, name: 'w' } },
        { ts: 3500, type: 'key_up',   data: { vk: 0x57, name: 'w' } },
        { ts: 3550, type: 'key_up',   data: { vk: 0x10, name: 'shift' } },
    ]));
    const holds = sk.steps.filter(s => s.tool === 'input_hold');
    assert('shift+long-w → input_hold combo', holds.length === 1
        && holds[0].args.keys.includes('shift')
        && holds[0].args.keys.includes('w')
        && holds[0].args.durationMs === 1450);
}

// 17. Key still held when recording ends → emitted as tap (unknown duration).
{
    const sk = compileRecording(recording([
        { ts: 1500, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2000, type: 'key_down', data: { vk: 0x57, name: 'w' } },
        // no key_up before end
    ]));
    assert('unclosed key_down → input_tap (no duration to measure)',
        sk.steps.filter(s => s.tool === 'input_tap').length === 1
        && sk.steps.filter(s => s.tool === 'input_hold').length === 0);
}

// 18. Two overlapping key holds emit two separate input_hold steps.
{
    const sk = compileRecording(recording([
        { ts: 1500, type: 'focus_change', data: { windowTitle: 'Game' } },
        { ts: 2000, type: 'key_down', data: { vk: 0x57, name: 'w' } },
        { ts: 2100, type: 'key_down', data: { vk: 0x41, name: 'a' } },
        { ts: 2800, type: 'key_up',   data: { vk: 0x41, name: 'a' } },
        { ts: 2900, type: 'key_up',   data: { vk: 0x57, name: 'w' } },
    ]));
    const holds = sk.steps.filter(s => s.tool === 'input_hold');
    assert('two overlapping holds → two input_hold steps', holds.length === 2);
}

// 19. Standalone mouse-move run (no button) → mouse_path step.
{
    const sk = compileRecording(recording([
        { ts: 1000, type: 'focus_change', data: { windowTitle: 'Minecraft' } },
        // wait past 500ms focus window
        { ts: 2000, type: 'mouse_move', data: { x: 100, y: 100 } },
        { ts: 2050, type: 'mouse_move', data: { x: 140, y: 110 } },
        { ts: 2100, type: 'mouse_move', data: { x: 180, y: 125 } },
        { ts: 2150, type: 'mouse_move', data: { x: 220, y: 145 } },
    ]));
    const paths = sk.steps.filter(s => s.tool === 'mouse_path');
    assert('mouse-move run → mouse_path step', paths.length === 1);
    assert('mouse_path path length matches sample count',
        paths[0].args.path.length === 4);
    assert('mouse_path first point tOffsetMs is 0',
        paths[0].args.path[0].tOffsetMs === 0);
    assert('mouse_path last point tOffsetMs matches duration',
        paths[0].args.path[3].tOffsetMs === 150);
    assert('mouse_path carries focusWindowTitle',
        paths[0].args.focusWindowTitle === 'Minecraft');
}

// 20. Mouse path splits on idle gap > 400ms.
{
    const sk = compileRecording(recording([
        { ts: 1000, type: 'focus_change', data: { windowTitle: 'App' } },
        // first run (200ms, 4 points, ~120px distance)
        { ts: 2000, type: 'mouse_move', data: { x: 100, y: 100 } },
        { ts: 2050, type: 'mouse_move', data: { x: 140, y: 110 } },
        { ts: 2100, type: 'mouse_move', data: { x: 180, y: 125 } },
        { ts: 2200, type: 'mouse_move', data: { x: 220, y: 145 } },
        // idle gap > 400ms
        { ts: 2700, type: 'mouse_move', data: { x: 300, y: 200 } },
        { ts: 2750, type: 'mouse_move', data: { x: 340, y: 210 } },
        { ts: 2800, type: 'mouse_move', data: { x: 380, y: 225 } },
        { ts: 2900, type: 'mouse_move', data: { x: 420, y: 245 } },
    ]));
    const paths = sk.steps.filter(s => s.tool === 'mouse_path');
    assert('mouse_path splits on idle gap → 2 steps', paths.length === 2);
}

// 21. Click represented as mouse_click + mouse_up short duration → click_at.
{
    const sk = compileRecording(recording([
        { ts: 1000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2000, type: 'mouse_click', data: { x: 500, y: 300, button: 'left' } },
        { ts: 2050, type: 'mouse_up',    data: { x: 500, y: 300, button: 'left' } },
    ]));
    const clicks = sk.steps.filter(s => s.tool === 'click_at');
    const drags = sk.steps.filter(s => s.tool === 'mouse_drag');
    assert('short press+release → click_at', clicks.length === 1 && drags.length === 0);
    assert('click_at has correct coords', clicks[0].args.x === 500 && clicks[0].args.y === 300);
}

// 22. Long stationary mouse press → mouse_drag with holdMs and 1-point path.
{
    const sk = compileRecording(recording([
        { ts: 1000, type: 'focus_change', data: { windowTitle: 'Minecraft' } },
        { ts: 2000, type: 'mouse_click', data: { x: 500, y: 300, button: 'right' } },
        { ts: 4500, type: 'mouse_up',    data: { x: 500, y: 300, button: 'right' } },
    ]));
    const drags = sk.steps.filter(s => s.tool === 'mouse_drag');
    assert('long stationary press → mouse_drag', drags.length === 1);
    assert('mouse_drag button matches', drags[0].args.button === 'right');
    assert('mouse_drag holdMs matches duration', drags[0].args.holdMs === 2500);
    assert('mouse_drag path has one point (stationary)', drags[0].args.path.length === 1);
}

// 23. Mouse press + movement between → mouse_drag with path.
{
    const sk = compileRecording(recording([
        { ts: 1000, type: 'focus_change', data: { windowTitle: 'Minecraft' } },
        { ts: 2000, type: 'mouse_click', data: { x: 500, y: 300, button: 'right' } },
        { ts: 2050, type: 'mouse_move',  data: { x: 520, y: 310 } },
        { ts: 2100, type: 'mouse_move',  data: { x: 560, y: 340 } },
        { ts: 2150, type: 'mouse_move',  data: { x: 620, y: 380 } },
        { ts: 2200, type: 'mouse_up',    data: { x: 640, y: 400, button: 'right' } },
    ]));
    const drags = sk.steps.filter(s => s.tool === 'mouse_drag');
    const paths = sk.steps.filter(s => s.tool === 'mouse_path');
    assert('press + movement → mouse_drag', drags.length === 1);
    assert('no standalone mouse_path emitted for moves inside press', paths.length === 0);
    assert('mouse_drag path includes down/moves/up',
        drags[0].args.path.length === 5);
    assert('mouse_drag first path point matches down pos',
        drags[0].args.path[0].x === 500 && drags[0].args.path[0].y === 300);
    assert('mouse_drag last path point matches up pos',
        drags[0].args.path[4].x === 640 && drags[0].args.path[4].y === 400);
    assert('mouse_drag path tOffsetMs relative to down',
        drags[0].args.path[0].tOffsetMs === 0
        && drags[0].args.path[4].tOffsetMs === 200);
    assert('mouse_drag carries focusWindowTitle',
        drags[0].args.focusWindowTitle === 'Minecraft');
}

// 24. Orphaned mouse_click without mouse_up → click_at (backward compat).
{
    const sk = compileRecording(recording([
        { ts: 1000, type: 'focus_change', data: { windowTitle: 'App' } },
        { ts: 2000, type: 'mouse_click', data: { x: 100, y: 100, button: 'left' } },
        // no mouse_up before recording end
    ]));
    const clicks = sk.steps.filter(s => s.tool === 'click_at');
    assert('orphan mouse_click flushes as click_at', clicks.length === 1);
}

console.log('');
if (failed === 0) {
    console.log(`compiler.test: ${total}/${total} PASS`);
    process.exit(0);
} else {
    console.log(`compiler.test: ${failed}/${total} FAILED`);
    process.exit(1);
}
