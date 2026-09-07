/**
 * fs.test.js — sandboxed filesystem tools (fs_read/write/list/move/copy/
 * delete/mkdir/search). Run: node server/automation/tools/fs.test.js
 */

'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the permissions config so we never touch the user's real settings.
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-appdata-'));
process.env.APPDATA = tmpAppData;

const permissions = require('../permissions');
const {
    fsWrite, fsRead, fsList, fsMove, fsCopy, fsDelete, fsMkdir, fsSearch,
} = require('./fs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-root-'));
permissions.save({ fsRoots: [root] });

let passed = 0;
let failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
}
async function asyncTest(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
}

(async () => {
    console.log('fs.test: sandboxed filesystem tools');

    await asyncTest('fs_write + fs_read round-trip', async () => {
        const p = path.join(root, 'a.txt');
        await fsWrite.run({ path: p, content: 'hello' });
        const r = await fsRead.run({ path: p });
        assert.strictEqual(r.content, 'hello');
    });

    await asyncTest('fs_list filters by glob', async () => {
        await fsWrite.run({ path: path.join(root, 'x.js'), content: '1' });
        await fsWrite.run({ path: path.join(root, 'y.txt'), content: '2' });
        const out = await fsList.run({ path: root, glob: '*.js' });
        assert.strictEqual(out.count, 1);
        assert.strictEqual(out.entries[0].name, 'x.js');
    });

    await asyncTest('fs_move renames a file', async () => {
        const from = path.join(root, 'move-me.txt');
        const to = path.join(root, 'sub', 'moved.txt');
        await fsWrite.run({ path: from, content: 'm' });
        const res = await fsMove.run({ from, to });
        assert.strictEqual(res.moved, true);
        assert.ok(!fs.existsSync(from));
        assert.ok(fs.existsSync(to));
    });

    await asyncTest('fs_copy duplicates a file', async () => {
        const from = path.join(root, 'src.txt');
        const to = path.join(root, 'dst.txt');
        await fsWrite.run({ path: from, content: 'copy me' });
        const res = await fsCopy.run({ from, to });
        assert.strictEqual(res.copied, true);
        assert.strictEqual((await fsRead.run({ path: to })).content, 'copy me');
    });

    await asyncTest('fs_mkdir creates a directory', async () => {
        const d = path.join(root, 'nested', 'dir');
        const res = await fsMkdir.run({ path: d });
        assert.strictEqual(res.created, true);
        assert.ok(fs.existsSync(d));
    });

    await asyncTest('fs_delete removes a file', async () => {
        const p = path.join(root, 'gone.txt');
        await fsWrite.run({ path: p, content: 'x' });
        await fsDelete.run({ path: p });
        assert.ok(!fs.existsSync(p));
    });

    await asyncTest('fs_delete requires recursive for a directory', async () => {
        const d = path.join(root, 'deleteme');
        await fsMkdir.run({ path: d });
        await assert.rejects(fsDelete.run({ path: d }), /recursive/);
        await fsDelete.run({ path: d, recursive: true });
        assert.ok(!fs.existsSync(d));
    });

    await asyncTest('fs_search finds files recursively', async () => {
        await fsWrite.run({ path: path.join(root, 'deep', 'report.pdf'), content: 'x' });
        await fsWrite.run({ path: path.join(root, 'deep', 'other.txt'), content: 'x' });
        const out = await fsSearch.run({ path: root, glob: '*.pdf' });
        assert.strictEqual(out.count, 1);
        assert.ok(out.entries[0].path.endsWith('report.pdf'));
    });

    await asyncTest('paths outside fsRoots are rejected', async () => {
        const outside = path.join(os.tmpdir(), 'not-in-sandbox.txt');
        await assert.rejects(fsRead.run({ path: outside }), /outside sandbox/);
        await assert.rejects(fsWrite.run({ path: outside, content: 'x' }), /outside sandbox/);
        await assert.rejects(fsMove.run({ from: outside, to: path.join(root, 'z.txt') }), /outside sandbox/);
        await assert.rejects(fsDelete.run({ path: outside }), /outside sandbox/);
    });

    console.log(`\nfs.test: ${passed}/${passed + failed} PASS`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('fs.test crashed:', e);
    process.exit(1);
});
