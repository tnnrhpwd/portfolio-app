const assert = require('assert');
const {
    normalizeWaitArgs,
    buildWaitForScript,
    parseWaitForOutput,
} = require('./wait-for');

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

console.log('wait-for.test: normalizeWaitArgs / buildWaitForScript / parseWaitForOutput');

// ── normalizeWaitArgs ──

test('windowTitle normalizes with defaults', () => {
    const o = normalizeWaitArgs({ windowTitle: 'Save As' });
    assert.strictEqual(o.windowTitle, 'Save As');
    assert.strictEqual(o.processName, null);
    assert.strictEqual(o.timeoutMs, 10_000);
    assert.strictEqual(o.pollMs, 250);
    assert.strictEqual(o.optional, false);
});

test('processName normalizes and trims', () => {
    const o = normalizeWaitArgs({ processName: '  minecraft ' });
    assert.strictEqual(o.processName, 'minecraft');
    assert.strictEqual(o.windowTitle, null);
});

test('requires windowTitle or processName', () => {
    assert.throws(() => normalizeWaitArgs({}), /requires either windowTitle or processName/);
    assert.throws(() => normalizeWaitArgs({ timeoutMs: 1000 }), /requires either windowTitle or processName/);
});

test('rejects both windowTitle and processName', () => {
    assert.throws(
        () => normalizeWaitArgs({ windowTitle: 'x', processName: 'y' }),
        /accepts only one of windowTitle or processName/,
    );
});

test('clamps timeoutMs and pollMs to bounds', () => {
    const hi = normalizeWaitArgs({ processName: 'p', timeoutMs: 999_999, pollMs: 999_999 });
    assert.strictEqual(hi.timeoutMs, 60_000);
    assert.strictEqual(hi.pollMs, 2_000);
    const lo = normalizeWaitArgs({ processName: 'p', timeoutMs: -5, pollMs: 1 });
    assert.strictEqual(lo.timeoutMs, 0);
    assert.strictEqual(lo.pollMs, 50);
});

test('optional defaults false, honored when true', () => {
    assert.strictEqual(normalizeWaitArgs({ processName: 'p' }).optional, false);
    assert.strictEqual(normalizeWaitArgs({ processName: 'p', optional: true }).optional, true);
});

// ── buildWaitForScript ──

test('script embeds the window-title needle', () => {
    const s = buildWaitForScript(normalizeWaitArgs({ windowTitle: 'Save As', timeoutMs: 5000, pollMs: 100 }));
    assert.ok(s.includes('"windowTitle":"Save As"'), 'config JSON should carry the needle');
    assert.ok(s.includes('Get-WaitWindow -Needle'), 'should use the EnumWindows title matcher');
    assert.ok(s.includes('Start-Sleep -Milliseconds ([int]$cfg.pollMs)'), 'should poll on an interval');
});

test('script embeds process-name polling branch', () => {
    const s = buildWaitForScript(normalizeWaitArgs({ processName: 'notepad', timeoutMs: 3000 }));
    assert.ok(s.includes('"processName":"notepad"'));
    assert.ok(s.includes('ProcessName -ieq'), 'should match process name case-insensitively');
});

test('script escapes single quotes in the needle (no injection)', () => {
    const s = buildWaitForScript(normalizeWaitArgs({ windowTitle: "O'Brien's Report" }));
    // JSON.stringify does NOT escape single quotes, so the needle's `'` would
    // break out of the single-quoted PS string unless doubled. buildWaitForScript
    // replaces `'` -> `''` (PowerShell's single-quoted-string escape), so the
    // doubled form must be present and the raw single-quoted form must NOT.
    assert.ok(s.includes("O''Brien''s Report"), 'doubled-quote (escaped) needle should be present');
    assert.ok(!s.includes("O'Brien's Report"), 'raw single-quoted needle must not survive unescaped');
});

test('script is ASCII-only (safe for -File without BOM)', () => {
    const s = buildWaitForScript(normalizeWaitArgs({ windowTitle: 'plain ascii', timeoutMs: 100 }));
    for (let i = 0; i < s.length; i++) {
        assert.ok(s.charCodeAt(i) <= 0x7f, `non-ASCII char at index ${i}`);
    }
});

// ── parseWaitForOutput ──

test('parses a JSON object result', () => {
    const r = parseWaitForOutput({ found: true, matched: 'Save As - Notepad', elapsedMs: 1234, timeoutMs: 10000 });
    assert.strictEqual(r.found, true);
    assert.strictEqual(r.matched, 'Save As - Notepad');
    assert.strictEqual(r.elapsedMs, 1234);
    assert.strictEqual(r.timeoutMs, 10000);
});

test('parses a JSON string result', () => {
    const r = parseWaitForOutput('{"found":false,"matched":"","elapsedMs":10000,"timeoutMs":10000}');
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.elapsedMs, 10000);
});

test('handles empty stdout', () => {
    const r = parseWaitForOutput('');
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.elapsedMs, 0);
});

test('handles non-JSON stdout without throwing', () => {
    const r = parseWaitForOutput('some raw error text');
    assert.strictEqual(r.found, false);
    assert.strictEqual(r.raw, 'some raw error text');
});

console.log(`\nwait-for.test: ${passed}/${passed + failed} PASS`);
if (failed > 0) process.exit(1);
