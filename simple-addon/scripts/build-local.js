#!/usr/bin/env node
/**
 * build-local.js — cut a LOCAL rev: bump, build, install on this machine only.
 *
 *   npm run build:local
 *   npm run build:local -- --dry-run    → print the rev it would cut, build nothing
 *
 * What this is for: you want to run the change you just made — as a real
 * installed app, not as a dev process — and see exactly which rev it is before
 * anyone else gets it. Nothing here talks to GitHub, tags anything, or pushes
 * anything, so it costs no CI minutes. When you and the human agree it is good,
 * `npm run publish:rev` tags THIS rev and lets CI build it for everyone.
 *
 * The rev rule (why a repeat build does not climb the numbers):
 *   - If the current version is already tagged, it is already published, so this
 *     build takes the NEXT rev (1.0.69 → 1.0.70).
 *   - If it is not tagged yet, the rev stays put — building rev 70 five times
 *     while iterating keeps giving you rev 70, which is what you want to name
 *     when you finally publish.
 *   The bump is committed, so the tree stays clean and `publish:rev` can run
 *   without tripping release.js's clean-tree preflight.
 *
 * The stamp: scripts/write-build-info.js is invoked explicitly. `prebuild` does
 * that for `npm run build:*`, but build-and-install.js calls electron-builder
 * directly (no npm lifecycle), so a build made that way would otherwise ship
 * with no build-info.json and could not tell you it was a local build.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');

const { getRev, incrementRev, maxRev, isPublished } = require('./rev-version');

const ROOT = path.join(__dirname, '..');

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
}

/** Every addon release tag this checkout knows about (offline, no network). */
function publishedTags() {
  try {
    const out = runCapture('git tag -l "addon-v*"');
    return out ? out.split('\n').map((t) => t.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(dryRun
    ? '\n🔎 Simple Addon — local rev build (dry run: nothing is built or changed)\n'
    : '\n🔧 Simple Addon — local rev build\n');

  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(require('fs').readFileSync(pkgPath, 'utf-8'));
  const tags = publishedTags();
  const publishedRev = maxRev(tags);

  let version = pkg.version;
  let rev = getRev(version);
  let bumping = false;

  if (isPublished(version, tags)) {
    version = incrementRev(version);
    rev = getRev(version);
    bumping = true;
    console.log(`  rev ${getRev(pkg.version)} is already published → taking rev ${rev} (v${version})\n`);
  } else {
    console.log(`  staying on rev ${rev} (v${version}) — not published yet, so this is the rev you would ship\n`);
  }

  if (dryRun) {
    console.log(`  (dry run) would ${bumping ? `bump package.json to v${version} and commit it, then ` : ''}stamp build-info (channel=local) and run the build + install.`);
    console.log(`  This build:  rev ${rev}   (local)\n  Published:   rev ${publishedRev || '—'}\n`);
    return;
  }

  if (bumping) {
    const { bumpVersionFiles } = require('./rev-version');
    bumpVersionFiles(version, ROOT);

    // Commit the bump so the working tree stays clean: publish:rev (and
    // release.js) both refuse to run on a dirty tree, and a version bump left
    // uncommitted would block them until it was sorted out by hand.
    run('git add package.json package-lock.json');
    run(`git commit -m "chore: cut local rev ${rev}"`);
  }

  // 1. Stamp this build. The env var is what makes the app able to say
  //    "this copy is a local build" rather than "released".
  console.log('  Stamping build info (channel=local)...');
  run('node scripts/write-build-info.js', {
    env: { ...process.env, SIMPLE_ADDON_CHANNEL: 'local' },
  });

  // 2. Build + install (also stops any running instance first).
  console.log('\n  Building and installing locally (this takes 1-3 minutes)...\n');
  const build = spawnSync('node', ['scripts/build-and-install.js'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) {
    console.error('\n❌ Local build failed — nothing was published, and nothing left this machine.');
    process.exit(build.status ?? 1);
  }

  console.log(`
✅ Local rev ${rev} built and installed  (v${version})

  This build:       rev ${rev}   (local — nobody else has it)
  Published:        rev ${publishedRev || '—'}${publishedRev ? `   (what everyone else is running)` : ''}
  CI cost so far:   none

  Test it. When you agree it is ready to go out to everyone:

      npm run publish:rev

  That tags v${version} and pushes the tag; GitHub Actions then builds and
  publishes it, and every installed addon picks it up automatically.
`);
}

main();
