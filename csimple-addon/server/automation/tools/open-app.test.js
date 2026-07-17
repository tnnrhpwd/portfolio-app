const assert = require('assert');
const { buildLaunchHintCandidates } = require('./open-app');

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

console.log('open-app.test: buildLaunchHintCandidates');

test('returns input name first', () => {
    const out = buildLaunchHintCandidates('notepad.exe');
    assert.strictEqual(out[0], 'notepad.exe');
});

test('includes minecraft launcher/protocol aliases', () => {
    const out = buildLaunchHintCandidates('minecraft.exe');
    assert.ok(out.includes('MinecraftLauncher.exe'));
    assert.ok(out.includes('minecraft://'));
});

test('de-dupes aliases', () => {
    const out = buildLaunchHintCandidates('MinecraftLauncher.exe');
    const unique = new Set(out);
    assert.strictEqual(unique.size, out.length);
});

console.log(`\nopen-app.test: ${passed}/${passed + failed} PASS`);
if (failed > 0) process.exit(1);

