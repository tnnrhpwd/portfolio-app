/**
 * build-and-install.js — builds a new NSIS installer from source and installs it.
 *
 * Run:  npm run build:install
 *
 * This replaces the old packaged version in %LOCALAPPDATA%\Programs\CSimple Addon\
 * so that:
 *   - The installed version has all current source code changes
 *   - Auto-updates work correctly from the new baseline
 *   - You can launch from the Start Menu / tray without running from source
 *
 * After this script succeeds, `npm start` (dev) and the installed app will both
 * have the same code.
 */

'use strict';
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');

// ─── Step 1: Kill running instance ────────────────────────────────────────────
console.log('[build:install] Stopping any running CSimple Addon instance...');
for (const name of ['CSimple Addon.exe', 'csimple-addon.exe']) {
    try { execSync(`taskkill /F /IM "${name}"`, { stdio: 'ignore' }); } catch {}
}
try { execSync('ping 127.0.0.1 -n 2 >nul', { stdio: 'ignore', shell: true }); } catch {}

// ─── Step 2: Build the installer ──────────────────────────────────────────────
console.log('[build:install] Building installer (electron-builder)...');
console.log('[build:install] This may take 1-3 minutes.');
const buildResult = spawnSync(
    'npx', ['electron-builder', '--win', '--x64'],
    { stdio: 'inherit', cwd: ROOT, shell: true }
);
if (buildResult.status !== 0) {
    console.error('[build:install] Build FAILED. Check the output above.');
    process.exit(1);
}

// ─── Step 3: Find the new installer ───────────────────────────────────────────
const distDir = path.join(ROOT, 'dist');
if (!fs.existsSync(distDir)) {
    console.error('[build:install] No dist/ directory found after build.');
    process.exit(1);
}
const installers = fs.readdirSync(distDir).filter(f => f.endsWith('.exe') && f !== 'builder-debug.yml');
if (installers.length === 0) {
    console.error('[build:install] No installer .exe found in dist/');
    process.exit(1);
}
const installer = installers[0];
const installerPath = path.join(distDir, installer);
console.log(`[build:install] Built installer: ${installerPath}`);

// ─── Step 4: Run the installer silently ───────────────────────────────────────
console.log('[build:install] Installing new version (silent)...');
const installResult = spawnSync(
    `"${installerPath}"`, ['/S'],  // NSIS silent install flag
    { stdio: 'inherit', shell: true }
);
if (installResult.status !== 0 && installResult.status !== null) {
    console.warn('[build:install] Installer exited with code', installResult.status, '— may still have succeeded.');
}

// ─── Step 5: Launch the new installed version ─────────────────────────────────
const appExe = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Programs', 'CSimple Addon', 'CSimple Addon.exe'
);
if (fs.existsSync(appExe)) {
    console.log(`[build:install] Launching: ${appExe}`);
    spawnSync(`"${appExe}"`, [], { shell: true, detached: true, stdio: 'ignore' });
    console.log('[build:install] Done! The new version is running.');
} else {
    console.log(`[build:install] Done! Installer ran but could not auto-launch — start manually from the Start Menu.`);
}
