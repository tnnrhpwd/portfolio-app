#!/usr/bin/env node
/**
 * CSimple Addon Release Script
 *
 * Usage:
 *   npm run release              → patch bump (1.0.1 → 1.0.2)
 *   npm run release -- minor     → minor bump (1.0.1 → 1.1.0)
 *   npm run release -- major     → major bump (1.0.1 → 2.0.0)
 *   npm run release -- 2.5.0     → set explicit version
 *
 * What it does:
 *   1. Bumps version in package.json (and package-lock.json)
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

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default:
      // If type looks like an explicit semver, use it directly
      if (/^\d+\.\d+\.\d+$/.test(type)) return type;
      console.error(`Unknown bump type: "${type}". Use patch, minor, major, or an explicit version like 2.0.0`);
      process.exit(1);
  }
}

// ─── Pre-flight Checks ─────────────────────────────────────────────────────────

function preflight() {
  // Make sure we're in the csimple-addon directory
  const pkgPath = path.join(__dirname, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('Error: package.json not found. Run this from csimple-addon/.');
    process.exit(1);
  }

  // Check for uncommitted changes (allow package.json since we're about to change it)
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

  // Make sure we can push
  try {
    runCapture('git remote get-url origin');
  } catch {
    console.error('Error: No git remote "origin" configured.');
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const bumpType = process.argv[2] || 'patch';

  console.log('\n🚀 CSimple Addon Release\n');

  preflight();

  // 1. Read current version
  const pkgPath = path.join(__dirname, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version;

  // 2. Calculate new version
  const newVersion = bumpVersion(currentVersion, bumpType);
  console.log(`  Version: ${currentVersion} → ${newVersion}\n`);

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
      // Not critical — CI runs npm ci anyway
    }
  }

  // 5. Git commit
  const tag = `addon-v${newVersion}`;
  console.log('  Committing version bump...');
  run('git add package.json package-lock.json');
  run(`git commit -m "release: CSimple Addon v${newVersion}"`);

  // 6. Git tag
  console.log(`\n  Creating tag: ${tag}`);
  run(`git tag -a ${tag} -m "CSimple Addon v${newVersion}"`);

  // 7. Push
  console.log('\n  Pushing to origin...');
  run('git push origin HEAD');
  run(`git push origin ${tag}`);

  // Done!
  console.log(`
✅ Release v${newVersion} triggered!

  Tag:      ${tag}
  CI:       https://github.com/tnnrhpwd/portfolio-app/actions
  Release:  https://github.com/tnnrhpwd/C-Simple/releases  (once CI completes)

  The GitHub Actions workflow will build the Windows installer
  and publish it as a GitHub Release. Existing addon installs
  will pick up the update automatically.
`);
}

main();
