"""
Simple Addon — Gaze Fixation / Saccade Classifier (I-VT)

Turns the raw 30 Hz gaze stream into meaningful "the user is looking HERE"
events. Fixations are the industry-standard primitive for eye-controlled UIs:
dwell-to-click, gaze heatmaps, and jitter-free cursor anchoring all build on
top of knowing *when and where* the eye is actually resting.

Algorithm: I-VT (Identification by Velocity Threshold).
  - A sample is a saccade if its screen-space velocity exceeds
    `velocity_threshold` px/s against the previous sample.
  - Consecutive non-saccade samples form a candidate window. Once the window
    spans at least `min_duration` seconds AND its spatial dispersion (max
    distance from the window centroid) is within `dispersion_radius` px, it is
    promoted to an active fixation (emits `fixation_start`).
  - The fixation ends (emits `fixation_end`) when a saccade or a blink occurs,
    or when the sample stream gaps longer than `max_gap` seconds.

This module is pure Python (no OpenCV / MediaPipe / camera), so it is fully
unit-testable in CI and standalone.

Events returned by update() (list of dicts):
  {"type": "fixation_start", "t": <s>, "x": <px>, "y": <px>}
  {"type": "fixation_end",   "t": <s>, "duration": <s>, "x": <centroid px>,
                             "y": <centroid px>, "samples": <n>}
"""

import math


class FixationDetector:
    def __init__(self, velocity_threshold=120.0, dispersion_radius=40.0,
                 min_duration=0.10, max_gap=0.10):
        if velocity_threshold <= 0:
            raise ValueError("velocity_threshold must be > 0")
        if dispersion_radius <= 0:
            raise ValueError("dispersion_radius must be > 0")
        self.velocity_threshold = float(velocity_threshold)
        self.dispersion_radius = float(dispersion_radius)
        self.min_duration = float(min_duration)
        self.max_gap = float(max_gap)
        self.reset()

    def reset(self):
        """Clear all internal state (e.g. after a calibration or camera swap)."""
        self._window = []          # consecutive non-saccade samples: (t, x, y)
        self._active = False
        self._fix_start = None     # timestamp when the active fixation began
        self._last_sample = None   # previous sample: (t, x, y)

    def update(self, t, x, y, blink=False):
        """Feed one gaze sample; returns a list of events emitted this frame.

        Coordinates are in screen pixels; `t` is seconds (monotonic). Pass
        `blink=True` when the eyes are closed so the current fixation is ended
        immediately rather than smeared across the blink.
        """
        events = []

        if blink:
            if self._active:
                events.append(self._end_fixation(t))
            self._window = []
            self._last_sample = None
            return events

        if self._last_sample is not None:
            dt = t - self._last_sample[0]
            if dt < 0:
                # Clock jumped backwards (system sleep / clock reset) — safest
                # to drop all state and start fresh rather than mis-classify.
                self.reset()
                return events

            # Data gap longer than max_gap: no velocity evidence connects the
            # samples, so treat it as a hard break of the current fixation.
            if dt > self.max_gap:
                if self._active:
                    events.append(self._end_fixation(t))
                self._window = []

            # Velocity classification (I-VT).
            if dt >= 1e-6:
                v = math.hypot(x - self._last_sample[1],
                               y - self._last_sample[2]) / dt
                if v > self.velocity_threshold:
                    if self._active:
                        events.append(self._end_fixation(t))
                    self._window = []
                    self._last_sample = (t, x, y)
                    return events

        self._last_sample = (t, x, y)
        self._window.append((t, x, y))

        if not self._active:
            if (self._window_duration() >= self.min_duration
                    and self._window_dispersion() <= self.dispersion_radius):
                self._active = True
                self._fix_start = self._window[0][0]
                cx, cy = self._centroid(self._window)
                events.append({
                    "type": "fixation_start",
                    "t": self._fix_start,
                    "x": cx,
                    "y": cy,
                })

        return events

    def flush(self):
        """End any active fixation now (returns a list of events)."""
        events = []
        if self._active:
            events.append(self._end_fixation(self._last_sample[0]
                                             if self._last_sample else 0.0))
        self._window = []
        return events

    # ── internal helpers ─────────────────────────────────────────────────────
    def _window_duration(self):
        if len(self._window) < 2:
            return 0.0
        return self._window[-1][0] - self._window[0][0]

    @staticmethod
    def _centroid(samples):
        n = len(samples)
        sx = sum(s[1] for s in samples) / n
        sy = sum(s[2] for s in samples) / n
        return sx, sy

    def _window_dispersion(self):
        if len(self._window) < 2:
            return 0.0
        cx, cy = self._centroid(self._window)
        return max(math.hypot(s[1] - cx, s[2] - cy) for s in self._window)

    def _end_fixation(self, t):
        cx, cy = self._centroid(self._window) if self._window else (0.0, 0.0)
        duration = max(0.0, t - self._fix_start) if self._fix_start is not None else 0.0
        samples = len(self._window)
        self._active = False
        self._fix_start = None
        return {
            "type": "fixation_end",
            "t": t,
            "duration": duration,
            "x": cx,
            "y": cy,
            "samples": samples,
        }


if __name__ == "__main__":
    # Tiny self-check: a stationary gaze should yield exactly one fixation.
    d = FixationDetector(velocity_threshold=120.0, dispersion_radius=40.0,
                         min_duration=0.10)
    events = []
    t = 0.0
    for _ in range(25):            # 25 frames @ 50 Hz = 0.5 s
        t += 0.02
        events += d.update(t, 500.0, 400.0)
    events += d.flush()

    starts = [e for e in events if e["type"] == "fixation_start"]
    ends = [e for e in events if e["type"] == "fixation_end"]
    print(f"fixation_detector self-test: {len(starts)} start(s), {len(ends)} end(s)")
    if len(starts) != 1 or len(ends) != 1:
        raise SystemExit(1)
    print("  start:", starts[0])
    print("  end:  ", ends[0])
