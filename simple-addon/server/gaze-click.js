/**
 * Simple Addon — Gaze Dwell-to-Click
 *
 * Turns the raw gaze stream into *intentional* clicks. A click fires when gaze
 * stays within `radiusPx` of a point for `dwellMs` — the industry-standard
 * "dwell" interaction used by eye-controlled UIs (no extra hardware click
 * needed). Pure logic: it never touches the OS cursor itself; the caller
 * (EyeTrackingManager) wires the returned click payload to a real click.
 *
 * Safety properties:
 *  - movement cancel: drifting more than `radiusPx` restarts the dwell timer.
 *  - re-arm on exit: after a click, gaze must leave the click point before
 *    another click can fire (prevents hold-to-repeat).
 *  - cooldown: a minimum gap between consecutive clicks.
 *  - blink / low-confidence frames reset the dwell entirely.
 */

const { EventEmitter } = require('events');

class GazeClick extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.dwellMs = opts.dwellMs ?? 600;
    this.radiusPx = opts.radiusPx ?? 28;
    this.cooldownMs = opts.cooldownMs ?? 900;
    this.enabled = !!opts.enabled;

    this._target = null;          // { x, y, since } — current dwell candidate
    this._armed = true;           // false until gaze leaves the last click point
    this._lastClickAt = -Infinity;
    this._lastClickPos = null;
  }

  reset() {
    this._target = null;
    this._armed = true;
  }

  /**
   * Feed one gaze sample (t in ms, same clock every call).
   * Returns a click payload `{ x, y, t }` when a dwell completes, else null.
   */
  feed(x, y, t, opts = {}) {
    if (!this.enabled) {
      this.reset();
      return null;
    }

    const blink = !!opts.blink;
    const lowConfidence =
      opts.confidence !== undefined &&
      typeof opts.confidenceThreshold === 'number' &&
      opts.confidence < opts.confidenceThreshold;

    // Blinks and low-quality frames invalidate the current dwell entirely.
    if (blink || lowConfidence) {
      this._target = null;
      this._armed = true;
      return null;
    }

    // Re-arm only after leaving the last click point.
    if (!this._armed) {
      if (this._lastClickPos &&
          Math.hypot(x - this._lastClickPos.x, y - this._lastClickPos.y) > this.radiusPx) {
        this._armed = true;
      } else {
        return null;
      }
    }

    if (this._target === null) {
      this._target = { x, y, since: t };
      return null;
    }

    const moved = Math.hypot(x - this._target.x, y - this._target.y);
    if (moved > this.radiusPx) {
      // Gaze left the dwell target — restart the dwell at the new position.
      this._target = { x, y, since: t };
      return null;
    }

    const dwelled = (t - this._target.since) >= this.dwellMs;
    const cooled = (t - this._lastClickAt) >= this.cooldownMs;
    if (dwelled && cooled) {
      this._lastClickAt = t;
      this._lastClickPos = { x: this._target.x, y: this._target.y };
      this._target = null;
      this._armed = false;

      const payload = { x: this._lastClickPos.x, y: this._lastClickPos.y, t };
      this.emit('click', payload);
      return payload;
    }

    return null;
  }
}

module.exports = { GazeClick };
