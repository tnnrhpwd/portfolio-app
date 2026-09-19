/**
 * paths.js — Windows-correct path canonicalisation + containment.
 *
 * The sandbox guards (`tools/fs.js`, `tools/shell.js`) decide whether a path
 * may be touched by comparing ONE resolved path against `permissions.fsRoots`.
 * Two Windows quirks make a plain `path.resolve` + `startsWith` comparison
 * wrong, and neither one reproduces on a developer machine — which is how they
 * survived: the tests that caught them only ran on CI.
 *
 *   1. 8.3 short names. A GitHub Windows runner's `%TEMP%` is
 *      `C:\Users\RUNNER~1\AppData\Local\Temp` while `os.homedir()` (the default
 *      root) is the long `C:\Users\runneradmin`. Node's JS `realpathSync`
 *      resolves one component at a time and KEEPS the name it was handed, so
 *      the short path survives it. Only the OS-level call
 *      (`fs.realpathSync.native`) returns the long form the root is written as.
 *      Result: `${TEMP}` was rejected with "cwd outside allowed roots" on CI
 *      and accepted everywhere else — two eval scenarios failed on every push
 *      for months while `npm run eval` was green locally.
 *   2. Case. Windows paths are case-insensitive, so `c:\users\x` and
 *      `C:\Users\X` are the same directory but not string-equal.
 *
 * So: canonicalise with `canonicalExisting` / `canonicalForWrite`, then ask
 * `isWithin` / `sameOrInside`. Never compare paths with a bare `startsWith`
 * against a separator — that is the bug this module exists to prevent.
 *
 * Regression net: `paths.test.js` (runs in `npm run test:unit`), which builds
 * both cases on any machine with a directory junction.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';

/**
 * Canonical form of an EXISTING path: symlinks/junctions resolved, 8.3 short
 * names expanded, on-disk case restored.
 *
 * @param   {string}      p
 * @returns {string|null} null when the path does not exist / cannot be resolved
 */
function canonicalExisting(p) {
    if (!p || typeof p !== 'string') return null;
    const abs = path.resolve(p);
    try {
        // `.native` is the OS call (GetFinalPathNameByHandle on Windows) and the
        // only variant that expands 8.3 names and restores case. The JS
        // implementation resolves symlinks per component but echoes back the
        // spelling it was given, which is exactly the failure mode above.
        if (typeof fs.realpathSync.native === 'function') return fs.realpathSync.native(abs);
        return fs.realpathSync(abs);
    } catch {
        return null;
    }
}

/**
 * Canonical form of a path that may not exist yet (a write target): the nearest
 * existing ancestor is canonicalised and the missing tail re-appended, so a
 * symlinked/junctioned PARENT cannot redirect a write outside the sandbox.
 *
 * @throws {Error} when no ancestor can be resolved (caller turns this into a
 *                 sandbox rejection rather than a confusing ENOENT later)
 */
function canonicalForWrite(p) {
    if (!p || typeof p !== 'string') throw new Error('path is required');
    const abs = path.resolve(p);

    const direct = canonicalExisting(abs);
    if (direct) return direct;

    let ancestor = path.dirname(abs);
    const missing = [];
    while (ancestor !== path.dirname(ancestor) && !fs.existsSync(ancestor)) {
        missing.unshift(path.basename(ancestor));
        ancestor = path.dirname(ancestor);
    }

    const realAncestor = canonicalExisting(ancestor);
    if (!realAncestor) throw new Error(`unresolvable path: ${abs}`);
    return path.join(realAncestor, ...missing, path.basename(abs));
}

/** Comparison form: case-folded on Windows only (POSIX paths are case-sensitive). */
function fold(p) {
    return IS_WINDOWS ? String(p).toLowerCase() : String(p);
}

/**
 * True when `child` IS `root` or sits inside it. Separator-aware, so `C:\root2`
 * is not "inside" `C:\root`.
 */
function sameOrInside(child, root) {
    const r = fold(root);
    const c = fold(child);
    if (c === r) return true;
    return c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** True when `child` sits inside ANY of `roots`. */
function isWithin(child, roots) {
    return (roots || []).some((r) => sameOrInside(child, r));
}

/**
 * Canonicalise configured roots. Tolerant of a root that does not exist yet
 * (it keeps its resolved form) and de-duplicates case variants, so a config
 * holding both `C:\Data` and `c:\data` yields one root.
 */
function canonicalRoots(roots) {
    const out = [];
    for (const r of roots || []) {
        if (!r || typeof r !== 'string') continue;
        const c = canonicalExisting(r) || path.resolve(r);
        if (!out.some((x) => fold(x) === fold(c))) out.push(c);
    }
    return out;
}

module.exports = {
    IS_WINDOWS,
    canonicalExisting,
    canonicalForWrite,
    canonicalRoots,
    sameOrInside,
    isWithin,
    fold,
};
