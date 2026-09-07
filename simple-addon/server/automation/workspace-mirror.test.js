/**
 * workspace-mirror.test.js — unit tests for the local Markdown mirror
 * (OpenClaw-style local-first memory export).
 *
 * Run: node server/automation/workspace-mirror.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mirrorWorkspace } = require('./workspace-mirror');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}`); console.log(`        ${e.message}`); failed++; }
}
async function asyncTest(name, fn) {
    try { await fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}`); console.log(`        ${e.message}`); failed++; }
}

function makeWs(entriesByKind = {}) {
    return {
        async listWorkspaceItems(kind) { return { entries: entriesByKind[kind] || [] }; },
        async getWorkspaceItem(kind, slug) {
            const e = (entriesByKind[kind] || []).find((x) => x.slug === slug);
            return e ? { ...e, content: e._content } : null;
        },
    };
}

(async () => {
    console.log('\nworkspace-mirror.test: local Markdown mirror');

    await asyncTest('mirrors items into <kind>/<slug>.md with content + front matter', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmirror-'));
        const ws = makeWs({
            core: [{ slug: 'user', name: 'User', _content: 'Name: Tan' }],
            skill: [{ slug: 'open-notepad', name: 'Open Notepad', _content: '{"steps":[]}' }],
        });
        const out = await mirrorWorkspace({ wsClient: ws, dir, kinds: ['core', 'skill'] });
        assert.ok(out.files.length >= 2, 'two files written');
        const coreFile = path.join(dir, 'core', 'user.md');
        assert.ok(fs.existsSync(coreFile), 'core/user.md exists');
        const content = fs.readFileSync(coreFile, 'utf-8');
        assert.ok(content.includes('Name: Tan'), 'content included');
        assert.ok(content.includes('kind: core'), 'front matter included');
    });

    await asyncTest('list failures are counted, not thrown', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmirror-'));
        const ws = {
            async listWorkspaceItems() { throw new Error('signed out'); },
            async getWorkspaceItem() { throw new Error('n/a'); },
        };
        const out = await mirrorWorkspace({ wsClient: ws, dir, kinds: ['core'] });
        assert.strictEqual(out.errors, 1, 'one list error');
        assert.strictEqual(out.files.length, 0, 'no files');
    });

    await asyncTest('writes an index README', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmirror-'));
        await mirrorWorkspace({ wsClient: makeWs({}), dir, kinds: ['core'] });
        assert.ok(fs.existsSync(path.join(dir, 'README.md')), 'README exists');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
