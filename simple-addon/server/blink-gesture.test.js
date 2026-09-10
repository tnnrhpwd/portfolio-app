'use strict';

/**
 * Unit tests for BlinkGestureDetector — the double-blink click gesture.
 * Pure logic, no camera/Python: exercises the state machine with synthetic
 * blink sequences at millisecond timestamps.
 */

const { BlinkGestureDetector } = require('./blink-gesture');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Two blinks ~200ms apart, each ~150ms long, ending with a click.
function doubleBlink(d, t0) {
  const res = [];
  res.push(d.feed(t0, false, 100, 100));
  res.push(d.feed(t0, true, 100, 100));        // blink 1 start
  res.push(d.feed(t0 + 150, false, 100, 100)); // blink 1 end
  res.push(d.feed(t0 + 350, true, 100, 100));  // blink 2 start
  res.push(d.feed(t0 + 500, false, 100, 100)); // blink 2 end → click
  return res;
}

// 1. Disabled → never fires.
{
  const d = new BlinkGestureDetector({ enabled: false });
  check('disabled detector never fires', doubleBlink(d, 0).every(r => r === null));
}

// 2. A valid double blink fires exactly once at the gaze position.
{
  const d = new BlinkGestureDetector({ enabled: true });
  const clicks = doubleBlink(d, 0).filter(r => r !== null);
  check('double blink fires one click', clicks.length === 1);
  check('click lands at gaze position', clicks[0] && clicks[0].x === 100 && clicks[0].y === 100);
}

// 3. Two blinks too far apart → no click.
{
  const d = new BlinkGestureDetector({ enabled: true });
  const r = [];
  r.push(d.feed(0, false, 50, 50));
  r.push(d.feed(0, true, 50, 50));
  r.push(d.feed(150, false, 50, 50));
  r.push(d.feed(2000, true, 50, 50));   // gap = 1850ms > 800ms window
  r.push(d.feed(2150, false, 50, 50));
  check('blinks too far apart never click', r.every(x => x === null));
}

// 4. A long "eyes closed" closure is not a blink → never fires.
{
  const d = new BlinkGestureDetector({ enabled: true });
  const r = [];
  r.push(d.feed(0, false, 50, 50));
  r.push(d.feed(0, true, 50, 50));
  r.push(d.feed(2000, false, 50, 50)); // 2s closure > maxBlinkMs
  r.push(d.feed(2300, true, 50, 50));
  r.push(d.feed(2450, false, 50, 50));
  check('long closure never fires', r.every(x => x === null));
}

// 5. A single blink never fires.
{
  const d = new BlinkGestureDetector({ enabled: true });
  const r = [];
  r.push(d.feed(0, false, 10, 20));
  r.push(d.feed(0, true, 10, 20));
  r.push(d.feed(200, false, 10, 20));
  check('single blink never fires', r.every(x => x === null));
}

// 6. Re-arms after a click — a second gesture fires again.
{
  const d = new BlinkGestureDetector({ enabled: true });
  const r1 = doubleBlink(d, 0).filter(x => x !== null);
  const r2 = doubleBlink(d, 5000).filter(x => x !== null);
  check('two separate gestures fire twice', r1.length === 1 && r2.length === 1);
}

console.log(`\nblink-gesture.test: ${pass}/${pass + fail} PASS`);
process.exit(fail > 0 ? 1 : 0);
