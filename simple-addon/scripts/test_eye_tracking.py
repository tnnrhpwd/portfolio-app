"""
Simple Addon — Eye Tracking Unit Tests (camera-free)

Covers the pure gaze math so reliability regressions are caught without a
webcam: fixation classification (I-VT), degrees-of-visual-angle conversion,
accuracy banding, and — when OpenCV/MediaPipe are installed — the real
`eye_tracker.py` math (blink EAR, calibration aggregation, poly2 fit, 1€ filter).

Run with:  python test_eye_tracking.py
"""

import importlib.util
import unittest

from fixation_detector import FixationDetector
from gaze_quality import px_to_deg, classify_accuracy, estimate_pixel_pitch

HAVE_CV2 = importlib.util.find_spec("cv2") is not None
HAVE_MP = importlib.util.find_spec("mediapipe") is not None
HAVE_NP = importlib.util.find_spec("numpy") is not None
HAVE_EYE_TRACKER = HAVE_CV2 and HAVE_MP and HAVE_NP


# ── FixationDetector ──────────────────────────────────────────────────────────
class TestFixationDetector(unittest.TestCase):
    def _feed(self, detector, n, dt, x, y):
        events = []
        t = 0.0
        for _ in range(n):
            t += dt
            events += detector.update(t, x, y)
        return events

    def test_stationary_gaze_yields_one_fixation(self):
        d = FixationDetector()
        events = self._feed(d, 30, 0.02, 500.0, 400.0)  # 0.6 s @ 50 Hz
        starts = [e for e in events if e["type"] == "fixation_start"]
        self.assertEqual(len(starts), 1)
        self.assertAlmostEqual(starts[0]["x"], 500.0, delta=5.0)
        self.assertAlmostEqual(starts[0]["y"], 400.0, delta=5.0)

    def test_tiny_jitter_is_single_fixation_not_many(self):
        import math
        d = FixationDetector(velocity_threshold=120.0, dispersion_radius=40.0)
        events = []
        t = 0.0
        for i in range(60):
            t += 0.02
            # smooth ±1.5 px oscillation → ~37 px/s, far below the threshold
            events += d.update(t, 500.0 + math.sin(i * 0.5) * 1.5,
                               400.0 + math.cos(i * 0.5) * 1.5)
        starts = [e for e in events if e["type"] == "fixation_start"]
        self.assertEqual(len(starts), 1)

    def test_saccade_ends_fixation(self):
        d = FixationDetector()
        events = []
        t = 0.0
        for _ in range(25):
            t += 0.02
            events += d.update(t, 100.0, 100.0)
        # Fast jump: 2000 px in one 20 ms frame = 100000 px/s >> threshold
        t += 0.02
        events += d.update(t, 900.0, 900.0)
        ends = [e for e in events if e["type"] == "fixation_end"]
        self.assertEqual(len(ends), 1)
        self.assertGreater(ends[0]["duration"], 0.0)

    def test_blink_ends_fixation_immediately(self):
        d = FixationDetector()
        events = self._feed(d, 25, 0.02, 200.0, 200.0)
        t = 0.5
        events += d.update(t, 200.0, 200.0, blink=True)
        ends = [e for e in events if e["type"] == "fixation_end"]
        self.assertEqual(len(ends), 1)

    def test_short_gaze_below_min_duration_is_not_fixation(self):
        d = FixationDetector(min_duration=0.5)
        events = self._feed(d, 5, 0.02, 300.0, 300.0)  # only 0.1 s
        starts = [e for e in events if e["type"] == "fixation_start"]
        self.assertEqual(len(starts), 0)

    def test_large_gap_breaks_fixation(self):
        d = FixationDetector(max_gap=0.10)
        events = self._feed(d, 25, 0.02, 100.0, 100.0)
        # gap of 1 s at the same position → new fixation after the gap
        events += d.update(1.5, 100.0, 100.0)
        ends = [e for e in events if e["type"] == "fixation_end"]
        self.assertEqual(len(ends), 1)


# ── gaze_quality ──────────────────────────────────────────────────────────────
class TestGazeQuality(unittest.TestCase):
    def test_pixel_pitch_from_physical_size(self):
        pitch = estimate_pixel_pitch(1920, 1080, 530.0, 300.0)
        self.assertAlmostEqual(pitch, 0.2766, delta=0.005)

    def test_px_to_deg_known_value(self):
        # 530x300 mm on 1920x1080 → pitch ≈ 0.2769 mm/px.
        # 100 px → 27.69 mm; 600 mm viewing distance:
        #   2 * atan(27.69 / 1200) ≈ 2.644 deg
        deg = px_to_deg(100, 1920, 1080, viewing_distance_mm=600.0,
                        screen_width_mm=530.0, screen_height_mm=300.0)
        self.assertAlmostEqual(deg, 2.64, delta=0.05)

    def test_px_to_deg_zero(self):
        self.assertEqual(px_to_deg(0, 1920, 1080), 0.0)

    def test_classify_accuracy_bands(self):
        self.assertEqual(classify_accuracy(0.5), "good")
        self.assertEqual(classify_accuracy(1.0), "fair")
        self.assertEqual(classify_accuracy(2.0), "poor")
        self.assertEqual(classify_accuracy(None), "unknown")


# ── Real eye_tracker.py math (requires cv2 + mediapipe) ──────────────────────
@unittest.skipUnless(HAVE_EYE_TRACKER, "OpenCV/MediaPipe not installed")
class TestEyeTrackerMath(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import eye_tracker as et
        cls.et = et

    def _tracker(self):
        # Constructing never opens the camera (that only happens in run()).
        return self.et.EyeTracker(screen_width=1920, screen_height=1080)

    def _landmarks(self, eye_open=True):
        """Fake MediaPipe landmarks: all zeros, eyes positioned for EAR."""
        class L:
            def __init__(self, x=0.0, y=0.0):
                self.x = x
                self.y = y
                self.visibility = 1.0
        lm = [L() for _ in range(478)]
        gap = 0.04 if eye_open else 0.004
        # left eye (open): top=159 bottom=145 vertical gap, 33/133 horizontal
        lm[159] = L(0.5, 0.5)
        lm[145] = L(0.5, 0.5 + gap)
        lm[33] = L(0.4, 0.5)
        lm[133] = L(0.6, 0.5)
        # right eye: top=386 bottom=374, left=362 right=263
        lm[386] = L(0.5, 0.5)
        lm[374] = L(0.5, 0.5 + gap)
        lm[362] = L(0.4, 0.5)
        lm[263] = L(0.6, 0.5)
        return lm

    def test_ear_open_vs_closed(self):
        t = self._tracker()
        open_ear = t._compute_ear(self._landmarks(eye_open=True), 640, 480)
        closed_ear = t._compute_ear(self._landmarks(eye_open=False), 640, 480)
        self.assertGreater(open_ear, closed_ear)
        self.assertLess(closed_ear, self.et.EAR_BLINK_THRESHOLD)

    def test_blink_detector_state_machine(self):
        t = self._tracker()
        # EAR_CONSEC_FRAMES (2) low-EAR frames in a row → blinking
        self.assertFalse(t._detect_blink(0.1))  # frame 1
        self.assertTrue(t._detect_blink(0.1))   # frame 2
        self.assertTrue(t.is_blinking)
        # recover
        for _ in range(self.et.EAR_CONSEC_FRAMES):
            t._detect_blink(0.5)
        self.assertFalse(t.is_blinking)

    def test_aggregate_point_samples_median_and_outlier(self):
        import numpy as np
        t = self._tracker()
        samples = [(500.0, 400.0, 0.0, 0.0)] * 15 + [(9000.0, 9000.0, 0.0, 0.0)]
        out = t._aggregate_point_samples(samples)
        self.assertIsNotNone(out)
        ix, iy, _, _, w = out
        self.assertAlmostEqual(ix, 500.0, delta=1.0)
        self.assertAlmostEqual(iy, 400.0, delta=1.0)
        self.assertGreater(w, 0.0)

    def test_poly2_fit_recovers_linear_mapping(self):
        import numpy as np
        t = self._tracker()
        rng = np.random.default_rng(0)
        src = rng.uniform(-200, 200, size=(16, 2))
        # screen = 3.0 * iris + [960, 540]
        dst = src * 3.0 + np.array([960.0, 540.0])
        model = t._fit_poly2_gaze_model(src, dst, np.ones(16))
        self.assertIsNotNone(model)
        resid = t._evaluate_model_residuals(model, src, dst)
        self.assertLess(resid.mean(), 1e-6)

    def test_poly2_fit_recovers_linear_mapping_3d(self):
        import numpy as np
        t = self._tracker()
        rng = np.random.default_rng(11)
        # 3 columns: iris_x, iris_y, head_yaw. Screen is linear in all three,
        # with a large yaw coefficient (the dominant signal on an ultrawide).
        src = rng.uniform(-200, 200, size=(20, 3))
        dst = src[:, :2] * 2.5 + np.array([960.0, 540.0]) + src[:, 2:3] * 800.0
        model = t._fit_poly2_gaze_model(src, dst, np.ones(20))
        self.assertIsNotNone(model)
        self.assertEqual(model['dim'], 3)
        resid = t._evaluate_model_residuals(model, src, dst)
        self.assertLess(resid.mean(), 1.0)

    def test_adaptive_smooth_holds_under_deadzone(self):
        t = self._tracker()
        # warm up
        t._adaptive_smooth(500.0, 400.0)
        # a 1 px micro-move should be held (deadzone = 4 px)
        sx, sy = t._adaptive_smooth(500.6, 400.4)
        self.assertAlmostEqual(sx, 500.0, delta=0.6)
        self.assertAlmostEqual(sy, 400.0, delta=0.6)

    def test_lead_compensation_moves_ahead_of_raw(self):
        t = self._tracker()
        t.lead_s = 0.05          # 50 ms lead
        t.max_lead_px = 1000.0
        t.deadzone_px = 0.0
        now = 0.0
        t._adaptive_smooth(100.0, 100.0, now=now)  # warm up
        out = None
        for i in range(1, 30):
            now += 0.01
            out = t._adaptive_smooth(100.0 + i * 10.0, 100.0, now=now)
        # ~1000 px/s velocity × 50 ms lead ≈ 50 px ahead of the raw target
        self.assertGreater(out[0], 100.0 + 29 * 10.0)

    def test_no_lead_when_disabled(self):
        t = self._tracker()
        t.lead_s = 0.0
        t.deadzone_px = 0.0
        now = 0.0
        t._adaptive_smooth(100.0, 100.0, now=now)
        out = None
        for i in range(1, 30):
            now += 0.01
            out = t._adaptive_smooth(100.0 + i * 10.0, 100.0, now=now)
        # no lead: filtered output lags, never exceeds the raw target
        self.assertLessEqual(out[0], 100.0 + 29 * 10.0 + 1e-6)

    def test_poly2_robust_ignores_gross_outlier(self):
        import numpy as np
        t = self._tracker()
        rng = np.random.default_rng(2)
        src = rng.uniform(-200, 200, size=(15, 2))
        dst = src * 3.0 + np.array([960.0, 540.0])
        # low-leverage outlier: iris in normal range, but screen target is
        # wildly wrong (the exact signature of a pursuit sample where the eye
        # lagged behind a moving dot).
        src = np.vstack([src, [[50.0, 50.0]]])
        dst = np.vstack([dst, [[3000.0, 3000.0]]])
        w = np.ones(16)
        model, keep = t._fit_poly2_robust(src, dst, w)
        self.assertIsNotNone(model)
        self.assertFalse(bool(keep[-1]))  # outlier dropped
        resid = t._evaluate_model_residuals(model, src[:-1], dst[:-1])
        self.assertLess(resid.mean(), 15.0)

    def test_loo_error_small_on_clean_linear_map(self):
        import numpy as np
        t = self._tracker()
        rng = np.random.default_rng(7)
        src = rng.uniform(-200, 200, size=(20, 2))
        dst = src * 3.0 + np.array([960.0, 540.0])
        w = np.ones(20)
        hom = t._loo_error_homography(src, dst)
        poly = t._loo_error_poly2(src, dst, w)
        self.assertLess(hom.mean(), 50.0)
        self.assertLess(poly.mean(), 50.0)

    def test_loo_error_detects_corrupted_calibration(self):
        import numpy as np
        t = self._tracker()
        rng = np.random.default_rng(5)
        src = rng.uniform(-200, 200, size=(20, 2))
        dst = src * 3.0 + np.array([960.0, 540.0])
        clean = t._loo_error_homography(src, dst).mean()
        dst_bad = dst.copy()
        dst_bad[10:] = rng.uniform(0, 3840, size=(10, 2))  # half the points garbage
        bad = t._loo_error_homography(src, dst_bad).mean()
        self.assertLess(clean, 50.0)
        self.assertGreater(bad, clean * 2.0)

    def test_head_correction_gate_discards_harmful(self):
        import numpy as np
        import cv2
        t = self._tracker()
        rng = np.random.default_rng(6)
        src = rng.uniform(-200, 200, size=(10, 2))
        dst = src * 3.0 + np.array([960.0, 540.0])
        H, _ = cv2.findHomography(src.reshape(-1, 1, 2), dst.reshape(-1, 1, 2), 0)
        poses = [[0.01, 0.0]] * 10
        # correction shifts x by +500 px at this yaw offset → actively harmful
        hc = {'pose_ref': np.array([0.0, 0.0]),
              'K_x': np.array([50000.0, 0.0]),
              'K_y': np.array([0.0, 0.0]),
              'data_driven': True}
        out = t._gate_head_correction(hc, src, poses, dst, None, H)
        self.assertIsNone(out)

    def test_head_pose_yaw_is_symmetric(self):
        # The head-yaw proxy must give equal magnitude for left vs right turns
        # (it derives magnitude from inter-ocular foreshortening and only the
        # sign from the nose), so an off-center camera can't compress one side.
        t = self._tracker()

        class L:
            def __init__(self, x=0.5, y=0.5):
                self.x = x
                self.y = y
                self.visibility = 1.0

        def make(half_norm, nose_dx):
            lm = [L() for _ in range(478)]
            lm[33] = L(0.5 - half_norm, 0.5)
            lm[133] = L(0.5 - half_norm, 0.5)
            lm[362] = L(0.5 + half_norm, 0.5)
            lm[263] = L(0.5 + half_norm, 0.5)
            lm[1] = L(0.5 + nose_dx, 0.5)
            return lm

        # Establish the frontal reference inter-ocular distance.
        t._estimate_head_pose(make(0.05, 0.0), 640, 480)
        # 30° turn each way: IOD shrinks by cos(30°), nose shifts the sign.
        yl = t._estimate_head_pose(make(0.05 * 0.866, +0.03), 640, 480)[0]
        yr = t._estimate_head_pose(make(0.05 * 0.866, -0.03), 640, 480)[0]
        self.assertGreater(abs(yl), 0.3)
        self.assertAlmostEqual(yl, -yr, delta=0.05)


if __name__ == "__main__":
    unittest.main(verbosity=2)
