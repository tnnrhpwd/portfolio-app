/**
 * Unit tests for GazeClick (dwell-to-click) — pure logic, no camera.
 */
const assert = require('assert');
const { GazeClick } = require('./gaze-click');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Dwell produces a click after dwellMs of stable gaze ─────────────────────
{
  const g = new GazeClick({ dwellMs: 500, radiusPx: 30, cooldownMs: 800, enabled: true });
  let t = 0;
  let clicked = null;
  for (let i = 0; i < 30; i++) {
    t += 20; // 20 ms steps
    const c = g.feed(500, 400, t, { confidence: 0.9, confidenceThreshold: 0.5 });
    if (c) clicked = c;
  }
  check('dwell fires exactly one click', !!clicked);
  check('click lands at the dwell point', clicked && clicked.x === 500 && clicked.y === 400);
}

// ── Movement beyond radius restarts the dwell (no click) ────────────────────
{
  const g = new GazeClick({ dwellMs: 500, radiusPx: 30, cooldownMs: 800, enabled: true });
  let t = 0;
  let clicks = 0;
  for (let i = 0; i < 40; i++) {
    t += 20;
    // oscillate ±40 px → never dwells long enough at one point
    const c = g.feed(500 + (i % 2 ? 40 : -40), 400, t, { confidence: 0.9, confidenceThreshold: 0.5 });
    if (c) clicks++;
  }
  check('oscillating gaze never clicks', clicks === 0);
}

// ── Re-arm on exit: holding still does not click repeatedly ─────────────────
{
  const g = new GazeClick({ dwellMs: 200, radiusPx: 30, cooldownMs: 0, enabled: true });
  let t = 0;
  let clicks = 0;
  // dwell to click once
  for (let i = 0; i < 20; i++) { t += 20; if (g.feed(300, 300, t, { confidence: 0.9, confidenceThreshold: 0.5 })) clicks++; }
  // keep holding at the same point for a long time
  for (let i = 0; i < 50; i++) { t += 20; if (g.feed(300, 300, t, { confidence: 0.9, confidenceThreshold: 0.5 })) clicks++; }
  check('holding still clicks only once', clicks === 1, `got ${clicks}`);
}

// ── Re-arm after leaving the click point ────────────────────────────────────
{
  const g = new GazeClick({ dwellMs: 200, radiusPx: 30, cooldownMs: 0, enabled: true });
  let t = 0;
  let clicks = 0;
  const feed = (x, y) => { t += 20; if (g.feed(x, y, t, { confidence: 0.9, confidenceThreshold: 0.5 })) clicks++; };
  for (let i = 0; i < 20; i++) feed(300, 300);        // click #1
  for (let i = 0; i < 20; i++) feed(900, 900);        // move away (re-arm) + dwell → click #2
  check('two well-separated dwells click twice', clicks === 2, `got ${clicks}`);
}

// ── Blink cancels the dwell ─────────────────────────────────────────────────
{
  const g = new GazeClick({ dwellMs: 200, radiusPx: 30, cooldownMs: 0, enabled: true });
  let t = 0;
  let clicks = 0;
  for (let i = 0; i < 10; i++) { t += 20; if (g.feed(100, 100, t, { confidence: 0.9, confidenceThreshold: 0.5 })) clicks++; }
  t += 20; g.feed(100, 100, t, { blink: true });      // blink cancels
  for (let i = 0; i < 20; i++) { t += 20; if (g.feed(100, 100, t, { confidence: 0.9, confidenceThreshold: 0.5 })) clicks++; }
  // dwell restarts after the blink, so we eventually get exactly one click
  check('blink cancels then allows a single re-dwell click', clicks === 1, `got ${clicks}`);
}

// ── Disabled gate never clicks ──────────────────────────────────────────────
{
  const g = new GazeClick({ dwellMs: 100, radiusPx: 30, enabled: false });
  let clicks = 0;
  for (let i = 0; i < 30; i++) {
    const c = g.feed(500, 500, i * 20, { confidence: 0.9, confidenceThreshold: 0.5 });
    if (c) clicks++;
  }
  check('disabled detector never clicks', clicks === 0);
}

console.log(`\ngaze-click.test: ${pass}/${pass + fail} PASS`);
process.exit(fail > 0 ? 1 : 0);
