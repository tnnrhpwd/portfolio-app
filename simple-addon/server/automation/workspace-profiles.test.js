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
// Default: report back exactly what was requested (a "perfect" apply), so
// existing tests exercise the common case. Tests that need to simulate a
// placement not landing (e.g. an app reasserting its own remembered bounds)
// can override this per-call via windowSetRectResponder.
let windowSetRectResponder = (args) => ({
    pid: args.pid,
    actualX: args.x, actualY: args.y, actualWidth: args.width, actualHeight: args.height, actualState: args.state,
});
const fakeSystem = {
    windowSnapshot: { run: async () => ({ count: fakeWindows.length, windows: fakeWindows }) },
    windowSetRect: {
        run: async (args) => {
            windowSetRectCalls.push(args);
            return windowSetRectResponder(args);
        },
    },
};
let openAppCalls = [];
let openAppResponder = () => ({ windowFound: false });
const fakeOpenApp = {
    openApp: {
        run: async (args) => {
            openAppCalls.push(args);
            return openAppResponder(args);
        },
    },
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

    await testAsync('restore() does not cross-assign two windows that share a processName', async () => {
        // Two VS Code windows for different projects, both "code.exe" — this
        // is the scenario that used to get swapped: matching by processName
        // alone with an arbitrary "first candidate" fallback.
        fakeWindows = [
            { pid: 1, processName: 'code', exePath: 'C:\\code.exe', title: 'index.js - project-alpha - Visual Studio Code', x: 0, y: 0, width: 800, height: 600, state: 'normal' },
            { pid: 2, processName: 'code', exePath: 'C:\\code.exe', title: 'agent.py - vscode-agents - Visual Studio Code', x: 0, y: 0, width: 800, height: 600, state: 'normal' },
        ];
        await workspaceProfiles.save('two-code-windows');

        // Restore against slightly-changed titles (unsaved-changes markers)
        // so neither is an exact match, forcing the similarity scorer to
        // pick the right one instead of falling back to declaration order.
        fakeWindows = [
            { pid: 20, processName: 'code', exePath: 'C:\\code.exe', title: '● agent.py - vscode-agents - Visual Studio Code', x: 5, y: 5, width: 5, height: 5, state: 'normal' },
            { pid: 10, processName: 'code', exePath: 'C:\\code.exe', title: '● index.js - project-alpha - Visual Studio Code', x: 5, y: 5, width: 5, height: 5, state: 'normal' },
        ];
        windowSetRectCalls = [];
        const result = await workspaceProfiles.restore('two-code-windows');
        assert.strictEqual(result.restoredCount, 2);
        assert.strictEqual(result.errorCount, 0);

        const rectForPid = (pid) => windowSetRectCalls.find(c => c.pid === pid);
        // pid 10 (project-alpha window) must get project-alpha's saved rect,
        // and pid 20 (vscode-agents window) must get vscode-agents' saved
        // rect — not swapped.
        assert.strictEqual(rectForPid(10).x, 0);
        assert.strictEqual(rectForPid(20).x, 0);
        assert.notStrictEqual(rectForPid(10), undefined);
        assert.notStrictEqual(rectForPid(20), undefined);

        await workspaceProfiles.remove('two-code-windows');
    });

    await testAsync('restore() does not match windows with a conflicting exePath despite same processName', async () => {
        // Two unrelated apps that happen to share a generic processName
        // (e.g. two different Electron apps both reporting "electron" in
        // dev) must never be paired up just because titles are similar.
        fakeWindows = [
            { pid: 1, processName: 'electron', exePath: 'C:\\AppOne\\electron.exe', title: 'App One', x: 0, y: 0, width: 400, height: 300, state: 'normal' },
        ];
        await workspaceProfiles.save('exe-path-guard');

        fakeWindows = [
            { pid: 99, processName: 'electron', exePath: 'C:\\AppTwo\\electron.exe', title: 'App One (different app)', x: 500, y: 500, width: 200, height: 200, state: 'normal' },
        ];
        windowSetRectCalls = [];
        const result = await workspaceProfiles.restore('exe-path-guard');
        assert.strictEqual(result.restoredCount, 0, 'must not reposition an unrelated app with a conflicting exePath');
        assert.strictEqual(result.skippedCount, 1);
        assert.strictEqual(windowSetRectCalls.length, 0);

        await workspaceProfiles.remove('exe-path-guard');
    });

    await testAsync('save() captures relaunch args from the process command line', async () => {
        fakeWindows = [
            {
                pid: 1, processName: 'Code', exePath: 'C:\\Code\\Code.exe',
                commandLine: '"C:\\Code\\Code.exe" "C:\\Projects\\project-alpha"',
                title: 'project-alpha - Visual Studio Code', x: 0, y: 0, width: 800, height: 600, state: 'normal',
            },
        ];
        const profile = await workspaceProfiles.save('args-capture');
        assert.deepStrictEqual(profile.windows[0].args, ['C:\\Projects\\project-alpha']);
        await workspaceProfiles.remove('args-capture');
    });

    await testAsync('restore() relaunches missing windows with their saved args, adding --new-window when another saved entry shares the exe (so cold-launching both opens two distinct windows instead of collapsing into one)', async () => {
        fakeWindows = [
            {
                pid: 1, processName: 'Code', exePath: 'C:\\Code\\Code.exe',
                commandLine: '"C:\\Code\\Code.exe" "C:\\Projects\\project-alpha"',
                title: 'project-alpha - Visual Studio Code', x: 0, y: 0, width: 800, height: 600, state: 'normal',
            },
            {
                pid: 2, processName: 'Code', exePath: 'C:\\Code\\Code.exe',
                commandLine: '"C:\\Code\\Code.exe" "C:\\Projects\\vscode-agents"',
                title: 'vscode-agents - Visual Studio Code', x: 900, y: 0, width: 800, height: 600, state: 'normal',
            },
        ];
        await workspaceProfiles.save('cold-start-two-code-windows');

        // Nothing running at all — both entries must be launched.
        fakeWindows = [];
        openAppCalls = [];
        openAppResponder = (args) => ({ windowFound: true, pid: (args.argsList || []).some(a => a.includes('alpha')) ? 101 : 102 });
        windowSetRectCalls = [];
        const result = await workspaceProfiles.restore('cold-start-two-code-windows');

        assert.strictEqual(openAppCalls.length, 2, 'both missing windows must be launched');
        for (const call of openAppCalls) {
            assert.ok(Array.isArray(call.argsList) && call.argsList.length === 2, 'each launch must carry its saved folder arg plus --new-window');
            assert.ok(call.argsList.includes('--new-window'), '--new-window must be added since both entries share the same exePath');
        }
        const alphaCall = openAppCalls.find(c => c.argsList.includes('C:\\Projects\\project-alpha'));
        const agentsCall = openAppCalls.find(c => c.argsList.includes('C:\\Projects\\vscode-agents'));
        assert.ok(alphaCall, 'project-alpha entry must be relaunched with its own saved folder arg');
        assert.ok(agentsCall, 'vscode-agents entry must be relaunched with its own saved folder arg, not the alpha one');
        assert.strictEqual(result.launchedCount, 2);
        assert.strictEqual(result.errorCount, 0);

        openAppResponder = () => ({ windowFound: false });
        await workspaceProfiles.remove('cold-start-two-code-windows');
    });

    await testAsync('restore() retries a placement that did not land, then reports success', async () => {
        // Simulates SetWindowPlacement's async call returning before an app
        // (e.g. an Electron app) reasserts its own remembered bounds — the
        // first apply "sticks" to the wrong spot, but a second attempt
        // lands correctly.
        fakeWindows = [
            { pid: 1, processName: 'notepad', exePath: 'C:\\notepad.exe', title: 'Untitled', x: 10, y: 20, width: 300, height: 400, state: 'normal' },
        ];
        await workspaceProfiles.save('retry-then-accurate');

        fakeWindows = [
            { pid: 55, processName: 'notepad', exePath: 'C:\\notepad.exe', title: 'Untitled', x: 0, y: 0, width: 50, height: 50, state: 'normal' },
        ];
        let callCount = 0;
        windowSetRectResponder = (args) => {
            callCount++;
            if (callCount === 1) {
                // First attempt "fails to stick" — reports back the OLD
                // position instead of the requested one.
                return { pid: args.pid, actualX: 0, actualY: 0, actualWidth: 50, actualHeight: 50, actualState: 'normal' };
            }
            return { pid: args.pid, actualX: args.x, actualY: args.y, actualWidth: args.width, actualHeight: args.height, actualState: args.state };
        };
        windowSetRectCalls = [];
        const result = await workspaceProfiles.restore('retry-then-accurate');
        assert.strictEqual(result.restoredCount, 1, 'should succeed after retrying');
        assert.strictEqual(result.inaccurateCount, 0);
        assert.strictEqual(windowSetRectCalls.length, 2, 'must retry once after the first attempt did not land');

        windowSetRectResponder = (args) => ({
            pid: args.pid, actualX: args.x, actualY: args.y, actualWidth: args.width, actualHeight: args.height, actualState: args.state,
        });
        await workspaceProfiles.remove('retry-then-accurate');
    });

    await testAsync('restore() reports a placement as inaccurate when it never lands, instead of falsely claiming success', async () => {
        fakeWindows = [
            { pid: 1, processName: 'notepad', exePath: 'C:\\notepad.exe', title: 'Untitled', x: 10, y: 20, width: 300, height: 400, state: 'normal' },
        ];
        await workspaceProfiles.save('never-lands');

        fakeWindows = [
            { pid: 66, processName: 'notepad', exePath: 'C:\\notepad.exe', title: 'Untitled', x: 0, y: 0, width: 50, height: 50, state: 'normal' },
        ];
        // Every attempt reports back the same wrong position — e.g. the app
        // keeps overriding it — so this must never claim "restored".
        windowSetRectResponder = (args) => ({ pid: args.pid, actualX: 0, actualY: 0, actualWidth: 50, actualHeight: 50, actualState: 'normal' });
        windowSetRectCalls = [];
        const result = await workspaceProfiles.restore('never-lands');
        assert.strictEqual(result.restoredCount, 0, 'must not claim success for a placement that never landed');
        assert.strictEqual(result.inaccurateCount, 1);
        assert.strictEqual(result.inaccurate[0].processName, 'notepad');

        windowSetRectResponder = (args) => ({
            pid: args.pid, actualX: args.x, actualY: args.y, actualWidth: args.width, actualHeight: args.height, actualState: args.state,
        });
        await workspaceProfiles.remove('never-lands');
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
