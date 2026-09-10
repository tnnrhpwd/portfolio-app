'use strict';

/**
 * Simple Addon — Double-Blink Click Gesture
 *
 * Turns two deliberate, closely-spaced blinks into an intentional click — the
 * industry-standard "double blink" interaction for hands-free eye control.
 * Off by default: natural blink timing rarely produces two blinks within the
 * window, but this is still a deliberate gesture so it ships disabled until the
 * user opts in.
 *
 * Pure logic: it never touches the OS cursor. The caller
 * (EyeTrackingManager) wires the returned click payload to a real click.
 *
 * feed(t, blinking, x, y) is called once per gaze frame (t in ms, monotonic).
 * Returns a click payload `{ x, y, t }` when a double blink completes, else null.
 *
 * Safety properties:
 *  - Each blink in the pair must last between `minBlinkMs` and `maxBlinkMs`
 *    (filters out one-frame noise and long "eyes closed" closures).
 *  - The gap between the two blinks must be within `doubleBlinkWindowMs`.
 *  - The click fires once per gesture (the pair is consumed on detection).
 */

const { EventEmitter } = require('events');

class BlinkGestureDetector extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.enabled = !!opts.enabled;
    this.doubleBlinkWindowMs = opts.doubleBlinkWindowMs ?? 800;
    this.minBlinkMs = opts.minBlinkMs ?? 80;
    this.maxBlinkMs = opts.maxBlinkMs ?? 500;
    this.reset();
  }

  reset() {
    this._blinking = false;
    this._blinkStart = null;
    this._lastBlinkEnd = -Infinity; // end time of the previous valid blink
    this._lastBlinkValid = false;    // whether the previous blink was valid
    this._gaze = null;               // {x,y} — most recent non-blink gaze
  }

  feed(t, blinking, x, y) {
    if (!this.enabled) {
      this.reset();
      return null;
    }

    if (!blinking) {
      // Most recent open-eye position (used as the click target).
      this._gaze = { x, y };

      if (this._blinking) {
        // Falling edge: a blink just ended.
        this._blinking = false;
        const duration = t - this._blinkStart;
        const valid = duration >= this.minBlinkMs && duration <= this.maxBlinkMs;
        const gap = this._blinkStart - this._lastBlinkEnd;

        let payload = null;
        if (valid && this._lastBlinkValid && gap >= 0 && gap <= this.doubleBlinkWindowMs) {
          payload = { x: this._gaze.x, y: this._gaze.y, t };
          // Consume the pair so the next blink starts a fresh gesture.
          this._lastBlinkEnd = -Infinity;
          this._lastBlinkValid = false;
        } else {
          this._lastBlinkEnd = t;
          this._lastBlinkValid = valid;
        }

        if (payload) {
          this.emit('click', payload);
          return payload;
        }
      }
      return null;
    }

    // blinking === true
    if (!this._blinking) {
      // Rising edge: a blink just started.
      this._blinking = true;
      this._blinkStart = t;
    }
    return null;
  }
}

module.exports = { BlinkGestureDetector };
