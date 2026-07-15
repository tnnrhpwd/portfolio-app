/**
 * input.test.js — plain PASS/FAIL harness (same style as compiler.test.js /
 * skill.test.js) for the mouse-phrase-in-`keys` back-compat splitter used by
 * input_hold / input_tap.
 *
 * This is deliberately a PURE unit test of `splitMousePhrasesFromKeys` (no
 * PowerShell spawn) — it exists to catch a regression of the exact bug that
 * shipped: "unknown key: left mouse button" thrown synchronously by
 * resolveKey() because a mouse-button phrase was left inside `args.keys`
 * instead of being routed to `args.mouseButtons`.
 */

const assert = require('assert');
const { splitMousePhrasesFromKeys } = require('./input');

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`  PASS  ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL  ${name}: ${e.message}`);
        failed++;
    }
}

console.log('input.test: splitMousePhrasesFromKeys');

test('extracts "left mouse button"', () => {
    const { keys, mouseButtons } = splitMousePhrasesFromKeys(['left mouse button'], []);
    assert.deepStrictEqual(keys, []);
    assert.deepStrictEqual(mouseButtons, ['left']);
});

test('extracts "right mouse button" and "middle mouse button"', () => {
    const r = splitMousePhrasesFromKeys(['right mouse button'], []);
    assert.deepStrictEqual(r.mouseButtons, ['right']);
    const m = splitMousePhrasesFromKeys(['middle mouse button'], []);
    assert.deepStrictEqual(m.mouseButtons, ['middle']);
});

test('extracts "left click" and "right-click" phrasing variants', () => {
    const a = splitMousePhrasesFromKeys(['left click'], []);
    assert.deepStrictEqual(a.mouseButtons, ['left']);
    const b = splitMousePhrasesFromKeys(['right-click'], []);
    assert.deepStrictEqual(b.mouseButtons, ['right']);
    const c = splitMousePhrasesFromKeys(['left_button'], []);
    assert.deepStrictEqual(c.mouseButtons, ['left']);
});

test('case-insensitive', () => {
    const { mouseButtons } = splitMousePhrasesFromKeys(['Left Mouse Button'], []);
    assert.deepStrictEqual(mouseButtons, ['left']);
});

test('leaves real keyboard keys untouched', () => {
    const { keys, mouseButtons } = splitMousePhrasesFromKeys(['w', 'shift', 'left'], []);
    // Bare "left" (no "mouse"/"click"/"button" suffix) is the arrow/nav key,
    // NOT a mouse button — must NOT be reclassified.
    assert.deepStrictEqual(keys, ['w', 'shift', 'left']);
    assert.deepStrictEqual(mouseButtons, []);
});

test('mixed array: keyboard key + mouse phrase both handled in one call', () => {
    const { keys, mouseButtons } = splitMousePhrasesFromKeys(['w', 'left mouse button'], []);
    assert.deepStrictEqual(keys, ['w']);
    assert.deepStrictEqual(mouseButtons, ['left']);
});

test('merges with pre-existing mouseButtons and de-dupes', () => {
    const { keys, mouseButtons } = splitMousePhrasesFromKeys(['left mouse button'], ['left']);
    assert.deepStrictEqual(keys, []);
    assert.deepStrictEqual(mouseButtons, ['left']);
});

test('empty/undefined inputs do not throw', () => {
    assert.deepStrictEqual(splitMousePhrasesFromKeys(undefined, undefined), { keys: [], mouseButtons: [] });
    assert.deepStrictEqual(splitMousePhrasesFromKeys([], []), { keys: [], mouseButtons: [] });
});

console.log(`\ninput.test: ${passed}/${passed + failed} PASS`);
if (failed > 0) process.exit(1);
