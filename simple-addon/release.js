#!/usr/bin/env node
/**
 * Simple Addon Release Script
 *
 * Usage:
 *   npm run release        → bump the rev, then publish it
 *   npm run publish:rev    → publish the rev already built and tested locally
 *                            by scripts/build-local.js (no bump)
 *
 * Versioning:
 *   Uses format 1.0.REV where REV is a simple incrementing number — the same
 *   "rev" the dashboard shows and the tray calls "Build #N".
 *   Examples: 1.0.1, 1.0.2, ... 1.0.69, 1.0.70.
 *
 *   The arithmetic lives in scripts/rev-version.js so this script and the local
 *   build script cannot disagree about what rev comes next.
 *
 * What it does:
 *   1. (bump mode) increments the rev in package.json + package-lock.json, and commits it
 *   2. (publish:rev) checks that the rev going out is the one built on this machine
 *   3. Creates a git tag (addon-v{version})
 *   4. Pushes commit + tag to origin
 *   5. GitHub Actions builds the release and publishes it to everyone
 *
 * ⚠️ Both modes spend Windows build minutes and reach every installed addon,
 *    so publish deliberately — see .github/copilot-instructions.md.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { getRev, incrementRev, isPublished, bumpVersionFiles } = require('./scripts/rev-version');

// ─── Helpers ────────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: __dirname, stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: __dirname, encoding: 'utf-8' }).trim();
}

/** Every addon release tag this checkout knows about (offline, no network). */
function addonTags() {
  try {
    const out = runCapture('git tag -l "addon-v*"');
    return out ? out.split('\n').map((t) => t.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** This checkout's record of the last local build (see scripts/build-local.js). */
function readBuildInfo() {
  try {
    const p = path.join(__dirname, 'build-info.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Decide whether the rev going out is the one built and tested here.
 *
 * Pure on purpose — no printing, no exiting — so the publish gate, the one
 * place where a bug means shipping something nobody ran, can be tested directly
 * (see scripts/rev-version.test.js).
 *
 * @param   {string}      version  version about to be published
 * @param   {object|null} info     this checkout's build-info.json, if any
 * @param   {number|null} headMs   HEAD commit time in ms (null when unknown)
 * @returns {{ stop: string|null, notes: string[], problems: string[] }}
 */
function evaluatePublish(version, info, headMs) {
  const notes = [];
  const problems = [];

  if (!info) {
    notes.push('no build-info.json — no record of a local build for this rev (fine if you tested from source)');
    return { stop: null, notes, problems };
  }

  if (info.version !== version) {
    // Positive evidence that what is going out is NOT what was built here.
    return {
      stop: `the last local build was rev ${info.rev ?? '?'} (v${info.version}), but you are publishing v${version}`,
      notes,
      problems,
    };
  }

  notes.push(`local build on record: rev ${info.rev} (v${info.version}), built ${info.builtAt}, channel=${info.channel}`);

  const builtMs = new Date(info.builtAt).getTime();
  if (Number.isFinite(headMs) && Number.isFinite(builtMs) && headMs > builtMs) {
    problems.push('HEAD is newer than that build — CI compiles the CURRENT source, so what ships may include changes the tested copy never had');
  }

  return { stop: null, notes, problems };
}

/** Print the publish decision, and stop the publish on a hard problem. */
function checkWhatWeArePublishing(version) {
  let headMs = null;
  try {
    headMs = parseInt(runCapture('git log -1 --format=%ct'), 10) * 1000;
  } catch {
    headMs = null; // git unavailable — skip the freshness note rather than fail
  }

  const { stop, notes, problems } = evaluatePublish(version, readBuildInfo(), headMs);

  for (const note of notes) console.log(`  · ${note}`);

  if (stop) {
    console.error(`  ✖ Not publishing: ${stop}.`);
    console.error('    Ship the rev you built and tested — `npm run build:local` again, then this.');
    process.exit(1);
  }

  for (const problem of problems) console.log(`  ⚠ ${problem}`);
  console.log('');
}

// ─── Pre-flight Checks ─────────────────────────────────────────────────────────

function preflight() {
  const pkgPath = path.join(__dirname, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('Error: package.json not found. Run this from simple-addon/.');
    process.exit(1);
  }

  // Check for uncommitted changes
  try {
    const status = runCapture('git status --porcelain');
    if (status) {
      console.log('\nUncommitted changes detected:');
      console.log(status);
      console.log('\nCommit or stash your changes first, then run the release script again.');
      process.exit(1);
    }
  } catch {
    console.error('Error: git not found or not in a git repository.');
    process.exit(1);
  }

  try {
    runCapture('git remote get-url origin');
  } catch {
    console.error('Error: No git remote "origin" configured.');
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const publishOnly = process.argv.includes('--publish-current');

  console.log(publishOnly ? '\n📦 Simple Addon — publish the tested rev\n' : '\n🚀 Simple Addon Release\n');

  preflight();

  // 1. Read current version
  const pkgPath = path.join(__dirname, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version;
  const currentRev = getRev(currentVersion);

  let newVersion;
  let newRev;

  if (publishOnly) {
    // 2. Publish exactly what scripts/build-local.js built — do not touch the rev.
    if (isPublished(currentVersion, addonTags())) {
      console.error(`\n✖ v${currentVersion} is already tagged, so rev ${currentRev} is already published.`);
      console.error('  Nothing to publish. Make a change, cut the next rev with `npm run build:local`, then run this again.\n');
      process.exit(1);
    }
    newVersion = currentVersion;
    newRev = currentRev;
    console.log(`  Publishing the rev already built here: rev ${newRev} (v${newVersion})\n`);
    checkWhatWeArePublishing(newVersion);
  } else {
    // 2. Increment build number
    newVersion = incrementRev(currentVersion);
    newRev = getRev(newVersion);
    console.log(`  Build #${currentRev} → Build #${newRev}  (${currentVersion} → ${newVersion})\n`);

    // 3. Update package.json + package-lock.json (shared, tested helper)
    bumpVersionFiles(newVersion, __dirname);

    // 4. Git commit the bump
    console.log('  Committing version bump...');
    run('git add package.json package-lock.json');
    run(`git commit -m "release: Simple Addon Build #${newRev} (v${newVersion})"`);
  }

  // 5. Git tag
  const tag = `addon-v${newVersion}`;
  console.log(`\n  Creating tag: ${tag}`);
  run(`git tag -a ${tag} -m "Simple Addon Build #${newRev}"`);

  // 6. Push
  console.log('\n  Pushing to origin...');
  run('git push origin HEAD');
  run(`git push origin ${tag}`);

  // Done!
  console.log(`
✅ Build #${newRev} published!  (v${newVersion})

  Tag:      ${tag}
  CI:       https://github.com/tnnrhpwd/portfolio-app/actions/workflows/build-addon.yml
  Release:  https://github.com/tnnrhpwd/portfolio-app/releases  (once CI publishes)

  GitHub Actions will build the installer and publish it to portfolio-app releases.
  Running addon installs will pick it up automatically.
${
  publishOnly
    ? `\n  This is the copy that was installed here as rev ${newRev}, so what went out is what was tested.\n`
    : ''}`);
}

if (require.main === module) main();

module.exports = { addonTags, readBuildInfo, evaluatePublish, checkWhatWeArePublishing };
