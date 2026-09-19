/**
 * update-bridge.test.js — the payload the dashboard's Updates tab reads.
 *
 * Run: node server/update-bridge.test.js
 *
 * This is where "this build" (rev + channel) meets "published online" (the newest
 * release the updater has seen). The distinction it protects: a local build can be
 * AHEAD of the published rev, and `updateInfo` is null in exactly that case, so
 * deriving the published rev from `updateInfo` alone would show nothing at the
 * moment the readout matters most.
 *
 * The module is deliberately loadable without Electron — that is why it reads
 * build-info.js rather than auto-updater.js.
 */

'use strict';

const assert = require('assert');

const updateBridge = require('./update-bridge');
const { getRev } = require('../scripts/rev-version');

const CURRENT = require('../package.json').version;

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
}

/** A stand-in for auto-updater.js's UpdateManager — only the fields the bridge reads. */
function fakeManager(overrides = {}) {
    return {
        status: 'up-to-date',
        updateAvailable: false,
        updateDownloaded: false,
        downloadProgress: 0,
        updateInfo: null,
        possibleStaleVersion: false,
        ownBuildInfo: null,
        publishedInfo: null,
        ...overrides,
    };
}

console.log('update-bridge.test: update status payload');

test('with no updater configured the build still describes itself', () => {
    updateBridge.configure({ updateManager: null });
    const s = updateBridge.getStatus();
    assert.strictEqual(s.supported, false);
    assert.strictEqual(s.state, 'unsupported');
    assert.strictEqual(s.currentVersion, CURRENT);
    assert.strictEqual(s.rev, getRev(CURRENT));
    assert.ok(['local', 'release', 'dev'].includes(s.channel), `unexpected channel ${s.channel}`);
    // No manager means no update check has run, so there is nothing published to report.
    assert.strictEqual(s.publishedVersion, null);
    assert.strictEqual(s.publishedRev, null);
});

test('a local build ahead of the published rev reports both revs', () => {
    updateBridge.configure({
        updateManager: fakeManager({
            ownBuildInfo: { version: CURRENT, rev: getRev(CURRENT), channel: 'local', builtAt: '2026-09-19T18:00:00.000Z' },
            // The case that matters: nothing newer is published, so updateInfo is null
            // while the updater still knows the latest release.
            updateInfo: null,
            publishedInfo: { version: '1.0.1', releaseDate: '2026-09-19T17:00:00.000Z' },
        }),
    });
    const s = updateBridge.getStatus();
    assert.strictEqual(s.channel, 'local');
    assert.strictEqual(s.rev, getRev(CURRENT));
    assert.strictEqual(s.publishedRev, 1);
    assert.strictEqual(s.publishedVersion, '1.0.1');
    assert.strictEqual(s.publishedAt, '2026-09-19T17:00:00.000Z');
    assert.strictEqual(s.latestVersion, null, 'no update is available, so latestVersion stays null');
    assert.ok(s.rev > s.publishedRev, 'this build should read as ahead of the published rev');
});

test('a published release newer than this build is reported as such', () => {
    const newer = `1.0.${getRev(CURRENT) + 1}`;
    updateBridge.configure({
        updateManager: fakeManager({
            status: 'ready',
            updateDownloaded: true,
            updateInfo: { version: newer },
            publishedInfo: { version: newer, releaseDate: '2026-09-20T09:00:00.000Z' },
        }),
    });
    const s = updateBridge.getStatus();
    assert.strictEqual(s.publishedRev, getRev(CURRENT) + 1);
    assert.strictEqual(s.latestVersion, newer);
    assert.ok(s.publishedRev > s.rev, 'published rev should be ahead of this build');
});

test('an update check that never reported a release leaves published blank', () => {
    updateBridge.configure({ updateManager: fakeManager({ publishedInfo: null }) });
    const s = updateBridge.getStatus();
    assert.strictEqual(s.publishedVersion, null);
    assert.strictEqual(s.publishedRev, null);
    assert.strictEqual(s.rev, getRev(CURRENT), 'the local rev must still be reported');
});

test('a stamped build reports its channel and builtAt', () => {
    updateBridge.configure({
        updateManager: fakeManager({
            ownBuildInfo: { version: CURRENT, rev: getRev(CURRENT), channel: 'release', builtAt: '2026-09-19T12:00:00.000Z' },
        }),
    });
    const s = updateBridge.getStatus();
    assert.strictEqual(s.channel, 'release');
    assert.strictEqual(s.builtAt, '2026-09-19T12:00:00.000Z');
});

test('the existing UI fields survive', () => {
    updateBridge.configure({ updateManager: fakeManager({ status: 'downloading', downloadProgress: 42 }) });
    const s = updateBridge.getStatus();
    assert.strictEqual(s.supported, true);
    assert.strictEqual(s.state, 'downloading');
    assert.strictEqual(s.downloadProgress, 42);
    assert.strictEqual(s.currentVersion, CURRENT);
    assert.strictEqual(s.possibleStaleVersion, false);
});

test('driving the updater without one configured throws, not silently no-ops', () => {
    updateBridge.configure({ updateManager: null });
    assert.throws(() => updateBridge.checkForUpdates(), /not initialized/);
    assert.throws(() => updateBridge.installUpdate(), /not initialized/);
});

updateBridge.configure({ updateManager: null });

console.log(`\nupdate-bridge.test: ${passed}/${passed + failed} PASS`);
process.exit(failed === 0 ? 0 : 1);
