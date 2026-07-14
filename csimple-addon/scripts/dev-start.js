/**
 * dev-start.js — kills any running CSimple Addon instance, then starts Electron.
 *
 * Run via:  npm start   (triggered by prestart hook)
 *           npm run dev (explicit)
 *
 * Why this exists:
 *   The packaged installer puts a copy of the code in %LOCALAPPDATA%\Programs\CSimple Addon\.
 *   When you edit source files and npm start, Electron's single-instance lock prevents
 *   the dev version from launching if the installed version is still running.
 *   This script kills the installed instance first so the dev version starts cleanly.
 */

'use strict';
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Kill any running CSimple Addon process ────────────────────────────────────
const targets = ['CSimple Addon.exe', 'csimple-addon.exe', 'CSimpleAddon.exe'];
let killed = false;
for (const name of targets) {
    try {
        execSync(`taskkill /F /IM "${name}"`, { stdio: 'ignore' });
        killed = true;
        console.log(`[dev] Stopped running instance: ${name}`);
    } catch {}
}
if (killed) {
    // Give the OS a moment to release the single-instance lock file
    execSync('ping 127.0.0.1 -n 2 >nul 2>&1 || timeout /t 1 /nobreak >nul 2>&1', { stdio: 'ignore', shell: true });
}

// ─── Resolve electron executable ──────────────────────────────────────────────
const electronBin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron.cmd');
const electronFallback = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');

let electronExe;
if (fs.existsSync(electronBin)) {
    electronExe = electronBin;
} else if (fs.existsSync(electronFallback)) {
    electronExe = electronFallback;
} else {
    // Fall back to PATH
    electronExe = process.platform === 'win32' ? 'electron.cmd' : 'electron';
}

// ─── Start Electron from source ───────────────────────────────────────────────
const appDir = path.join(__dirname, '..');
console.log(`[dev] Starting dev addon from: ${appDir}`);

const child = spawn(electronExe, [appDir], {
    stdio: 'inherit',
    shell: true,
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_ENABLE_LOGGING: '1' },
});

child.on('exit', (code) => {
    process.exit(code || 0);
});
