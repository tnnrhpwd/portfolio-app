/**
 * paths.test.js — canonicalisation + containment for the sandbox guards.
 *
 * Run: node server/automation/paths.test.js
 *
 * This is the regression net for a bug that lived only on CI: the addon's
 * `Simple Addon Tests + Eval` job failed two scenarios on EVERY push for
 * months while `npm run eval` was green locally, because a GitHub runner's
 * `%TEMP%` is the 8.3 short form `C:\Users\RUNNER~1\…` and the sandbox
 * compared it, as a string, against the long root `C:\Users\runneradmin`.
 *
 * `C:\PROGRA~1` vs `C:\Program Files` is the same mechanism, and it exists on
 * every Windows box — so the case can be reproduced (and the fix verified)
 * without paying for a Windows runner. That is the whole point: verify here,
 * not there.
 */

'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the permissions config so we never touch the user's real settings.
const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-test-appdata-'));
process.env.APPDATA = tmpAppData;

const permissions = require('./permissions');
const paths = require('./paths');
const { fsWrite } = require('./tools/fs');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
    try { fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failed++; }
}
function skip(name, why) {
    console.log(`  SKIP  ${name} — ${why}`); skipped++;
}

/** Create a directory alias (junction on Windows, dir symlink elsewhere). */
function makeAlias(target, linkPath) {
    try {
        fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
        return true;
    } catch {
        return false;
    }
}

// The sandbox the fs-tool assertions run against.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-test-sandbox-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-test-outside-'));

(async () => {
    console.log('paths.test: canonicalisation + sandbox containment');

    // ── separator-aware containment ───────────────────────────────────────
    test('a sibling sharing a name prefix is NOT inside the root', () => {
        assert.strictEqual(paths.sameOrInside(path.join('C:', 'root2', 'a'), path.join('C:', 'root')), false);
        assert.strictEqual(paths.sameOrInside(path.join('C:', 'rooted', 'a'), path.join('C:', 'root')), false);
    });

    test('the root itself, and anything under it, IS inside', () => {
        const root = path.join('C:', 'root');
        assert.strictEqual(paths.sameOrInside(root, root), true);
        assert.strictEqual(paths.sameOrInside(path.join(root, 'a', 'b'), root), true);
    });

    test('isWithin accepts any of several roots', () => {
        const roots = [path.join('C:', 'a'), path.join('C:', 'b')];
        assert.strictEqual(paths.isWithin(path.join('C:', 'b', 'x'), roots), true);
        assert.strictEqual(paths.isWithin(path.join('C:', 'c', 'x'), roots), false);
    });

    // ── case sensitivity follows the platform ─────────────────────────────
    test('case handling matches the filesystem (insensitive on Windows)', () => {
        const upper = path.join('C:', 'Users', 'Someone', 'Docs');
        const lower = path.join('c:', 'users', 'someone', 'docs');
        assert.strictEqual(paths.sameOrInside(lower, upper), paths.IS_WINDOWS);
    });

    test('a differently-cased real path resolves inside its root', () => {
        const mixed = path.join(sandbox, 'MixedCaseDir');
        fs.mkdirSync(mixed, { recursive: true });
        const real = paths.canonicalForWrite(path.join(mixed, 'file.txt'));
        assert.strictEqual(paths.isWithin(real, paths.canonicalRoots([sandbox.toUpperCase()])), true);
    });

    // ── Windows 8.3 short names — the exact CI failure ────────────────────
    const shortName = 'C:\\PROGRA~1';
    const longName = 'C:\\Program Files';
    const hasShortName = process.platform === 'win32' && fs.existsSync(shortName);

    if (!hasShortName) {
        skip('8.3 short name is expanded to its long form', 'no C:\\PROGRA~1 on this box');
        skip('a short-name path is accepted inside its long-form root (CI failure)', 'no C:\\PROGRA~1 on this box');
    } else {
        test('8.3 short name is expanded to its long form', () => {
            assert.strictEqual(paths.canonicalExisting(shortName), longName);
        });

        test('a short-name path is accepted inside its long-form root (CI failure)', () => {
            // This is scenario 05/09's shape: %TEMP% arrives short, the root is long.
            const target = paths.canonicalForWrite(path.join(shortName, 'probe.txt'));
            assert.strictEqual(target.startsWith(longName), true,
                `expected the short name to expand, got ${target}`);
            assert.strictEqual(paths.isWithin(target, paths.canonicalRoots([longName])), true);
        });
    }

    // ── directory aliases (junction/symlink) ──────────────────────────────
    const alias = path.join(outside, 'alias-inside');
    if (!makeAlias(sandbox, alias)) {
        skip('an alias outside the root pointing inside it is allowed', 'cannot create a directory alias here');
    } else {
        test('an alias outside the root pointing inside it is allowed', () => {
            // Textually outside `sandbox`, really a second name for it: the sandbox
            // must judge the target, not the spelling.
            const target = paths.canonicalForWrite(path.join(alias, 'inside.txt'));
            assert.strictEqual(paths.isWithin(target, paths.canonicalRoots([sandbox])), true);
        });
    }

    // ── the security half: an alias must not grant escape ─────────────────
    const escape = path.join(sandbox, 'escape');
    if (!makeAlias(outside, escape)) {
        skip('a write through an escaping alias is rejected', 'cannot create a directory alias here');
    } else {
        permissions.save({ fsRoots: [sandbox] });

        test('a canonicalised alias target outside the root is NOT within it', () => {
            const target = paths.canonicalForWrite(path.join(escape, 'evil.txt'));
            assert.strictEqual(paths.isWithin(target, paths.canonicalRoots([sandbox])), false,
                `alias escaped the sandbox: ${target}`);
        });

        await (async () => {
            try {
                await fsWrite.run({ path: path.join(escape, 'evil.txt'), content: 'nope' });
                console.log('  FAIL  a write through an escaping alias is rejected: write succeeded');
                failed++;
            } catch (e) {
                const ok = /outside sandbox/.test(e.message);
                console.log(`  ${ok ? 'PASS' : 'FAIL'}  a write through an escaping alias is rejected${ok ? '' : `: unexpected error ${e.message}`}`);
                ok ? passed++ : failed++;
            }
        })();
    }

    // ── canonicalRoots ────────────────────────────────────────────────────
    test('canonicalRoots de-duplicates case variants and keeps missing roots', () => {
        const absent = path.join(os.tmpdir(), 'paths-test-absent-\u0000none');
        const roots = paths.canonicalRoots([sandbox, sandbox.toUpperCase(), absent]);
        const normalised = roots.map((r) => paths.fold(r));
        assert.strictEqual(new Set(normalised).size, roots.length, 'expected no duplicate roots');
        assert.ok(roots.length >= 1);
    });

    test('canonicalForWrite resolves the parent of a not-yet-existing file', () => {
        const target = paths.canonicalForWrite(path.join(sandbox, 'new', 'deep.txt'));
        assert.strictEqual(paths.isWithin(target, paths.canonicalRoots([sandbox])), true);
        assert.ok(target.endsWith('deep.txt'));
    });

    // ── cleanup ───────────────────────────────────────────────────────────
    try { fs.rmSync(escape, { force: true, recursive: false }); } catch { /* not a link */ }
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(tmpAppData, { recursive: true, force: true }); } catch { /* best effort */ }

    console.log(`\npaths.test: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
    process.exit(failed ? 1 : 0);
})();
