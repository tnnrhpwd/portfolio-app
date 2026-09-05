/**
 * Unit tests for EyeTrackingManager's EventEmitter contract.
 *
 * The perception bus subscribes to the eye tracker via
 * `eyeTrackingManager.on('gaze', ...)` — but the manager used to be a plain
 * class with no `.on()` method, so that subscription silently never fired and
 * gaze never reached the perception bus (and the dashboard's live readout).
 * This test locks in the EventEmitter contract without spawning Python or a
 * webcam: it only exercises the structural surface and no-op guards.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

// Isolate resource paths so no real calibration/settings files are touched.
global.SIMPLE_RESOURCES_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'eye-mgr-'));

const { EyeTrackingManager } = require('./eye-tracking-manager');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── EventEmitter contract ───────────────────────────────────────────────────
const mgr = new EyeTrackingManager();
check('EyeTrackingManager is an EventEmitter', mgr instanceof EventEmitter);
check('has .on / .emit / .removeListener',
    typeof mgr.on === 'function' && typeof mgr.emit === 'function' && typeof mgr.removeListener === 'function');

let received = null;
mgr.on('gaze', (d) => { received = d; });
mgr.emit('gaze', { x: 10, y: 20, confidence: 0.8, blink: false });
check('gaze listener receives emitted data',
    !!received && received.x === 10 && received.y === 20 && received.confidence === 0.8);

// ── Status shape (isolated resources → no calibration) ──────────────────────
const st = mgr.getStatus();
check('getStatus reports idle + no calibration',
    st.state === 'idle' && st.active === false && st.hasCalibration === false && st.calibrating === false);

// ── Prior calibration summary with no file ──────────────────────────────────
const sum = mgr.getPriorCalibrationSummary();
check('prior calibration summary reports not-exists', !!sum && sum.exists === false);

// ── Online-training guards are no-ops when not running ──────────────────────
check('online train no-op when not running', mgr.addOnlineTrainingSample(0, 0).success === false);
check('drop online samples no-op when not running', mgr.dropRecentOnlineSamples(1).success === false);
check('clear online samples no-op when not running', mgr.clearOnlineSamples().success === false);

console.log(`\neye-tracking-manager.test: ${pass}/${pass + fail} PASS`);
process.exit(fail > 0 ? 1 : 0);
