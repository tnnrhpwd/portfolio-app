/**
 * rev-version.js — the addon's rev (= build) numbering, in one place.
 *
 * A rev IS the third component of the semver in package.json: 1.0.69 → rev 69.
 * That number is what everything user-facing already says — the tray
 * notification ("Build #69"), the release title, the releases page — so the
 * scripts and the UI must agree on it. `release.js` owned this arithmetic by
 * itself until local builds (scripts/build-local.js) needed the same rules.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '..');

/** The rev inside a version string: '1.0.69' → 69. Unknown input → 0. */
function getRev(version) {
  const parts = String(version || '').split('.');
  const rev = parseInt(parts[2] || '0', 10);
  return Number.isFinite(rev) ? rev : 0;
}

/** Next rev: '1.0.69' → '1.0.70'. Only the rev moves; major/minor are fixed. */
function incrementRev(version) {
  const parts = String(version).split('.');
  return `${parts[0]}.${parts[1]}.${getRev(version) + 1}`;
}

/**
 * The version inside a tag name ('addon-v1.0.69' → '1.0.69'), or null if the
 * string carries no x.y.z at all.
 */
function versionOf(tag) {
  const m = String(tag || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/**
 * Highest rev in a list of tags. Numeric, not lexicographic — 'addon-v1.0.69'
 * beats 'addon-v1.0.7', which a string sort gets backwards.
 */
function maxRev(tags) {
  let max = 0;
  for (const tag of tags || []) {
    const version = versionOf(tag);
    if (version) max = Math.max(max, getRev(version));
  }
  return max;
}

/**
 * Is this exact version already tagged — i.e. already published to everyone?
 *
 * The comparison is on the WHOLE version, never a substring: a prefix test
 * would call '1.0.6' published just because 'addon-v1.0.69' exists, and the
 * build script would then refuse to bump a rev it should have bumped.
 */
function isPublished(version, tags) {
  const want = versionOf(version) || String(version);
  return (tags || []).some((tag) => versionOf(tag) === want);
}

/** The version currently recorded in package.json. */
function readVersion(rootDir = DEFAULT_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')).version;
}

/**
 * Write `version` into package.json AND package-lock.json — both the top-level
 * `version` and `packages[''].version`.
 *
 * The lock file matters: an out-of-step lock makes `npm ci` (which every CI job
 * runs) resolve the old version, and electron-builder reads package.json, so the
 * two disagreeing is exactly how a build ends up stamped with the wrong rev.
 *
 * @returns {string[]} the files actually written
 */
function bumpVersionFiles(version, rootDir = DEFAULT_ROOT) {
  const written = [];

  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  written.push(pkgPath);

  const lockPath = path.join(rootDir, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      lock.version = version;
      if (lock.packages && lock.packages['']) lock.packages[''].version = version;
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
      written.push(lockPath);
    } catch {
      // A malformed lock is not worth failing a build over — npm regenerates it.
    }
  }

  return written;
}

module.exports = {
  getRev,
  incrementRev,
  versionOf,
  maxRev,
  isPublished,
  readVersion,
  bumpVersionFiles,
};
