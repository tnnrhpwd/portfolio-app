/**
 * write-build-info.js — Stamps the current build with a real UTC timestamp
 * *before* electron-builder packages it, and bundles it into the app as
 * build-info.json (added to the "files" list in package.json's build config).
 *
 * Why this exists: electron-updater's auto-update check only compares
 * semver version numbers. If a release ever gets published under a version
 * number that was already baked into an earlier build (e.g. the version in
 * package.json wasn't bumped before tagging a release), the check correctly
 * — but unhelpfully — reports "up to date" even though the code differs,
 * since there's nothing higher to compare against. auto-updater.js uses this
 * file's `builtAt` timestamp as a secondary signal: if a release's own
 * `releaseDate` is newer than what's actually running, despite the version
 * check saying otherwise, that's a strong sign the version bump was missed
 * and the build/release process itself should be double-checked.
 */

const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const outPath = path.join(__dirname, '..', 'build-info.json');

const info = {
  version: pkg.version,
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(outPath, JSON.stringify(info, null, 2) + '\n', 'utf-8');
console.log(`[write-build-info] Wrote ${outPath}:`, info);
