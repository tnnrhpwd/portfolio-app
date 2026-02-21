#!/usr/bin/env node
/**
 * CSimple Addon Release Script
 *
 * Usage:
 *   npm run release          → increments build number (1.0.1 → 1.0.2 → 1.0.3 ...)
 *
 * Versioning:
 *   Uses format 1.0.BUILD where BUILD is a simple incrementing number.
 *   Each release is +1 from the last, making it easy for users to see
 *   exactly how many updates have been released.
 *
 *   Examples: 1.0.1, 1.0.2, 1.0.3, ... 1.0.50, 1.0.51, ...
 *
 * What it does:
 *   1. Increments the build number in package.json (and package-lock.json)
 *   2. Commits the version bump
 *   3. Creates a git tag (addon-v{version})
 *   4. Pushes commit + tag to origin
 *   5. GitHub Actions builds the release automatically
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Helpers ────────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: __dirname, stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: __dirname, encoding: 'utf-8' }).trim();
}

/**
 * Increment the build number: 1.0.N → 1.0.(N+1)
 */
function incrementVersion(current) {
  const parts = current.split('.');
  const build = parseInt(parts[2] || '0', 10) + 1;
  return `${parts[0]}.${parts[1]}.${build}`;
}

/**
 * Extract the build number from a version string.
 * "1.0.15" → 15
 */
function getBuildNumber(version) {
  return parseInt(version.split('.')[2] || '0', 10);
}

// ─── Pre-flight Checks ─────────────────────────────────────────────────────────

function preflight() {
  const pkgPath = path.join(__dirname, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('Error: package.json not found. Run this from csimple-addon/.');
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
  console.log('\n🚀 CSimple Addon Release\n');

  preflight();

  // 1. Read current version
  const pkgPath = path.join(__dirname, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version;
  const currentBuild = getBuildNumber(currentVersion);

  // 2. Increment build number
  const newVersion = incrementVersion(currentVersion);
  const newBuild = getBuildNumber(newVersion);
  console.log(`  Build #${currentBuild} → Build #${newBuild}  (${currentVersion} → ${newVersion})\n`);

  // 3. Update package.json
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

  // 4. Update package-lock.json if it exists
  const lockPath = path.join(__dirname, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      lock.version = newVersion;
      if (lock.packages && lock.packages['']) {
        lock.packages[''].version = newVersion;
      }
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
    } catch {
      // Not critical
    }
  }

  // 5. Git commit
  const tag = `addon-v${newVersion}`;
  console.log('  Committing version bump...');
  run('git add package.json package-lock.json');
  run(`git commit -m "release: CSimple Addon Build #${newBuild} (v${newVersion})"`);

  // 6. Git tag
  console.log(`\n  Creating tag: ${tag}`);
  run(`git tag -a ${tag} -m "CSimple Addon Build #${newBuild}"`);

  // 7. Push
  console.log('\n  Pushing to origin...');
  run('git push origin HEAD');
  run(`git push origin ${tag}`);

  // Done!
  console.log(`
✅ Build #${newBuild} released!  (v${newVersion})

  Tag:      ${tag}
  CI:       https://github.com/tnnrhpwd/portfolio-app/actions
  Release:  https://github.com/tnnrhpwd/C-Simple/releases  (once CI completes)

  GitHub Actions will build the installer and publish it.
  Running addon installs will pick it up automatically.
`);
}

main();
