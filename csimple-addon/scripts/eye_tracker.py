"""
CSimple Addon — Eye Tracking Engine

Uses MediaPipe Face Mesh with iris landmarks to track eye gaze and map it to
screen coordinates via a calibration homography.

Modes:
  --mode track    (default) Output {x, y, confidence} JSON lines to stdout
  --mode calibrate         Collect iris samples for calibration points received via stdin
  --mode test              Output raw iris coordinates without calibration (for debugging)
  --mode list_cameras      List available camera indices and exit
    --mode snapshot_camera   Capture a preview frame for one camera and exit

Stdin commands (JSON lines):
  {"cmd": "stop"}                                         — Graceful shutdown
  {"cmd": "calibrate_point", "index": 0, "screen_x": 100, "screen_y": 100}
  {"cmd": "finish_calibration"}                           — Compute homography and save

Stdout output (JSON lines):
  {"x": 960, "y": 540, "confidence": 0.92, "both_eyes": true}
  {"status": "stopped"}
  {"status": "calibrating", "point_index": 0, "samples": 15}
  {"calibration": "complete", "file": "path/to/calibration.json"}
  {"error": "No face detected"}
  {"cameras": [0, 1]}
    {"snapshot": {"index": 0, "name": "USB Camera", "image": "data:image/jpeg;base64,..."}}
"""

import argparse
import base64
import json
import sys
import time
import threading
import numpy as np

try:
    import cv2
except ImportError:
    print(json.dumps({"error": "opencv-python not installed. Run: pip install opencv-python"}), flush=True)
    sys.exit(1)

try:
    import mediapipe as mp
except ImportError:
    print(json.dumps({"error": "mediapipe not installed. Run: pip install mediapipe"}), flush=True)
    sys.exit(1)


# ── Iris Landmark Indices ────────────────────────────────────────────────────────
# MediaPipe Face Mesh with refine_landmarks=True provides iris landmarks 468-477
# Left iris:  468 (center), 469 (right), 470 (top), 471 (left), 472 (bottom)
# Right iris: 473 (center), 474 (right), 475 (top), 476 (left), 477 (bottom)
LEFT_IRIS = [468, 469, 470, 471, 472]
RIGHT_IRIS = [473, 474, 475, 476, 477]
LEFT_IRIS_CENTER = 468
RIGHT_IRIS_CENTER = 473

# ── Eye Contour Landmark Indices for Blink Detection (EAR) ──────────────────────
# Left eye vertical: top 159, bottom 145; horizontal: left 33, right 133
# Right eye vertical: top 386, bottom 374; horizontal: left 362, right 263
LEFT_EYE_TOP = 159
LEFT_EYE_BOTTOM = 145
LEFT_EYE_LEFT = 33
LEFT_EYE_RIGHT = 133
RIGHT_EYE_TOP = 386
RIGHT_EYE_BOTTOM = 374
RIGHT_EYE_LEFT = 362
RIGHT_EYE_RIGHT = 263

# ── Head Pose Estimation Landmarks ──────────────────────────────────────────────
# 6-point model: nose tip, chin, left/right eye corners, left/right mouth corners
HEAD_POSE_LANDMARKS = [1, 152, 33, 263, 61, 291]

# EAR threshold for blink detection
EAR_BLINK_THRESHOLD = 0.21
EAR_CONSEC_FRAMES = 2  # Minimum consecutive frames below threshold to count as blink


def encode_preview_image(frame, max_width=480, max_height=360, quality=55):
    """Encode a frame to a compact JPEG data URL for UI previews."""
    height, width = frame.shape[:2]
    scale = min(max_width / max(width, 1), max_height / max(height, 1), 1.0)
    if scale < 1.0:
        frame = cv2.resize(frame, (max(1, int(width * scale)), max(1, int(height * scale))))

    success, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not success:
        return None
    image_b64 = base64.b64encode(encoded.tobytes()).decode('ascii')
    return f"data:image/jpeg;base64,{image_b64}"


class EyeTracker:
    def __init__(self, camera_index=0, screen_width=1920, screen_height=1080,
                 calibration_file=None, smoothing_alpha=0.3, confidence_threshold=0.6,
                 ir_mode=False, process_width=640, process_height=480,
                 hires_iris=False, capture_width=0, capture_height=0):
        self.camera_index = camera_index
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.calibration_file = calibration_file
        # ── Camera / processing pipeline options ──
        self.ir_mode = bool(ir_mode)
        self.process_width = int(process_width) if process_width else 640
        self.process_height = int(process_height) if process_height else 480
        self.hires_iris = bool(hires_iris)
        # Requested raw capture resolution; 0 = let driver/backend pick default.
        # For high-res webcams (4K) set e.g. 3840x2160 to keep native detail
        # available for the hires_iris refinement stage.
        self.capture_width = int(capture_width) if capture_width else 0
        self.capture_height = int(capture_height) if capture_height else 0
        # CLAHE for IR contrast boost — reused across frames
        self._clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)) if self.ir_mode else None
        self.smoothing_alpha = smoothing_alpha
        self.confidence_threshold = confidence_threshold

        self.running = False
        self.homography = None
        self.gaze_model = None  # {type:'poly2', coeffs_x, coeffs_y, iris_mean, iris_scale}
        self.smoothed_x = None
        self.smoothed_y = None

        # Calibration state
        self.calibrating = False
        self.calibration_points = {}  # {index: {"screen": (x,y), "iris_samples": [(ix,iy), ...]}}
        self.current_cal_point = None
        self.cal_sample_count = 25  # Minimum frames to collect per point
        self.cal_max_samples = 90   # Max frames before forcing done
        # Prior calibration seed (optimize mode): list of aggregated dicts
        # [{"sx":..,"sy":..,"ix":..,"iy":..,"w":..}, ...]
        self.prior_calibration_points = []
        self.prior_weight_factor = 0.5  # discount old observations vs. fresh samples

        # ── Blink detection state ──
        self.blink_counter = 0       # consecutive frames with low EAR
        self.is_blinking = False
        self.blink_total = 0         # total blinks detected this session

        # ── Adaptive smoothing state (1€ Filter) ──
        # The 1€ filter adapts its cutoff frequency to gaze velocity: heavy
        # lowpass when still (kills jitter), light lowpass during saccades
        # (stays responsive). See https://gery.casiez.net/1euro/
        #
        # min_cutoff is the cutoff (Hz) applied at zero velocity. Lower = more
        # stable cursor at rest but slight lag when starting to move.
        # beta scales how aggressively the cutoff opens up with velocity.
        # d_cutoff is the cutoff used to derive the velocity estimate itself.
        self.oe_min_cutoff = 0.8   # Hz — low = rock-solid at fixation
        self.oe_beta = 0.007       # velocity → cutoff gain
        self.oe_d_cutoff = 1.0     # velocity estimator cutoff
        self._oe_prev_x = None
        self._oe_prev_y = None
        self._oe_prev_dx = 0.0
        self._oe_prev_dy = 0.0
        self._oe_prev_time = None

        # ── Dead-zone (hysteresis) to suppress sub-pixel micro-jitter ──
        # If the smoothed position hasn't moved more than `deadzone_px` from
        # the last emitted cursor position, hold the cursor. This eliminates
        # the last mile of visible 1-2 px jitter that survives the 1€ filter.
        self.deadzone_px = 4.0
        self._last_emit_x = None
        self._last_emit_y = None

        # Legacy EMA state kept for any callers using _smooth()
        self.prev_raw_x = None
        self.prev_raw_y = None
        self.prev_time = None

        # ── Head pose compensation state ──
        self.base_head_yaw = None
        self.base_head_pitch = None
        self.head_compensation_gain = 0.0  # disabled by default (was 150); iris-only tracking

        # ── Eye-corner low-pass state (for stable normalization denominator) ──
        # The head moves slowly relative to the eyes, so we lowpass-filter the
        # eye-corner landmark positions before using them as the reference frame
        # for iris normalization. This dramatically reduces feature jitter
        # without dampening actual saccades (the iris itself stays unfiltered).
        self._eye_anchor = None  # dict of smoothed corner/edge positions
        self._eye_anchor_alpha = 0.15  # heavy smoothing on the head-frame anchor

        # ── Face-loss grace period ──
        self.face_lost_time = None
        self.grace_period = 0.5  # seconds to hold last position when face lost
        self.preview_frame_counter = 0
        self.preview_emit_every = 6

        # Load calibration if available
        if calibration_file:
            self._load_calibration(calibration_file)

    def _load_calibration(self, filepath):
        """Load gaze model (polynomial preferred, homography fallback)."""
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            self.gaze_model = None
            if 'gazeModel' in data and data['gazeModel'].get('type') == 'poly2':
                gm = data['gazeModel']
                self.gaze_model = {
                    'type': 'poly2',
                    'coeffs_x': np.array(gm['coeffs_x'], dtype=np.float64),
                    'coeffs_y': np.array(gm['coeffs_y'], dtype=np.float64),
                    'iris_mean': np.array(gm['iris_mean'], dtype=np.float64),
                    'iris_scale': np.array(gm['iris_scale'], dtype=np.float64),
                }
            if 'homographyMatrix' in data:
                self.homography = np.array(data['homographyMatrix'], dtype=np.float64)
            if self.gaze_model is not None or self.homography is not None:
                self._emit({
                    "status": "calibration_loaded",
                    "file": filepath,
                    "model": (self.gaze_model or {}).get('type', 'homography'),
                })
            else:
                self._emit({"error": f"No gaze model in {filepath}"})
        except FileNotFoundError:
            self._emit({"status": "no_calibration", "file": filepath})
        except Exception as e:
            self._emit({"error": f"Failed to load calibration: {str(e)}"})

    def _emit(self, data):
        """Write a JSON line to stdout (best-effort, never blocks fatally)."""
        try:
            line = json.dumps(data)
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
        except Exception as e:
            try:
                sys.stderr.write(f"[eye_tracker] emit failed: {e}\n")
                sys.stderr.flush()
            except Exception:
                pass

    def _refine_iris_hires(self, hires_gray, cx, cy, radius):
        """Sub-pixel iris centroid via intensity-weighted center of mass.

        Under IR or regular light the iris/pupil is distinctly darker than the
        surrounding sclera. We take a small square ROI around the MediaPipe-
        predicted iris center (scaled up to native resolution), threshold out
        the brighter sclera, and compute the image-moment centroid of the
        remaining dark region. This recovers sub-pixel iris precision that is
        lost when the 4K frame is downscaled to 640×480 for MediaPipe.

        Returns (refined_cx, refined_cy) in the coordinate space of `hires_gray`,
        or None if refinement failed (bad ROI, no dark region, etc.).
        """
        h, w = hires_gray.shape[:2]
        # ROI radius: at least `radius` px, padded a little for safety.
        r = max(6, int(radius * 1.6))
        x0, y0 = int(cx - r), int(cy - r)
        x1, y1 = int(cx + r), int(cy + r)
        x0 = max(0, x0); y0 = max(0, y0)
        x1 = min(w, x1); y1 = min(h, y1)
        if x1 - x0 < 6 or y1 - y0 < 6:
            return None
        roi = hires_gray[y0:y1, x0:x1]
        # Blur to suppress IR-sensor / lash noise
        roi_blur = cv2.GaussianBlur(roi, (5, 5), 0)
        # Dark pupil/iris: threshold at the 25th percentile of ROI intensity.
        # This adapts to any lighting / IR brightness automatically.
        thresh_val = float(np.percentile(roi_blur, 25))
        _, mask = cv2.threshold(roi_blur, thresh_val, 255, cv2.THRESH_BINARY_INV)
        # Keep only the largest dark blob (pupil) and compute its centroid
        moments = cv2.moments(mask, binaryImage=True)
        if moments["m00"] <= 1e-3:
            return None
        cx_roi = moments["m10"] / moments["m00"]
        cy_roi = moments["m01"] / moments["m00"]
        return (x0 + cx_roi, y0 + cy_roi)

    def _get_iris_center(self, landmarks, frame_width, frame_height,
                         hires_gray=None, scale_up_x=1.0, scale_up_y=1.0):
        """Extract a head-pose-invariant gaze feature.

        The raw iris pixel coordinates move with the head, so calibration ends
        up learning "head pose → screen" instead of true gaze. To fix that, we
        compute the iris position **relative to a smoothed eye-corner anchor**.

        Key design decisions to keep this both head-invariant AND low-noise:
          1. Use the *horizontal* eye-corner distance (eye_width ≈ 30–40px) as
             the unit length for BOTH axes. eye_height (~10–15px) is too small
             and shrinks during blinks, which made the previous version of this
             feature extremely jittery on the y axis.
          2. Lowpass-filter the eye-corner landmarks themselves with a heavy
             EMA (α=0.15). The head moves slowly compared to the eyes, so the
             corner positions should be stable. The iris position itself is
             NOT filtered, so saccades remain snappy.
          3. Average left/right eyes for binocular noise reduction.

        Returns (gaze_x, gaze_y, both_eyes) where gaze_{x,y} are in synthetic
        pixels keyed off inter-ocular distance, so downstream code (poly2 fit,
        residual thresholds, iris-range diagnostics) keeps its familiar scale.
        """
        # --- Raw landmark pixel positions ---
        l_iris_x = landmarks[LEFT_IRIS_CENTER].x * frame_width
        l_iris_y = landmarks[LEFT_IRIS_CENTER].y * frame_height
        r_iris_x = landmarks[RIGHT_IRIS_CENTER].x * frame_width
        r_iris_y = landmarks[RIGHT_IRIS_CENTER].y * frame_height

        # ── High-resolution iris refinement ──
        # If a native-resolution grayscale frame was provided, re-localize the
        # iris center on it. This only matters for cameras that capture well
        # above the processing resolution (e.g. 1080p IR or 4K webcam).
        if hires_gray is not None and (scale_up_x > 1.01 or scale_up_y > 1.01):
            # Iris radius estimate from landmarks 469-472 / 474-477
            def _iris_radius(center_idx, ring_indices):
                cxp = landmarks[center_idx].x * frame_width
                cyp = landmarks[center_idx].y * frame_height
                dists = []
                for idx in ring_indices:
                    px = landmarks[idx].x * frame_width
                    py = landmarks[idx].y * frame_height
                    dists.append(np.hypot(px - cxp, py - cyp))
                return float(np.mean(dists)) if dists else 6.0

            l_r = _iris_radius(LEFT_IRIS_CENTER, LEFT_IRIS[1:])
            r_r = _iris_radius(RIGHT_IRIS_CENTER, RIGHT_IRIS[1:])

            l_hires = self._refine_iris_hires(
                hires_gray,
                l_iris_x * scale_up_x,
                l_iris_y * scale_up_y,
                l_r * max(scale_up_x, scale_up_y),
            )
            r_hires = self._refine_iris_hires(
                hires_gray,
                r_iris_x * scale_up_x,
                r_iris_y * scale_up_y,
                r_r * max(scale_up_x, scale_up_y),
            )
            # Map refined centers back into processing-resolution coordinates
            # so the eye-corner anchor math downstream keeps its scale.
            if l_hires is not None:
                l_iris_x = l_hires[0] / scale_up_x
                l_iris_y = l_hires[1] / scale_up_y
            if r_hires is not None:
                r_iris_x = r_hires[0] / scale_up_x
                r_iris_y = r_hires[1] / scale_up_y

        l_left_x  = landmarks[LEFT_EYE_LEFT].x  * frame_width
        l_left_y  = landmarks[LEFT_EYE_LEFT].y  * frame_height
        l_right_x = landmarks[LEFT_EYE_RIGHT].x * frame_width
        l_right_y = landmarks[LEFT_EYE_RIGHT].y * frame_height

        r_left_x  = landmarks[RIGHT_EYE_LEFT].x  * frame_width
        r_left_y  = landmarks[RIGHT_EYE_LEFT].y  * frame_height
        r_right_x = landmarks[RIGHT_EYE_RIGHT].x * frame_width
        r_right_y = landmarks[RIGHT_EYE_RIGHT].y * frame_height

        raw = {
            'l_left_x': l_left_x,  'l_left_y': l_left_y,
            'l_right_x': l_right_x, 'l_right_y': l_right_y,
            'r_left_x': r_left_x,  'r_left_y': r_left_y,
            'r_right_x': r_right_x, 'r_right_y': r_right_y,
        }

        # --- Lowpass-filter the head-frame anchor (eye corners) ---
        if self._eye_anchor is None:
            self._eye_anchor = dict(raw)
        else:
            a = self._eye_anchor_alpha
            for k, v in raw.items():
                self._eye_anchor[k] = a * v + (1 - a) * self._eye_anchor[k]

        a = self._eye_anchor
        # Per-eye center & width from the smoothed anchor
        l_cx = (a['l_left_x'] + a['l_right_x']) * 0.5
        l_cy = (a['l_left_y'] + a['l_right_y']) * 0.5
        l_w  = a['l_right_x'] - a['l_left_x']
        r_cx = (a['r_left_x'] + a['r_right_x']) * 0.5
        r_cy = (a['r_left_y'] + a['r_right_y']) * 0.5
        r_w  = a['r_right_x'] - a['r_left_x']

        if abs(l_w) < 5.0 or abs(r_w) < 5.0:
            return None, None, False

        # Iris offset from each eye's smoothed center, normalized by eye_width
        # (use eye_width for BOTH axes — eye_height is too noisy/small).
        l_norm_x = (l_iris_x - l_cx) / l_w
        l_norm_y = (l_iris_y - l_cy) / l_w
        r_norm_x = (r_iris_x - r_cx) / r_w
        r_norm_y = (r_iris_y - r_cy) / r_w

        # Binocular average
        norm_x = (l_norm_x + r_norm_x) * 0.5
        norm_y = (l_norm_y + r_norm_y) * 0.5

        # Rescale to "synthetic pixels" using inter-ocular distance, so the
        # rest of the pipeline keeps its familiar magnitudes (~80–120px sweep).
        inter_ocular = abs(l_cx - r_cx)
        if inter_ocular < 1.0:
            inter_ocular = 1.0
        gaze_x = norm_x * inter_ocular * 2.0
        gaze_y = norm_y * inter_ocular * 2.0

        return gaze_x, gaze_y, True

    @staticmethod
    def _poly2_features(x, y):
        """2nd-order polynomial feature vector: [1, x, y, x*y, x^2, y^2]."""
        return np.array([1.0, x, y, x * y, x * x, y * y], dtype=np.float64)

    @staticmethod
    def _aggregate_point_samples(samples):
        """Robust per-point aggregation: drop settling prefix, MAD outlier rejection, median.

        Returns (iris_x, iris_y, weight) where weight = 1 / (stability_spread + 1).
        """
        n = len(samples)
        if n == 0:
            return None
        xs = np.array([s[0] for s in samples], dtype=np.float64)
        ys = np.array([s[1] for s in samples], dtype=np.float64)

        # Drop the first 30% — eye is still settling onto the new dot
        if n >= 10:
            drop = max(3, int(n * 0.30))
            xs = xs[drop:]
            ys = ys[drop:]

        if xs.size < 3:
            return float(np.median(xs)), float(np.median(ys)), 1.0

        # MAD-based outlier rejection (robust to saccades / glints)
        med_x, med_y = np.median(xs), np.median(ys)
        mad_x = np.median(np.abs(xs - med_x)) + 1e-6
        mad_y = np.median(np.abs(ys - med_y)) + 1e-6
        # 3 * MAD ≈ 2 sigma for normal data
        mask = (np.abs(xs - med_x) <= 3.0 * mad_x) & (np.abs(ys - med_y) <= 3.0 * mad_y)
        if mask.sum() >= 3:
            xs = xs[mask]
            ys = ys[mask]

        iris_x = float(np.median(xs))
        iris_y = float(np.median(ys))
        spread = float(np.median(np.abs(xs - iris_x)) + np.median(np.abs(ys - iris_y)))
        weight = 1.0 / (spread + 1.0)
        return iris_x, iris_y, weight

    def _fit_poly2_gaze_model(self, src, dst, weights):
        """Fit weighted 2nd-order polynomial mapping iris → screen for x and y axes.

        src: (N, 2) iris coords; dst: (N, 2) screen coords; weights: (N,)
        Returns dict or None if fitting fails.
        """
        n = src.shape[0]
        if n < 6:
            return None

        # Normalize iris coords for numerical stability
        iris_mean = src.mean(axis=0)
        iris_scale = src.std(axis=0) + 1e-6
        nx = (src[:, 0] - iris_mean[0]) / iris_scale[0]
        ny = (src[:, 1] - iris_mean[1]) / iris_scale[1]

        # Design matrix with 2nd-order features: [1, x, y, xy, x², y²]
        X = np.stack([
            np.ones_like(nx), nx, ny, nx * ny, nx * nx, ny * ny,
        ], axis=1)

        w = np.clip(weights, 0.1, 10.0)
        W = np.diag(w)

        try:
            # Weighted least squares: (X'WX) β = X'W y
            XtW = X.T @ W
            coeffs_x, *_ = np.linalg.lstsq(XtW @ X, XtW @ dst[:, 0], rcond=None)
            coeffs_y, *_ = np.linalg.lstsq(XtW @ X, XtW @ dst[:, 1], rcond=None)
        except np.linalg.LinAlgError:
            return None

        # Sanity: ensure coefficients are finite
        if not (np.all(np.isfinite(coeffs_x)) and np.all(np.isfinite(coeffs_y))):
            return None

        return {
            'type': 'poly2',
            'coeffs_x': coeffs_x,
            'coeffs_y': coeffs_y,
            'iris_mean': iris_mean,
            'iris_scale': iris_scale,
        }

    def _evaluate_model_residuals(self, model, src, dst):
        """Return per-point residuals (screen-pixel distance) and summary stats."""
        preds = []
        for ix, iy in src:
            nx = (ix - model['iris_mean'][0]) / max(model['iris_scale'][0], 1e-6)
            ny = (iy - model['iris_mean'][1]) / max(model['iris_scale'][1], 1e-6)
            feats = self._poly2_features(nx, ny)
            preds.append([feats @ model['coeffs_x'], feats @ model['coeffs_y']])
        preds = np.array(preds)
        errs = np.linalg.norm(preds - dst, axis=1)
        return errs

    def _apply_gaze_model(self, iris_x, iris_y):
        """Map iris → screen using polynomial model if available, else homography."""
        if self.gaze_model is not None and self.gaze_model.get('type') == 'poly2':
            nx = (iris_x - self.gaze_model['iris_mean'][0]) / max(self.gaze_model['iris_scale'][0], 1e-6)
            ny = (iris_y - self.gaze_model['iris_mean'][1]) / max(self.gaze_model['iris_scale'][1], 1e-6)
            feats = self._poly2_features(nx, ny)
            screen_x = float(feats @ self.gaze_model['coeffs_x'])
            screen_y = float(feats @ self.gaze_model['coeffs_y'])
        elif self.homography is not None:
            point = np.array([[[iris_x, iris_y]]], dtype=np.float64)
            transformed = cv2.perspectiveTransform(point, self.homography)
            screen_x = float(transformed[0][0][0])
            screen_y = float(transformed[0][0][1])
        else:
            return None, None

        screen_x = max(0, min(self.screen_width - 1, screen_x))
        screen_y = max(0, min(self.screen_height - 1, screen_y))
        return screen_x, screen_y

    # Back-compat alias
    def _apply_homography(self, iris_x, iris_y):
        return self._apply_gaze_model(iris_x, iris_y)

    def _smooth(self, x, y):
        """Apply exponential moving average smoothing."""
        if self.smoothed_x is None:
            self.smoothed_x = x
            self.smoothed_y = y
        else:
            self.smoothed_x = self.smoothing_alpha * x + (1 - self.smoothing_alpha) * self.smoothed_x
            self.smoothed_y = self.smoothing_alpha * y + (1 - self.smoothing_alpha) * self.smoothed_y
        return self.smoothed_x, self.smoothed_y

    def _compute_ear(self, landmarks, frame_width, frame_height):
        """Compute Eye Aspect Ratio (EAR) for blink detection.
        EAR = (|top - bottom|) / (|left - right|) averaged over both eyes.
        Low EAR (~<0.21) indicates a blink."""
        def dist(a, b):
            return np.sqrt((a.x - b.x)**2 + (a.y - b.y)**2)

        # Left eye
        left_v = dist(landmarks[LEFT_EYE_TOP], landmarks[LEFT_EYE_BOTTOM])
        left_h = dist(landmarks[LEFT_EYE_LEFT], landmarks[LEFT_EYE_RIGHT])
        left_ear = left_v / (left_h + 1e-6)

        # Right eye
        right_v = dist(landmarks[RIGHT_EYE_TOP], landmarks[RIGHT_EYE_BOTTOM])
        right_h = dist(landmarks[RIGHT_EYE_LEFT], landmarks[RIGHT_EYE_RIGHT])
        right_ear = right_v / (right_h + 1e-6)

        return (left_ear + right_ear) / 2.0

    def _detect_blink(self, ear):
        """Update blink state based on current EAR value.
        Returns True if currently in a blink."""
        if ear < EAR_BLINK_THRESHOLD:
            self.blink_counter += 1
        else:
            if self.blink_counter >= EAR_CONSEC_FRAMES:
                self.blink_total += 1
            self.blink_counter = 0

        self.is_blinking = self.blink_counter >= EAR_CONSEC_FRAMES
        return self.is_blinking

    def _adaptive_smooth(self, x, y):
        """1€ Filter smoother with sub-pixel dead-zone.

        Each axis is filtered independently. The cutoff frequency adapts to
        the local velocity of that axis, so gaze fixations are filtered very
        hard (near-static cursor) while saccades pass through with low lag.
        A final dead-zone suppresses the last ~1-3 px of residual jitter by
        holding the emitted cursor position unless the filtered target has
        moved more than `deadzone_px` from the last emission.
        """
        now = time.time()
        if self._oe_prev_time is None:
            self._oe_prev_time = now
            self._oe_prev_x = x
            self._oe_prev_y = y
            self._oe_prev_dx = 0.0
            self._oe_prev_dy = 0.0
            self.smoothed_x = x
            self.smoothed_y = y
            self._last_emit_x = x
            self._last_emit_y = y
            return x, y

        dt = max(now - self._oe_prev_time, 1e-3)
        self._oe_prev_time = now

        def _alpha(cutoff_hz):
            # Standard EMA alpha for a discrete 1-pole lowpass at cutoff_hz
            tau = 1.0 / (2.0 * np.pi * cutoff_hz)
            return 1.0 / (1.0 + tau / dt)

        # ── Derivative (velocity) estimator, itself lowpass-filtered ──
        raw_dx = (x - self._oe_prev_x) / dt
        raw_dy = (y - self._oe_prev_y) / dt
        ad = _alpha(self.oe_d_cutoff)
        dx = ad * raw_dx + (1 - ad) * self._oe_prev_dx
        dy = ad * raw_dy + (1 - ad) * self._oe_prev_dy
        self._oe_prev_dx = dx
        self._oe_prev_dy = dy

        # ── Adaptive cutoff: more velocity → higher cutoff → more responsive ──
        cutoff_x = self.oe_min_cutoff + self.oe_beta * abs(dx)
        cutoff_y = self.oe_min_cutoff + self.oe_beta * abs(dy)
        ax = _alpha(cutoff_x)
        ay = _alpha(cutoff_y)

        sx = ax * x + (1 - ax) * self.smoothed_x if self.smoothed_x is not None else x
        sy = ay * y + (1 - ay) * self.smoothed_y if self.smoothed_y is not None else y
        self.smoothed_x = sx
        self.smoothed_y = sy
        self._oe_prev_x = x
        self._oe_prev_y = y

        # ── Dead-zone: hold the last emitted cursor unless we've moved enough ──
        if self._last_emit_x is None:
            self._last_emit_x = sx
            self._last_emit_y = sy
            return sx, sy

        dist = np.hypot(sx - self._last_emit_x, sy - self._last_emit_y)
        if dist < self.deadzone_px:
            return self._last_emit_x, self._last_emit_y

        self._last_emit_x = sx
        self._last_emit_y = sy
        return sx, sy

    def _estimate_head_pose(self, landmarks, frame_width, frame_height):
        """Estimate head yaw and pitch from 6 key face landmarks using solvePnP."""
        # 3D model points (generic face model, centered at nose tip)
        model_points = np.array([
            (0.0, 0.0, 0.0),          # Nose tip
            (0.0, -63.6, -12.5),       # Chin
            (-43.3, 32.7, -26.0),      # Left eye left corner
            (43.3, 32.7, -26.0),       # Right eye right corner
            (-28.9, -28.9, -24.1),     # Left mouth corner
            (28.9, -28.9, -24.1),      # Right mouth corner
        ], dtype=np.float64)

        # 2D image points from landmarks
        image_points = np.array([
            (landmarks[idx].x * frame_width, landmarks[idx].y * frame_height)
            for idx in HEAD_POSE_LANDMARKS
        ], dtype=np.float64)

        # Camera internals (approximate)
        focal_length = frame_width
        center = (frame_width / 2, frame_height / 2)
        camera_matrix = np.array([
            [focal_length, 0, center[0]],
            [0, focal_length, center[1]],
            [0, 0, 1],
        ], dtype=np.float64)
        dist_coeffs = np.zeros((4, 1))

        success, rotation_vector, translation_vector = cv2.solvePnP(
            model_points, image_points, camera_matrix, dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not success:
            return 0.0, 0.0

        # Convert rotation vector to Euler angles
        rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
        # Extract yaw (Y-axis) and pitch (X-axis) from rotation matrix
        yaw = np.arctan2(rotation_matrix[2][0], rotation_matrix[2][2])
        pitch = np.arctan2(-rotation_matrix[2][1],
                           np.sqrt(rotation_matrix[2][0]**2 + rotation_matrix[2][2]**2))

        return float(yaw), float(pitch)

    def _apply_head_compensation(self, screen_x, screen_y, yaw, pitch):
        """Offset gaze position based on head rotation delta from baseline."""
        if self.base_head_yaw is None:
            # First frame: set baseline
            self.base_head_yaw = yaw
            self.base_head_pitch = pitch
            return screen_x, screen_y

        delta_yaw = yaw - self.base_head_yaw
        delta_pitch = pitch - self.base_head_pitch

        # Only compensate small head movements (within ~15 degrees)
        max_angle = 0.26  # ~15 degrees in radians
        delta_yaw = max(-max_angle, min(max_angle, delta_yaw))
        delta_pitch = max(-max_angle, min(max_angle, delta_pitch))

        # Offset: head turns right → gaze drifts left, so subtract
        comp_x = screen_x - delta_yaw * self.head_compensation_gain
        comp_y = screen_y + delta_pitch * self.head_compensation_gain

        # Clamp
        comp_x = max(0, min(self.screen_width - 1, comp_x))
        comp_y = max(0, min(self.screen_height - 1, comp_y))

        return comp_x, comp_y

    def _handle_calibration_frame(self, iris_x, iris_y):
        """Collect iris sample for the current calibration point."""
        if self.current_cal_point is None:
            return

        idx = self.current_cal_point
        if idx not in self.calibration_points:
            return

        point = self.calibration_points[idx]
        samples = point["iris_samples"]
        samples.append((iris_x, iris_y))

        n = len(samples)
        # Per-point overrides (used by the moving-dot prelude for rapid capture)
        min_samples = point.get("min_samples") or self.cal_sample_count
        max_samples = point.get("max_samples") or self.cal_max_samples

        # Check gaze stability over the last 15 samples
        stable = False
        if n >= 15:
            recent = samples[-15:]
            xs = [s[0] for s in recent]
            ys = [s[1] for s in recent]
            stable = bool(np.std(xs) < 4.0 and np.std(ys) < 4.0)

        done = bool((n >= min_samples and stable) or n >= max_samples)

        self._emit({
            "status": "calibrating",
            "point_index": idx,
            "samples": n,
            "target": min_samples,
            "stable": stable,
            "done": done,
        })

        if done:
            self.current_cal_point = None  # Done collecting for this point

    def start_calibration_point(self, index, screen_x, screen_y, min_samples=None, max_samples=None):
        """Begin collecting samples for a calibration point.

        Optional per-point thresholds (min_samples, max_samples) let the moving-dot
        prelude capture small bursts (e.g. 3-8 frames) per sub-target while the
        static grid keeps the default ~25-90 frame window.
        """
        self.calibration_points[index] = {
            "screen": (screen_x, screen_y),
            "iris_samples": [],
            "min_samples": min_samples,
            "max_samples": max_samples,
        }
        self.current_cal_point = index
        self.calibrating = True

    def load_prior_calibration(self, points):
        """Seed the fit with previously-calibrated aggregated points (optimize mode).

        `points` is a list of dicts with keys screenX, screenY, irisX, irisY, [weight].
        Stored points are merged (at discounted weight) during finish_calibration().
        """
        self.prior_calibration_points = []
        if not isinstance(points, list):
            self._emit({"error": "load_prior_calibration: points must be a list"})
            return
        for p in points:
            try:
                self.prior_calibration_points.append({
                    "sx": float(p["screenX"]),
                    "sy": float(p["screenY"]),
                    "ix": float(p["irisX"]),
                    "iy": float(p["irisY"]),
                    "w":  float(p.get("weight", 1.0)),
                })
            except (KeyError, TypeError, ValueError):
                continue
        self._emit({
            "status": "prior_calibration_loaded",
            "count": len(self.prior_calibration_points),
        })

    def finish_calibration(self, output_file):
        """Compute gaze model (weighted poly2 preferred, homography fallback) and save."""
        src_points = []   # aggregated iris coordinates
        dst_points = []   # screen coordinates
        weights = []      # per-point fit weights (inverse spread)
        agg_per_point = []  # for saving

        for idx in sorted(self.calibration_points.keys()):
            point = self.calibration_points[idx]
            samples = point["iris_samples"]
            # Moving-dot points have low overrides; honor them. Static dots need >=5.
            min_required = 3 if point.get("min_samples") else 5
            if len(samples) < min_required:
                # Skip silently — sparse moving-dot bursts shouldn't abort the fit.
                if point.get("min_samples"):
                    continue
                self._emit({"error": f"Not enough samples for point {idx} ({len(samples)} < {min_required})"})
                return False

            result = self._aggregate_point_samples(samples)
            if result is None or result[0] is None:
                self._emit({"error": f"Failed to aggregate samples for point {idx}"})
                return False
            iris_x, iris_y, weight = result

            src_points.append([iris_x, iris_y])
            dst_points.append(list(point["screen"]))
            weights.append(weight)
            agg_per_point.append({
                "index": idx,
                "screenX": point["screen"][0],
                "screenY": point["screen"][1],
                "irisX": iris_x,
                "irisY": iris_y,
                "sampleCount": len(samples),
                "weight": weight,
            })

        # ── Merge prior calibration points (optimize mode) ──
        # A new sample supersedes a prior point when they land near the same screen
        # position (within a proximity threshold scaled to screen size). This lets
        # the user re-calibrate with a DIFFERENT grid size (e.g. 16 → 25 points):
        # prior points far from any new dot still anchor the fit at 0.5× weight,
        # while prior points close to a fresh dot are dropped so they can't bias it.
        fresh_positions = [(p["screenX"], p["screenY"]) for p in agg_per_point]
        # ~4% of the screen diagonal — typical calibration dots are spaced >20%
        prox_threshold = 0.04 * float(np.hypot(self.screen_width, self.screen_height))
        prior_merged = 0
        prior_dropped_near_fresh = 0
        for pp in self.prior_calibration_points:
            near_fresh = False
            for (fx, fy) in fresh_positions:
                if abs(fx - pp["sx"]) <= prox_threshold and abs(fy - pp["sy"]) <= prox_threshold:
                    near_fresh = True
                    break
            if near_fresh:
                prior_dropped_near_fresh += 1
                continue
            src_points.append([pp["ix"], pp["iy"]])
            dst_points.append([pp["sx"], pp["sy"]])
            weights.append(pp["w"] * self.prior_weight_factor)
            agg_per_point.append({
                "index": -1,  # marker: came from prior calibration
                "screenX": pp["sx"],
                "screenY": pp["sy"],
                "irisX": pp["ix"],
                "irisY": pp["iy"],
                "sampleCount": 0,
                "weight": pp["w"] * self.prior_weight_factor,
                "fromPrior": True,
            })
            prior_merged += 1
        if prior_merged > 0 or prior_dropped_near_fresh > 0:
            self._emit({
                "status": "prior_points_merged",
                "count": prior_merged,
                "dropped_near_fresh": prior_dropped_near_fresh,
                "fresh_count": len(fresh_positions),
                "proximity_px": prox_threshold,
            })

        if len(src_points) < 4:
            self._emit({"error": f"Need at least 4 calibration points, got {len(src_points)}"})
            return False

        src = np.array(src_points, dtype=np.float64)
        dst = np.array(dst_points, dtype=np.float64)
        w = np.array(weights, dtype=np.float64)

        # ── Homography (always computed as fallback) ──
        homography, _ = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if homography is None:
            self._emit({"error": "Failed to compute homography matrix"})
            return False
        self.homography = homography

        # ── Polynomial model (preferred when ≥9 points) ──
        poly_model = None
        poly_residuals = None
        if len(src_points) >= 9:
            poly_model = self._fit_poly2_gaze_model(src, dst, w)
            if poly_model is not None:
                poly_residuals = self._evaluate_model_residuals(poly_model, src, dst)

        # ── Homography residuals (for comparison) ──
        hom_preds = cv2.perspectiveTransform(src.reshape(-1, 1, 2), homography).reshape(-1, 2)
        hom_residuals = np.linalg.norm(hom_preds - dst, axis=1)

        # Choose better model by mean residual
        use_poly = False
        chosen_residuals = hom_residuals
        model_type = "homography"
        if poly_model is not None and poly_residuals is not None:
            # Prefer polynomial if it improves mean residual by at least 15%
            if poly_residuals.mean() < hom_residuals.mean() * 0.85:
                use_poly = True
                chosen_residuals = poly_residuals
                model_type = "poly2"
            else:
                # Small improvement only → still prefer poly if it doesn't hurt max error significantly
                if poly_residuals.max() <= hom_residuals.max() * 1.1 and poly_residuals.mean() < hom_residuals.mean():
                    use_poly = True
                    chosen_residuals = poly_residuals
                    model_type = "poly2"

        if use_poly:
            self.gaze_model = poly_model
        else:
            self.gaze_model = None  # homography-only path

        # Attach per-point residuals to saved data
        for p, r in zip(agg_per_point, chosen_residuals):
            p["residualPx"] = float(r)

        cal_data = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "screenResolution": {"width": self.screen_width, "height": self.screen_height},
            "cameraIndex": self.camera_index,
            "points": agg_per_point,
            "homographyMatrix": homography.tolist(),
            "modelType": model_type,
            "meanResidualPx": float(chosen_residuals.mean()),
            "maxResidualPx": float(chosen_residuals.max()),
        }
        if use_poly and poly_model is not None:
            cal_data["gazeModel"] = {
                "type": "poly2",
                "coeffs_x": poly_model['coeffs_x'].tolist(),
                "coeffs_y": poly_model['coeffs_y'].tolist(),
                "iris_mean": poly_model['iris_mean'].tolist(),
                "iris_scale": poly_model['iris_scale'].tolist(),
            }

        try:
            with open(output_file, 'w') as f:
                json.dump(cal_data, f, indent=2)
            iris_xs = [p["irisX"] for p in cal_data["points"]]
            iris_ys = [p["irisY"] for p in cal_data["points"]]
            iris_range_x = float(max(iris_xs) - min(iris_xs)) if iris_xs else 0.0
            iris_range_y = float(max(iris_ys) - min(iris_ys)) if iris_ys else 0.0

            # Identify worst point so UI can suggest recalibration of that region
            worst_idx = int(np.argmax(chosen_residuals))
            worst_point = agg_per_point[worst_idx]

            self._emit({
                "calibration": "complete",
                "file": output_file,
                "iris_range_x": iris_range_x,
                "iris_range_y": iris_range_y,
                "num_points": len(cal_data["points"]),
                "model_type": model_type,
                "mean_residual_px": float(chosen_residuals.mean()),
                "max_residual_px": float(chosen_residuals.max()),
                "worst_point": {
                    "index": worst_point["index"],
                    "screenX": worst_point["screenX"],
                    "screenY": worst_point["screenY"],
                    "residualPx": float(chosen_residuals[worst_idx]),
                },
                "hom_mean_residual_px": float(hom_residuals.mean()),
                "poly_mean_residual_px": float(poly_residuals.mean()) if poly_residuals is not None else None,
            })
            self.calibrating = False
            return True
        except Exception as e:
            self._emit({"error": f"Failed to save calibration: {str(e)}"})
            return False

    def run(self, duration=0, mode="track"):
        """Main tracking loop."""
        self.running = True

        import platform
        backend = cv2.CAP_DSHOW if platform.system() == 'Windows' else cv2.CAP_ANY
        cap = cv2.VideoCapture(self.camera_index, backend)
        if not cap.isOpened():
            self._emit({"error": f"Cannot open camera {self.camera_index}"})
            return

        # Request a capture resolution. If caller provided explicit capture_width/
        # height (e.g. 3840×2160 for a 4K IR or RGB camera), honor it so the
        # native high-res frame is available for the hires_iris refinement stage.
        # Otherwise request a sensible default (1280×720).
        req_w = self.capture_width if self.capture_width > 0 else 1280
        req_h = self.capture_height if self.capture_height > 0 else 720
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, req_w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, req_h)
        try:
            cap.set(cv2.CAP_PROP_FPS, 30)
        except Exception:
            pass

        # Target processing resolution — MediaPipe face mesh is tuned around
        # 640 px wide by default. Higher values give more iris precision but
        # cost CPU. Exposed so users with 1080p/4K IR cameras can trade off.
        PROCESS_MAX_WIDTH = self.process_width
        PROCESS_MAX_HEIGHT = self.process_height

        # Emit camera_opened status so UI knows the backend is alive
        actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        self._emit({
            "status": "camera_opened",
            "camera_index": self.camera_index,
            "width": actual_w,
            "height": actual_h,
            "process_width": PROCESS_MAX_WIDTH,
            "process_height": PROCESS_MAX_HEIGHT,
            "ir_mode": self.ir_mode,
            "hires_iris": self.hires_iris,
            "mode": mode,
        })

        mp_face_mesh = mp.solutions.face_mesh
        # IR frames are lower-contrast for face detection than RGB, so relax
        # the confidence thresholds a bit when ir_mode is enabled.
        det_conf = 0.2 if self.ir_mode else 0.3
        trk_conf = 0.2 if self.ir_mode else 0.3
        face_mesh = mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,  # Enables iris landmarks (468-477)
            min_detection_confidence=det_conf,
            min_tracking_confidence=trk_conf,
        )

        start_time = time.time()
        no_face_count = 0
        face_was_lost = True  # Track face acquisition for status emission

        try:
            while self.running:
                # Check duration
                if duration > 0 and (time.time() - start_time) >= duration:
                    self._emit({"status": "duration_complete", "elapsed": duration})
                    break

                ret, frame = cap.read()
                if not ret:
                    no_face_count += 1
                    if no_face_count > 30:
                        self._emit({"error": "Camera read failure"})
                    continue

                # ── IR preprocessing ──
                # Windows Hello / UVC IR streams arrive as either single-channel
                # or 3-channel-but-grayscale frames. MediaPipe wants a 3-channel
                # "RGB" image, so we collapse to 1 channel, CLAHE-boost the
                # contrast (pupils/iris are very high-contrast under IR), then
                # stack back to 3 channels. This dramatically improves
                # face-mesh detection under low ambient light.
                if self.ir_mode:
                    if frame.ndim == 3 and frame.shape[2] >= 3:
                        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    elif frame.ndim == 3 and frame.shape[2] == 1:
                        gray = frame[:, :, 0]
                    else:
                        gray = frame
                    if self._clahe is not None:
                        gray = self._clahe.apply(gray)
                    frame = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

                # ── Keep the original (possibly 4K) frame for hires iris refinement ──
                orig_frame = frame
                orig_h, orig_w = orig_frame.shape[:2]

                # ── Downscale huge frames (e.g. 4K webcams) before processing ──
                fh, fw = frame.shape[:2]
                scale_down = 1.0
                if fw > PROCESS_MAX_WIDTH or fh > PROCESS_MAX_HEIGHT:
                    scale_down = min(PROCESS_MAX_WIDTH / fw, PROCESS_MAX_HEIGHT / fh)
                    new_w = max(1, int(fw * scale_down))
                    new_h = max(1, int(fh * scale_down))
                    frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
                # Scale factor to go from processing-res back to original-res pixels
                proc_h, proc_w = frame.shape[:2]
                scale_up_x = orig_w / max(proc_w, 1)
                scale_up_y = orig_h / max(proc_h, 1)

                self.preview_frame_counter += 1

                # Emit preview BEFORE MediaPipe processing so the UI receives
                # live camera frames even when face_mesh.process() is slow or
                # blocks early (first frames after cold start).
                if mode == "calibrate" or self.calibrating:
                    if self.preview_frame_counter % self.preview_emit_every == 0:
                        preview_image = encode_preview_image(frame)
                        if preview_image:
                            self._emit({
                                "status": "calibration_preview",
                                "image": preview_image,
                                "frame": self.preview_frame_counter,
                            })

                # Convert BGR to RGB for MediaPipe
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = face_mesh.process(rgb_frame)

                if not results.multi_face_landmarks:
                    no_face_count += 1
                    face_was_lost = True

                    # ── Grace period: hold last position when face briefly lost ──
                    if mode == "track" and self.smoothed_x is not None:
                        if self.face_lost_time is None:
                            self.face_lost_time = time.time()
                        elapsed_lost = time.time() - self.face_lost_time
                        if elapsed_lost < self.grace_period:
                            # Emit last known position with decaying confidence
                            decay = max(0.3, 1.0 - (elapsed_lost / self.grace_period))
                            self._emit({
                                "x": round(self.smoothed_x),
                                "y": round(self.smoothed_y),
                                "confidence": round(decay, 3),
                                "both_eyes": False,
                                "held": True,
                            })
                            continue

                    if no_face_count % 30 == 0:  # Report every ~1 second
                        self._emit({"error": "No face detected", "frames_missed": no_face_count})
                    continue

                # Face found — reset grace period and emit status if previously lost
                self.face_lost_time = None
                if face_was_lost:
                    face_was_lost = False
                    self._emit({"status": "face_detected"})
                no_face_count = 0
                landmarks = results.multi_face_landmarks[0].landmark
                h, w = frame.shape[:2]

                # ── Blink detection ──
                ear = self._compute_ear(landmarks, w, h)
                is_blink = self._detect_blink(ear)

                # Prepare the original-resolution grayscale frame for sub-pixel
                # iris refinement (optional). We only pay this cost when the
                # user opted into hires_iris AND the original frame is larger
                # than our processing frame — otherwise refinement is a no-op.
                hires_gray = None
                if self.hires_iris and (scale_up_x > 1.01 or scale_up_y > 1.01):
                    if orig_frame.ndim == 3 and orig_frame.shape[2] >= 3:
                        hires_gray = cv2.cvtColor(orig_frame, cv2.COLOR_BGR2GRAY)
                    else:
                        hires_gray = orig_frame if orig_frame.ndim == 2 else orig_frame[:, :, 0]

                iris_x, iris_y, both_eyes = self._get_iris_center(
                    landmarks, w, h,
                    hires_gray=hires_gray,
                    scale_up_x=scale_up_x,
                    scale_up_y=scale_up_y,
                )
                if iris_x is None or iris_y is None:
                    # Degenerate eye geometry (e.g. closed eyes / extreme angle); skip frame.
                    continue

                # Compute a simple confidence based on landmark visibility
                left_vis = landmarks[LEFT_IRIS_CENTER].visibility if hasattr(landmarks[LEFT_IRIS_CENTER], 'visibility') else 1.0
                right_vis = landmarks[RIGHT_IRIS_CENTER].visibility if hasattr(landmarks[RIGHT_IRIS_CENTER], 'visibility') else 1.0
                confidence = (left_vis + right_vis) / 2.0
                # MediaPipe doesn't always provide meaningful visibility for iris,
                # so we use presence as a proxy — if we got landmarks, confidence is high
                if confidence < 0.01:
                    confidence = 0.85

                if mode == "test":
                    # Raw output without calibration mapping
                    self._emit({
                        "iris_x": round(iris_x, 2),
                        "iris_y": round(iris_y, 2),
                        "confidence": round(confidence, 3),
                        "both_eyes": both_eyes,
                        "frame_size": [w, h],
                        "ear": round(ear, 3),
                        "blink": is_blink,
                    })
                    continue

                if mode == "calibrate" or self.calibrating:
                    if not is_blink:  # Don't collect samples during blinks
                        self._handle_calibration_frame(iris_x, iris_y)
                    continue

                # Mode: track — map to screen coordinates
                if self.homography is None and self.gaze_model is None:
                    self._emit({"error": "No calibration data — run calibration first"})
                    time.sleep(1)  # Don't spam
                    continue

                # ── Skip cursor movement during blinks ──
                if is_blink:
                    self._emit({
                        "x": round(self.smoothed_x) if self.smoothed_x else 0,
                        "y": round(self.smoothed_y) if self.smoothed_y else 0,
                        "confidence": 0.0,
                        "both_eyes": both_eyes,
                        "blink": True,
                    })
                    continue

                screen_x, screen_y = self._apply_homography(iris_x, iris_y)
                if screen_x is None:
                    continue

                # ── Head pose compensation ──
                yaw, pitch = self._estimate_head_pose(landmarks, w, h)
                screen_x, screen_y = self._apply_head_compensation(screen_x, screen_y, yaw, pitch)

                # ── Adaptive velocity-based smoothing ──
                smooth_x, smooth_y = self._adaptive_smooth(screen_x, screen_y)

                self._emit({
                    "x": round(smooth_x),
                    "y": round(smooth_y),
                    "confidence": round(confidence, 3),
                    "both_eyes": both_eyes,
                    "ear": round(ear, 3),
                })

        finally:
            face_mesh.close()
            cap.release()
            self._emit({"status": "stopped"})

    def stop(self):
        """Signal the tracking loop to stop."""
        self.running = False


def list_cameras(max_index=8):
    """Probe camera indices and return metadata.

    On Windows, try to enumerate DirectShow device names with pygrabber so the
    returned names align with the same backend OpenCV uses for calibration.
    """
    import platform

    system = platform.system()
    backend = cv2.CAP_DSHOW if system == 'Windows' else cv2.CAP_ANY
    available = []
    names_by_index = {}

    if system == 'Windows':
        try:
            from pygrabber.dshow_graph import FilterGraph
            devices = FilterGraph().get_input_devices()
            for idx, name in enumerate(devices):
                names_by_index[idx] = name
        except Exception:
            names_by_index = {}

    for i in range(max_index):
        cap = cv2.VideoCapture(i, backend)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret:
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
                available.append({
                    "index": i,
                    "name": names_by_index.get(i, f"Camera {i}"),
                    "width": width,
                    "height": height,
                    "backend": "dshow" if system == 'Windows' else "default",
                })
            cap.release()
    return available


def snapshot_camera(camera_index, max_width=640, max_height=360):
    """Capture a single preview frame from the selected camera index."""
    import platform

    backend = cv2.CAP_DSHOW if platform.system() == 'Windows' else cv2.CAP_ANY
    camera_meta = next((camera for camera in list_cameras(max(camera_index + 1, 8)) if camera.get("index") == camera_index), None)

    cap = cv2.VideoCapture(camera_index, backend)
    if not cap.isOpened():
        return {"error": f"Cannot open camera {camera_index}"}

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    frame = None
    for _ in range(12):
        ret, candidate = cap.read()
        if ret and candidate is not None:
            frame = candidate
            break
        time.sleep(0.08)
    cap.release()

    if frame is None:
        return {"error": f"Camera {camera_index} did not return a frame"}

    height, width = frame.shape[:2]
    scale = min(max_width / max(width, 1), max_height / max(height, 1), 1.0)
    if scale < 1.0:
        frame = cv2.resize(frame, (max(1, int(width * scale)), max(1, int(height * scale))))

    success, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not success:
        return {"error": f"Failed to encode preview for camera {camera_index}"}

    image_b64 = base64.b64encode(encoded.tobytes()).decode('ascii')
    return {
        "snapshot": {
            "index": camera_index,
            "name": camera_meta.get("name", f"Camera {camera_index}") if camera_meta else f"Camera {camera_index}",
            "image": f"data:image/jpeg;base64,{image_b64}",
            "width": int(frame.shape[1]),
            "height": int(frame.shape[0]),
        }
    }


def stdin_listener(tracker, calibration_output_file):
    """Listen for JSON commands on stdin in a separate thread."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue

        if cmd.get("cmd") == "stop":
            tracker.stop()
            break
        elif cmd.get("cmd") == "calibrate_point":
            tracker.start_calibration_point(
                cmd["index"],
                cmd["screen_x"],
                cmd["screen_y"],
                min_samples=cmd.get("min_samples"),
                max_samples=cmd.get("max_samples"),
            )
        elif cmd.get("cmd") == "finish_calibration":
            output = cmd.get("output_file", calibration_output_file)
            tracker.finish_calibration(output)
        elif cmd.get("cmd") == "load_prior_calibration":
            tracker.load_prior_calibration(cmd.get("points", []))


def main():
    parser = argparse.ArgumentParser(description="CSimple Eye Tracker")
    parser.add_argument("--camera_index", type=int, default=0, help="Webcam index")
    parser.add_argument("--screen_width", type=int, default=1920, help="Screen width in pixels")
    parser.add_argument("--screen_height", type=int, default=1080, help="Screen height in pixels")
    parser.add_argument("--calibration_file", type=str, default=None, help="Path to calibration JSON")
    parser.add_argument("--duration", type=int, default=0, help="Duration in seconds (0 = indefinite)")
    parser.add_argument("--mode", type=str, default="track", choices=["track", "calibrate", "test", "list_cameras", "snapshot_camera"],
                        help="Operating mode")
    parser.add_argument("--smoothing", type=float, default=0.3, help="Smoothing alpha (0-1, higher = less smooth)")
    parser.add_argument("--confidence_threshold", type=float, default=0.6, help="Minimum confidence to emit coordinates")
    parser.add_argument("--oe_min_cutoff", type=float, default=0.8,
                        help="1€ filter cutoff (Hz) at zero velocity. Lower = more stable at rest (default 0.8).")
    parser.add_argument("--oe_beta", type=float, default=0.007,
                        help="1€ filter velocity-cutoff gain. Higher = more responsive during saccades (default 0.007).")
    parser.add_argument("--deadzone_px", type=float, default=4.0,
                        help="Dead-zone radius in screen px — cursor holds until smoothed target moves more than this (default 4).")
    parser.add_argument("--ir_mode", action="store_true",
                        help="Treat the camera as a grayscale IR camera (Windows Hello / UVC IR). "
                             "Applies CLAHE contrast boost and relaxes face-mesh thresholds.")
    parser.add_argument("--process_width", type=int, default=640,
                        help="Max frame width used for MediaPipe face mesh. Larger = more iris precision, more CPU.")
    parser.add_argument("--process_height", type=int, default=480,
                        help="Max frame height used for MediaPipe face mesh.")
    parser.add_argument("--hires_iris", action="store_true",
                        help="Refine iris center on the original full-resolution frame using a dark-pupil centroid. "
                             "Useful for 1080p IR or 4K webcams.")
    parser.add_argument("--capture_width", type=int, default=0,
                        help="Requested camera capture width (0 = driver default / 1280). "
                             "Set to the camera's native resolution (e.g. 3840) to enable hires_iris benefit.")
    parser.add_argument("--capture_height", type=int, default=0,
                        help="Requested camera capture height (0 = driver default / 720).")
    args = parser.parse_args()

    if args.mode == "list_cameras":
        cameras = list_cameras()
        print(json.dumps({"cameras": cameras}), flush=True)
        return

    if args.mode == "snapshot_camera":
        print(json.dumps(snapshot_camera(args.camera_index)), flush=True)
        return

    tracker = EyeTracker(
        camera_index=args.camera_index,
        screen_width=args.screen_width,
        screen_height=args.screen_height,
        calibration_file=args.calibration_file,
        smoothing_alpha=args.smoothing,
        confidence_threshold=args.confidence_threshold,
        ir_mode=args.ir_mode,
        process_width=args.process_width,
        process_height=args.process_height,
        hires_iris=args.hires_iris,
        capture_width=args.capture_width,
        capture_height=args.capture_height,
    )
    # Override 1€ filter + dead-zone knobs from CLI
    tracker.oe_min_cutoff = args.oe_min_cutoff
    tracker.oe_beta = args.oe_beta
    tracker.deadzone_px = args.deadzone_px

    # Start stdin listener in a daemon thread
    cal_output = args.calibration_file or "eye-calibration.json"
    listener = threading.Thread(target=stdin_listener, args=(tracker, cal_output), daemon=True)
    listener.start()

    tracker.run(duration=args.duration, mode=args.mode)


if __name__ == "__main__":
    main()
