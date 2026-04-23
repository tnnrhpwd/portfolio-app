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
                 calibration_file=None, smoothing_alpha=0.3, confidence_threshold=0.6):
        self.camera_index = camera_index
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.calibration_file = calibration_file
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

        # ── Adaptive smoothing state ──
        self.prev_raw_x = None
        self.prev_raw_y = None
        self.prev_time = None
        self.smoothing_alpha_min = 0.28   # responsive even at fixations (prevents drift-lock)
        self.smoothing_alpha_max = 0.75   # very responsive during saccades
        self.velocity_threshold_low = 50   # px/frame below = fixation
        self.velocity_threshold_high = 300 # px/frame above = saccade

        # ── Head pose compensation state ──
        self.base_head_yaw = None
        self.base_head_pitch = None
        self.head_compensation_gain = 0.0  # disabled by default (was 150); iris-only tracking

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

    def _get_iris_center(self, landmarks, frame_width, frame_height):
        """Extract a head-pose-invariant gaze feature.

        PROBLEM: Raw iris pixel coordinates (iris.x * frame_width) move whenever
        the head translates, even if the eyes haven't moved relative to the head.
        That makes the calibration learn "head position → screen position" instead
        of true gaze, so the cursor follows your head instead of your eyes.

        FIX: Compute iris position *relative to its own eye corners*, which is
        invariant to head translation and largely invariant to head rotation
        (small angles). For each eye independently:
            norm_x = (iris_x - eye_left_x) / eye_width
            norm_y = (iris_y - eye_top_y) / eye_height
        Typical range ≈ [0.3, 0.7]. Then average left/right eyes, and finally
        rescale by a representative inter-ocular distance so downstream code
        (which expects pixel-like magnitudes) still gets sensible numbers.

        Returns (gaze_x, gaze_y, both_eyes) where gaze_{x,y} are in "synthetic
        pixel" units that depend ONLY on where the irises sit within the eye
        openings, not on where the head is in the frame.
        """
        # --- Left eye ---
        l_iris_x = landmarks[LEFT_IRIS_CENTER].x * frame_width
        l_iris_y = landmarks[LEFT_IRIS_CENTER].y * frame_height
        l_corner_left_x  = landmarks[LEFT_EYE_LEFT].x  * frame_width
        l_corner_left_y  = landmarks[LEFT_EYE_LEFT].y  * frame_height
        l_corner_right_x = landmarks[LEFT_EYE_RIGHT].x * frame_width
        l_corner_right_y = landmarks[LEFT_EYE_RIGHT].y * frame_height
        l_top_y    = landmarks[LEFT_EYE_TOP].y    * frame_height
        l_bottom_y = landmarks[LEFT_EYE_BOTTOM].y * frame_height

        l_eye_w = (l_corner_right_x - l_corner_left_x)
        l_eye_h = (l_bottom_y - l_top_y)
        if abs(l_eye_w) < 1e-3 or abs(l_eye_h) < 1e-3:
            return None, None, False
        # Eye-corner-relative iris position (origin = inner-left corner of eye)
        l_eye_cx = (l_corner_left_x + l_corner_right_x) * 0.5
        l_eye_cy = (l_top_y + l_bottom_y) * 0.5
        l_norm_x = (l_iris_x - l_eye_cx) / l_eye_w   # ≈ [-0.3, +0.3]
        l_norm_y = (l_iris_y - l_eye_cy) / l_eye_h   # ≈ [-0.4, +0.4]

        # --- Right eye ---
        r_iris_x = landmarks[RIGHT_IRIS_CENTER].x * frame_width
        r_iris_y = landmarks[RIGHT_IRIS_CENTER].y * frame_height
        r_corner_left_x  = landmarks[RIGHT_EYE_LEFT].x  * frame_width
        r_corner_left_y  = landmarks[RIGHT_EYE_LEFT].y  * frame_height
        r_corner_right_x = landmarks[RIGHT_EYE_RIGHT].x * frame_width
        r_corner_right_y = landmarks[RIGHT_EYE_RIGHT].y * frame_height
        r_top_y    = landmarks[RIGHT_EYE_TOP].y    * frame_height
        r_bottom_y = landmarks[RIGHT_EYE_BOTTOM].y * frame_height

        r_eye_w = (r_corner_right_x - r_corner_left_x)
        r_eye_h = (r_bottom_y - r_top_y)
        if abs(r_eye_w) < 1e-3 or abs(r_eye_h) < 1e-3:
            return None, None, False
        r_eye_cx = (r_corner_left_x + r_corner_right_x) * 0.5
        r_eye_cy = (r_top_y + r_bottom_y) * 0.5
        r_norm_x = (r_iris_x - r_eye_cx) / r_eye_w
        r_norm_y = (r_iris_y - r_eye_cy) / r_eye_h

        # Average both eyes (binocular fusion + noise reduction)
        norm_x = (l_norm_x + r_norm_x) * 0.5
        norm_y = (l_norm_y + r_norm_y) * 0.5

        # Rescale to "synthetic pixels" so the rest of the pipeline (poly2 fit,
        # iris-range diagnostics, residual thresholds) keeps working with
        # familiar magnitudes. Use inter-ocular distance as the unit length:
        # scale chosen so a fully-left → fully-right eye sweep spans roughly
        # the same pixel range as the old raw-iris-pixel feature did (~80px).
        inter_ocular = abs(((l_corner_left_x + l_corner_right_x) * 0.5)
                           - ((r_corner_left_x + r_corner_right_x) * 0.5))
        if inter_ocular < 1.0:
            inter_ocular = 1.0
        # Multiplier ≈ 200 gives sweep range ~80–120px for typical eyes
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
        """Velocity-adaptive smoothing: responsive during saccades, stable during fixations."""
        now = time.time()
        if self.prev_raw_x is None:
            self.prev_raw_x = x
            self.prev_raw_y = y
            self.prev_time = now
            self.smoothed_x = x
            self.smoothed_y = y
            return x, y

        dt = max(now - self.prev_time, 0.001)
        velocity = np.sqrt((x - self.prev_raw_x)**2 + (y - self.prev_raw_y)**2) / (dt * 30)  # normalize to ~30fps

        self.prev_raw_x = x
        self.prev_raw_y = y
        self.prev_time = now

        # Map velocity to alpha: low velocity = low alpha (smooth), high velocity = high alpha (responsive)
        if velocity <= self.velocity_threshold_low:
            alpha = self.smoothing_alpha_min
        elif velocity >= self.velocity_threshold_high:
            alpha = self.smoothing_alpha_max
        else:
            t = (velocity - self.velocity_threshold_low) / (self.velocity_threshold_high - self.velocity_threshold_low)
            alpha = self.smoothing_alpha_min + t * (self.smoothing_alpha_max - self.smoothing_alpha_min)

        self.smoothed_x = alpha * x + (1 - alpha) * self.smoothed_x
        self.smoothed_y = alpha * y + (1 - alpha) * self.smoothed_y
        return self.smoothed_x, self.smoothed_y

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

        # Request a modest resolution. Some cameras (4K webcams) ignore this
        # and deliver full-res frames, so we ALSO downscale in-loop below.
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        try:
            cap.set(cv2.CAP_PROP_FPS, 30)
        except Exception:
            pass

        # Target processing resolution — MediaPipe face mesh is tuned around
        # 640 px wide. Larger frames degrade detection and slow the loop.
        PROCESS_MAX_WIDTH = 640
        PROCESS_MAX_HEIGHT = 480

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
            "mode": mode,
        })

        mp_face_mesh = mp.solutions.face_mesh
        face_mesh = mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,  # Enables iris landmarks (468-477)
            min_detection_confidence=0.3,
            min_tracking_confidence=0.3,
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

                # ── Downscale huge frames (e.g. 4K webcams) before processing ──
                fh, fw = frame.shape[:2]
                if fw > PROCESS_MAX_WIDTH or fh > PROCESS_MAX_HEIGHT:
                    scale = min(PROCESS_MAX_WIDTH / fw, PROCESS_MAX_HEIGHT / fh)
                    new_w = max(1, int(fw * scale))
                    new_h = max(1, int(fh * scale))
                    frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

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

                iris_x, iris_y, both_eyes = self._get_iris_center(landmarks, w, h)
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
    )

    # Start stdin listener in a daemon thread
    cal_output = args.calibration_file or "eye-calibration.json"
    listener = threading.Thread(target=stdin_listener, args=(tracker, cal_output), daemon=True)
    listener.start()

    tracker.run(duration=args.duration, mode=args.mode)


if __name__ == "__main__":
    main()
