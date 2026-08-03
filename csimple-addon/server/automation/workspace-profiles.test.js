const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

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
async function testAsync(name, fn) {
    try {
        await fn();
        console.log(`  PASS  ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL  ${name}: ${e.message}`);
        failed++;
    }
}

// workspace-profiles.js requires ./tools/system and ./tools/open-app at load
// time. Stub both BEFORE requiring the module fresh, so save()/restore()
// exercise our fake window list instead of spawning real PowerShell.
const systemPath = require.resolve('./tools/system');
const openAppPath = require.resolve('./tools/open-app');

let fakeWindows = [];
let windowSetRectCalls = [];
const fakeSystem = {
    windowSnapshot: { run: async () => ({ count: fakeWindows.length, windows: fakeWindows }) },
    windowSetRect: { run: async (args) => { windowSetRectCalls.push(args); return { pid: args.pid }; } },
};
const fakeOpenApp = {
    openApp: { run: async () => ({ windowFound: false }) },
};
require.cache[systemPath] = new Module(systemPath);
require.cache[systemPath].exports = fakeSystem;
require.cache[openAppPath] = new Module(openAppPath);
require.cache[openAppPath].exports = fakeOpenApp;
delete require.cache[require.resolve('./workspace-profiles')];
const workspaceProfiles = require('./workspace-profiles');

console.log('workspace-profiles.test');

test('slugify normalizes names', () => {
    assert.strictEqual(workspaceProfiles.slugify('My Coding Setup!'), 'my-coding-setup');
});

test('slugify rejects empty names', () => {
    assert.throws(() => workspaceProfiles.slugify('   '));
});

(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsprofiles-'));
    workspaceProfiles.configure({ storageDir: tmpDir });

    await testAsync('save() captures current windows under the given name', async () => {
        fakeWindows = [
            { pid: 1, processName: 'notepad', exePath: 'C:\\notepad.exe', title: 'Untitled', x: 10, y: 20, width: 300, height: 400, state: 'normal' },
        ];
        const profile = await workspaceProfiles.save('Coding Setup');
        assert.strictEqual(profile.slug, 'coding-setup');
        assert.strictEqual(profile.windows.length, 1);
        assert.strictEqual(profile.windows[0].processName, 'notepad');
    });

    await testAsync('list() returns saved profiles', async () => {
        const entries = await workspaceProfiles.list();
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].name, 'Coding Setup');
        assert.strictEqual(entries[0].windowCount, 1);
    });

    await testAsync('get() returns the full saved profile', async () => {
        const profile = await workspaceProfiles.get('coding-setup');
        assert.strictEqual(profile.name, 'Coding Setup');
        assert.strictEqual(profile.windows[0].x, 10);
    });

    await testAsync('update() re-captures over the existing slug, keeping the display name', async () => {
        fakeWindows = [
            { pid: 1, processName: 'notepad', exePath: 'C:\\notepad.exe', title: 'Untitled', x: 999, y: 888, width: 300, height: 400, state: 'maximized' },
            { pid: 2, processName: 'code', exePath: 'C:\\code.exe', title: 'main.js', x: 0, y: 0, width: 1000, height: 800, state: 'normal' },
        ];
        const updated = await workspaceProfiles.update('coding-setup');
        assert.strictEqual(updated.name, 'Coding Setup');
        assert.strictEqual(updated.windows.length, 2);
        assert.strictEqual(updated.windows[0].x, 999);

        const entries = await workspaceProfiles.list();
        assert.strictEqual(entries.length, 1, 'update() must overwrite, not create a second profile');
    });

    await testAsync('update() throws for a profile that does not exist', async () => {
        await assert.rejects(() => workspaceProfiles.update('does-not-exist'));
    });

    await testAsync('restore() repositions a matching running window', async () => {
        fakeWindows = [
            { pid: 42, processName: 'notepad', exePath: 'C:\\notepad.exe', title: 'Untitled', x: 0, y: 0, width: 100, height: 100, state: 'normal' },
            { pid: 43, processName: 'code', exePath: 'C:\\code.exe', title: 'main.js', x: 0, y: 0, width: 100, height: 100, state: 'normal' },
        ];
        const result = await workspaceProfiles.restore('coding-setup');
        assert.strictEqual(result.restoredCount, 2);
        assert.strictEqual(result.skippedCount, 0);
        assert.strictEqual(result.errorCount, 0);
    });

    await testAsync('restore() skips SetWindowPlacement for windows already in their saved position', async () => {
        // coding-setup was saved (via update() above) as:
        //   notepad: x=999, y=888, w=300, h=400, maximized
        //   code:    x=0,   y=0,   w=1000, h=800, normal
        // Report them as already sitting exactly there.
        fakeWindows = [
            { pid: 42, processName: 'notepad', exePath: 'C:\\notepad.exe', title: 'Untitled', x: 999, y: 888, width: 300, height: 400, state: 'maximized' },
            { pid: 43, processName: 'code', exePath: 'C:\\code.exe', title: 'main.js', x: 0, y: 0, width: 1000, height: 800, state: 'normal' },
        ];
        windowSetRectCalls = [];
        const result = await workspaceProfiles.restore('coding-setup');
        assert.strictEqual(result.restoredCount, 0, 'nothing should need repositioning');
        assert.strictEqual(result.alreadyInPlaceCount, 2);
        assert.strictEqual(result.errorCount, 0);
        assert.strictEqual(windowSetRectCalls.length, 0, 'SetWindowPlacement must not be called when placement already matches (crash-safety guard)');
    });

    await testAsync('remove() deletes the saved profile', async () => {
        await workspaceProfiles.remove('coding-setup');
        const entries = await workspaceProfiles.list();
        assert.strictEqual(entries.length, 0);
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log(`\nworkspace-profiles.test: ${passed}/${passed + failed} PASS`);
    if (failed > 0) process.exit(1);
})();
