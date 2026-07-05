/**
 * Unit tests for the skill-hotkeys registry (Electron globalShortcut binding
 * map for recorded macros).
 *
 * Runs offline. Each test writes its config to a fresh tmp dir so the real
 * userData directory is never touched. Matches the plain-node test style used
 * by the other automation modules (no Jest dependency).
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const skillHotkeys = require('./skill-hotkeys');

let pass = 0, fail = 0;

function test(name, fn) {
    try {
        skillHotkeys._reset();
        fn();
        console.log(`  PASS  ${name}`);
        pass++;
    } catch (e) {
        console.error(`  FAIL  ${name}\n        ${e.stack || e.message}`);
        fail++;
    }
}

function tmpConfig() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-hotkeys-'));
    return path.join(dir, 'skill-hotkeys.json');
}

function makeSpy() {
    const calls = [];
    return { fn: (arg) => calls.push(arg), calls };
}

console.log('\n▶ skill-hotkeys.test.js');

// ─── normalizeAccelerator ────────────────────────────────────────────────
test('normalizeAccelerator: canonical CommandOrControl+Alt+1', () => {
    assert.strictEqual(
        skillHotkeys.normalizeAccelerator('CommandOrControl+Alt+1'),
        'CommandOrControl+Alt+1',
    );
});

test('normalizeAccelerator: canonicalises modifier casing', () => {
    assert.strictEqual(skillHotkeys.normalizeAccelerator('ctrl+alt+f'), 'Control+Alt+F');
    assert.strictEqual(skillHotkeys.normalizeAccelerator('cmdOrCtrl+shift+F5'), 'CommandOrControl+Shift+F5');
});

test('normalizeAccelerator: rejects bare key with no modifier', () => {
    assert.throws(() => skillHotkeys.normalizeAccelerator('F'));
});

test('normalizeAccelerator: rejects shift-only bindings', () => {
    assert.throws(() => skillHotkeys.normalizeAccelerator('Shift+A'), /non-shift modifier/);
});

test('normalizeAccelerator: rejects unknown modifiers', () => {
    assert.throws(() => skillHotkeys.normalizeAccelerator('Hyper+A'));
});

test('normalizeAccelerator: rejects duplicate modifiers', () => {
    assert.throws(() => skillHotkeys.normalizeAccelerator('Ctrl+Ctrl+A'), /repeats/);
});

test('normalizeAccelerator: rejects unsupported keys', () => {
    assert.throws(() => skillHotkeys.normalizeAccelerator('Ctrl+Alt+Æ'));
});

test('normalizeAccelerator: accepts named keys', () => {
    assert.strictEqual(skillHotkeys.normalizeAccelerator('Ctrl+Alt+Space'), 'Control+Alt+Space');
    assert.strictEqual(skillHotkeys.normalizeAccelerator('Ctrl+Alt+PageUp'), 'Control+Alt+Pageup');
});

// ─── setAll diffing + persistence ────────────────────────────────────────
test('setAll: registers new bindings and persists them', () => {
    const cfg = tmpConfig();
    const spy = makeSpy();
    skillHotkeys.configure({ configPath: cfg, onHotkeyChange: spy.fn });
    const result = skillHotkeys.setAll([
        { slug: 'foo', accelerator: 'Ctrl+Alt+1' },
        { slug: 'bar', accelerator: 'Ctrl+Alt+2' },
    ]);
    assert.strictEqual(result.registered.length, 2);
    assert.strictEqual(result.skipped.length, 0);
    assert.strictEqual(spy.calls.filter(c => c.action === 'register').length, 2);
    const persisted = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
    const accels = persisted.hotkeys.map(h => h.accelerator).sort();
    assert.deepStrictEqual(accels, ['Control+Alt+1', 'Control+Alt+2']);
});

test('setAll: does NOT churn an unchanged binding', () => {
    const cfg = tmpConfig();
    const spy = makeSpy();
    skillHotkeys.configure({ configPath: cfg, onHotkeyChange: spy.fn });
    skillHotkeys.setAll([{ slug: 'foo', accelerator: 'Ctrl+Alt+1' }]);
    spy.calls.length = 0;
    skillHotkeys.setAll([{ slug: 'foo', accelerator: 'Ctrl+Alt+1' }]);
    assert.deepStrictEqual(spy.calls, []);
});

test('setAll: unregisters slugs that were removed', () => {
    const cfg = tmpConfig();
    const spy = makeSpy();
    skillHotkeys.configure({ configPath: cfg, onHotkeyChange: spy.fn });
    skillHotkeys.setAll([
        { slug: 'foo', accelerator: 'Ctrl+Alt+1' },
        { slug: 'bar', accelerator: 'Ctrl+Alt+2' },
    ]);
    spy.calls.length = 0;
    skillHotkeys.setAll([{ slug: 'foo', accelerator: 'Ctrl+Alt+1' }]);
    assert.deepStrictEqual(spy.calls, [
        { action: 'unregister', slug: 'bar', accelerator: 'Control+Alt+2' },
    ]);
});

test('setAll: re-registers when a slug\'s accelerator changes', () => {
    const cfg = tmpConfig();
    const spy = makeSpy();
    skillHotkeys.configure({ configPath: cfg, onHotkeyChange: spy.fn });
    skillHotkeys.setAll([{ slug: 'foo', accelerator: 'Ctrl+Alt+1' }]);
    spy.calls.length = 0;
    skillHotkeys.setAll([{ slug: 'foo', accelerator: 'Ctrl+Alt+2' }]);
    assert.deepStrictEqual(spy.calls.map(c => c.action), ['unregister', 'register']);
    assert.strictEqual(spy.calls[0].accelerator, 'Control+Alt+1');
    assert.strictEqual(spy.calls[1].accelerator, 'Control+Alt+2');
});

test('setAll: skips invalid entries and continues with valid ones', () => {
    const cfg = tmpConfig();
    const spy = makeSpy();
    skillHotkeys.configure({ configPath: cfg, onHotkeyChange: spy.fn });
    const result = skillHotkeys.setAll([
        { slug: 'valid', accelerator: 'Ctrl+Alt+A' },
        { slug: 'BadSlug', accelerator: 'Ctrl+Alt+B' },       // bad slug
        { slug: 'valid2', accelerator: 'not-an-accel' },      // bad accel
        { slug: 'noshift', accelerator: 'Shift+C' },          // shift only
    ]);
    assert.deepStrictEqual(result.registered.map(r => r.slug), ['valid']);
    assert.strictEqual(result.skipped.length, 3);
    assert.match(result.skipped[0].reason, /invalid slug/);
});

test('setAll: detects duplicate accelerators in the same batch', () => {
    skillHotkeys.configure({ configPath: tmpConfig() });
    const result = skillHotkeys.setAll([
        { slug: 'a', accelerator: 'Ctrl+Alt+1' },
        { slug: 'b', accelerator: 'ctrl+alt+1' }, // duplicate after normalization
    ]);
    assert.deepStrictEqual(result.registered.map(r => r.slug), ['a']);
    assert.match(result.skipped[0].reason, /already bound to "a"/);
});

test('setAll: throws when not configured', () => {
    assert.throws(() => skillHotkeys.setAll([]), /not configured/);
});

test('setAll: rejects non-array input', () => {
    skillHotkeys.configure({ configPath: tmpConfig() });
    assert.throws(() => skillHotkeys.setAll('nope'), /expects an array/);
});

// ─── loadFromDisk ────────────────────────────────────────────────────────
test('loadFromDisk: registers persisted bindings on startup', () => {
    const cfg = tmpConfig();
    fs.writeFileSync(cfg, JSON.stringify({
        hotkeys: [{ slug: 'saved', accelerator: 'Ctrl+Alt+P' }],
    }));
    const spy = makeSpy();
    skillHotkeys.configure({ configPath: cfg, onHotkeyChange: spy.fn });
    const result = skillHotkeys.loadFromDisk();
    assert.deepStrictEqual(result.registered, [{ slug: 'saved', accelerator: 'Control+Alt+P' }]);
    assert.deepStrictEqual(spy.calls, [
        { action: 'register', slug: 'saved', accelerator: 'Control+Alt+P' },
    ]);
});

test('loadFromDisk: no-ops on missing file', () => {
    const cfg = path.join(os.tmpdir(), 'nonexistent-' + Date.now() + '.json');
    skillHotkeys.configure({ configPath: cfg });
    assert.deepStrictEqual(skillHotkeys.loadFromDisk(), { registered: [], skipped: [] });
});

test('loadFromDisk: no-ops on malformed JSON', () => {
    const cfg = tmpConfig();
    fs.writeFileSync(cfg, 'not-json');
    skillHotkeys.configure({ configPath: cfg });
    assert.deepStrictEqual(skillHotkeys.loadFromDisk(), { registered: [], skipped: [] });
});

test('loadFromDisk: skips invalid persisted entries without crashing', () => {
    const cfg = tmpConfig();
    fs.writeFileSync(cfg, JSON.stringify({
        hotkeys: [
            { slug: 'ok', accelerator: 'Ctrl+Alt+G' },
            { slug: 'bad', accelerator: 'Shift+G' }, // shift only — invalid
        ],
    }));
    skillHotkeys.configure({ configPath: cfg });
    const result = skillHotkeys.loadFromDisk();
    assert.deepStrictEqual(result.registered.map(r => r.slug), ['ok']);
    assert.strictEqual(result.skipped.length, 1);
});

// ─── list ────────────────────────────────────────────────────────────────
test('list: reports the currently registered bindings', () => {
    skillHotkeys.configure({ configPath: tmpConfig() });
    assert.deepStrictEqual(skillHotkeys.list(), []);
    skillHotkeys.setAll([{ slug: 'x', accelerator: 'Ctrl+Alt+X' }]);
    assert.deepStrictEqual(skillHotkeys.list(), [{ slug: 'x', accelerator: 'Control+Alt+X' }]);
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
