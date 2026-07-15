/**
 * nl-compiler.test.js — Unit tests for the NL macro compiler.
 *
 * Tests schema validation and security checks without making LLM calls.
 * Run: node server/automation/nl-compiler.test.js
 */

'use strict';

const assert = require('assert');
const { validateSteps, clearCache, VALID_STEP_TYPES, editSteps } = require('./nl-compiler');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS  ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL  ${name}`);
        console.log(`        ${e.message}`);
        failed++;
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`  PASS  ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL  ${name}`);
        console.log(`        ${e.message}`);
        failed++;
    }
}

function assertThrows(fn, msgFragment) {
    let threw = false;
    try { fn(); } catch (e) {
        threw = true;
        if (msgFragment && !e.message.toLowerCase().includes(msgFragment.toLowerCase())) {
            throw new Error(`Expected error containing "${msgFragment}", got: ${e.message}`);
        }
    }
    if (!threw) throw new Error('Expected an error to be thrown but none was');
}

// ── VALID_STEP_TYPES ───────────────────────────────────────────────────────────

console.log('\nnl-compiler.test: step type set');
test('VALID_STEP_TYPES is a Set with expected members', () => {
    assert(VALID_STEP_TYPES instanceof Set);
    assert(VALID_STEP_TYPES.has('key_tap'));
    assert(VALID_STEP_TYPES.has('loop_until_key'));
    assert(VALID_STEP_TYPES.has('loop_n_times'));
    assert(VALID_STEP_TYPES.has('screenshot_check'));
    assert(VALID_STEP_TYPES.has('speak'));
    assert(!VALID_STEP_TYPES.has('unknown_type'));
});

// ── validateSteps: happy paths ─────────────────────────────────────────────────

console.log('\nnl-compiler.test: validateSteps happy paths');
test('accepts minimal key_tap step', () => {
    validateSteps([{ type: 'key_tap', keys: ['w'] }]);
});

test('accepts key_hold step', () => {
    validateSteps([{ type: 'key_hold', keys: ['w', 'shift'], duration_ms: 1000 }]);
});

test('accepts type_text step', () => {
    validateSteps([{ type: 'type_text', text: 'Hello world' }]);
});

test('accepts wait_ms step', () => {
    validateSteps([{ type: 'wait_ms', ms: 500 }]);
});

test('accepts click_at step', () => {
    validateSteps([{ type: 'click_at', x: 100, y: 200 }]);
});

test('accepts click_visual step', () => {
    validateSteps([{ type: 'click_visual', target: 'Submit button' }]);
});

test('accepts open_app step', () => {
    validateSteps([{ type: 'open_app', name: 'notepad.exe' }]);
});

test('accepts uia_invoke step', () => {
    validateSteps([{ type: 'uia_invoke', name: 'OK' }]);
});

test('accepts skill_run step', () => {
    validateSteps([{ type: 'skill_run', slug: 'my-macro' }]);
});

test('accepts speak step', () => {
    validateSteps([{ type: 'speak', text: 'Done!' }]);
});

test('accepts goal_done step', () => {
    validateSteps([{ type: 'goal_done' }]);
});

test('accepts screenshot_check step', () => {
    validateSteps([{ type: 'screenshot_check', condition: 'Is the dialog closed?' }]);
});

test('accepts loop_n_times with body', () => {
    validateSteps([{ type: 'loop_n_times', times: 5, body: [{ type: 'key_tap', keys: ['w'] }] }]);
});

test('accepts loop_until_key with body', () => {
    validateSteps([{
        type: 'loop_until_key',
        key: 'Escape',
        body: [{ type: 'key_tap', keys: ['w'] }, { type: 'wait_ms', ms: 100 }],
    }]);
});

test('accepts multi-step array', () => {
    validateSteps([
        { type: 'open_app', name: 'minecraft.exe' },
        { type: 'wait_ms', ms: 3000 },
        { type: 'loop_until_key', key: 'Escape', body: [{ type: 'key_tap', keys: ['w'] }] },
    ]);
});

// ── validateSteps: error cases ─────────────────────────────────────────────────

console.log('\nnl-compiler.test: validateSteps error cases');
test('rejects empty array', () => {
    assertThrows(() => validateSteps([]), 'empty');
});

test('rejects non-array', () => {
    assertThrows(() => validateSteps({ type: 'key_tap' }), 'array');
});

test('rejects unknown step type', () => {
    assertThrows(() => validateSteps([{ type: 'do_magic' }]), 'not a valid step type');
});

test('rejects key_tap with no keys', () => {
    assertThrows(() => validateSteps([{ type: 'key_tap', keys: [] }]), 'key_tap');
});

test('rejects key_hold with excessive duration', () => {
    assertThrows(() => validateSteps([{ type: 'key_hold', keys: ['w'], duration_ms: 99999 }]), 'duration_ms');
});

test('rejects wait_ms with negative value', () => {
    assertThrows(() => validateSteps([{ type: 'wait_ms', ms: -1 }]), 'wait_ms');
});

test('rejects wait_ms over 5 minutes', () => {
    assertThrows(() => validateSteps([{ type: 'wait_ms', ms: 400000 }]), 'wait_ms');
});

test('rejects open_app with shell injection characters', () => {
    assertThrows(() => validateSteps([{ type: 'open_app', name: 'calc; rm -rf /' }]), 'forbidden');
});

test('rejects shell_run with rm command', () => {
    assertThrows(() => validateSteps([{ type: 'shell_run', command: 'rm -rf /home' }]), 'forbidden');
});

test('rejects shell_run with del command', () => {
    assertThrows(() => validateSteps([{ type: 'shell_run', command: 'del /f /q C:\\Windows' }]), 'forbidden');
});

test('rejects shell_run with shutdown command', () => {
    assertThrows(() => validateSteps([{ type: 'shell_run', command: 'shutdown /s /t 0' }]), 'forbidden');
});

test('rejects loop_n_times with excessive iterations', () => {
    assertThrows(() => validateSteps([{ type: 'loop_n_times', times: 99999, body: [] }]), 'loop_n_times');
});

test('rejects nested loops inside loop_until_key', () => {
    assertThrows(() => validateSteps([{
        type: 'loop_until_key',
        key: 'Escape',
        body: [{ type: 'loop_n_times', times: 5, body: [] }],
    }]), 'nested loops');
});

test('rejects over 30 steps', () => {
    const steps = Array.from({ length: 31 }, () => ({ type: 'wait_ms', ms: 100 }));
    assertThrows(() => validateSteps(steps), 'too many steps');
});

test('rejects speak with text over 500 chars', () => {
    assertThrows(() => validateSteps([{ type: 'speak', text: 'x'.repeat(501) }]), 'speak');
});

// ── clearCache ─────────────────────────────────────────────────────────────────

console.log('\nnl-compiler.test: clearCache');
test('clearCache does not throw', () => {
    clearCache();
});

// ── editSteps (natural-language macro editing) ─────────────────────────────────
// Uses an injected fake llmClient so no real network/LLM call is made.

function fakeLlm(responseText) {
    return { chat: async () => ({ choices: [{ message: { content: responseText } }] }) };
}

async function runEditStepsTests() {
    console.log('\nnl-compiler.test: editSteps');

    await asyncTest('rejects empty current steps', async () => {
        await assertRejects(() => editSteps([], 'do something'), 'non-empty');
    });

    await asyncTest('rejects missing instruction', async () => {
        await assertRejects(() => editSteps([{ type: 'key_tap', keys: ['a'] }], ''), 'instruction');
    });

    await asyncTest('applies an LLM-returned edit (type schema)', async () => {
        const original = [{ type: 'click_at', x: 10, y: 20 }];
        const llmClient = fakeLlm(JSON.stringify({
            steps: [
                { type: 'click_at', x: 10, y: 20 },
                { type: 'key_tap', keys: ['z'] },
            ],
        }));
        const result = await editSteps(original, 'press z after the click', { llmClient });
        assert.strictEqual(result.steps.length, 2);
        assert.strictEqual(result.steps[1].type, 'key_tap');
        assert.strictEqual(result.meta.previousStepCount, 1);
    });

    await asyncTest('preserves legacy {tool,args} shape round-trip', async () => {
        const original = [{ tool: 'input_tap', args: { keys: ['shift'] } }];
        const llmClient = fakeLlm(JSON.stringify({
            steps: [
                { tool: 'input_tap', args: { keys: ['shift'] } },
                { tool: 'input_tap', args: { keys: ['z'] } },
            ],
        }));
        const result = await editSteps(original, 'press z after the shift click', { llmClient });
        assert.strictEqual(result.steps.length, 2);
        assert.strictEqual(result.steps[1].tool, 'input_tap');
    });

    await asyncTest('rejects destructive shell command in edited steps', async () => {
        const original = [{ type: 'key_tap', keys: ['a'] }];
        const llmClient = fakeLlm(JSON.stringify({
            steps: [{ type: 'shell_run', command: 'del /f /q C:\\Users' }],
        }));
        await assertRejects(() => editSteps(original, 'delete everything', { llmClient }), 'forbidden');
    });

    await asyncTest('rejects step missing type/tool field', async () => {
        const original = [{ type: 'key_tap', keys: ['a'] }];
        const llmClient = fakeLlm(JSON.stringify({ steps: [{ foo: 'bar' }] }));
        await assertRejects(() => editSteps(original, 'change something', { llmClient }), 'type');
    });

    await asyncTest('rejects invalid JSON from LLM', async () => {
        const original = [{ type: 'key_tap', keys: ['a'] }];
        const llmClient = fakeLlm('not json at all');
        await assertRejects(() => editSteps(original, 'do something', { llmClient }), 'invalid json');
    });
}

async function assertRejects(fn, msgFragment) {
    let threw = false;
    try { await fn(); } catch (e) {
        threw = true;
        if (msgFragment && !e.message.toLowerCase().includes(msgFragment.toLowerCase())) {
            throw new Error(`Expected error containing "${msgFragment}", got: ${e.message}`);
        }
    }
    if (!threw) throw new Error('Expected an error to be thrown but none was');
}

// ── Results ────────────────────────────────────────────────────────────────────

runEditStepsTests().then(() => {
    console.log(`\nnl-compiler.test: ${passed + failed}/${passed + failed} PASS`);
    if (failed > 0) {
        console.error(`\n${failed} test(s) failed`);
        process.exit(1);
    }
    console.log(`Results: ${passed} passed, ${failed} failed`);
});
