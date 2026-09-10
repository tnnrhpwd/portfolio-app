/**
 * Simple Addon — Run the eye-tracking Python unit tests.
 *
 * Resolves Python the same way EyeTrackingManager does (the packaged venv
 * first, then the system interpreter) so the tests exercise the same runtime
 * the addon ships with. Exits non-zero on test failure.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const venvDir = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Simple', 'venv',
);
const venvPython = path.join(venvDir, 'Scripts', 'python.exe');
const python = fs.existsSync(venvPython)
  ? venvPython
  : (process.platform === 'win32' ? 'py' : 'python3');

const script = path.join(__dirname, 'test_eye_tracking.py');
console.log(`[EyeTracking] Running ${script} with ${python}`);
const res = spawnSync(python, [script], { stdio: 'inherit' });
if (res.error) {
  console.error(`[EyeTracking] Could not launch Python: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
