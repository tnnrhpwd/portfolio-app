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
        self.smoothed_x = None
        self.smoothed_y = None

        # Calibration state
        self.calibrating = False
        self.calibration_points = {}  # {index: {"screen": (x,y), "iris_samples": [(ix,iy), ...]}}
        self.current_cal_point = None
        self.cal_sample_count = 25  # Minimum frames to collect per point
        self.cal_max_samples = 90   # Max frames before forcing done

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
        """Load homography matrix from calibration JSON file."""
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            if 'homographyMatrix' in data:
                self.homography = np.array(data['homographyMatrix'], dtype=np.float64)
                self._emit({"status": "calibration_loaded", "file": filepath})
            else:
                self._emit({"error": f"No homography matrix in {filepath}"})
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
        """Extract the average iris center from both eyes in frame pixel coordinates."""
        left_x = landmarks[LEFT_IRIS_CENTER].x * frame_width
        left_y = landmarks[LEFT_IRIS_CENTER].y * frame_height
        right_x = landmarks[RIGHT_IRIS_CENTER].x * frame_width
        right_y = landmarks[RIGHT_IRIS_CENTER].y * frame_height

        both_eyes = True
        # Average of both iris centers
        iris_x = (left_x + right_x) / 2.0
        iris_y = (left_y + right_y) / 2.0

        return iris_x, iris_y, both_eyes

    def _apply_homography(self, iris_x, iris_y):
        """Map iris coordinates to screen coordinates using the calibration homography."""
        if self.homography is None:
            return None, None

        point = np.array([[[iris_x, iris_y]]], dtype=np.float64)
        transformed = cv2.perspectiveTransform(point, self.homography)
        screen_x = float(transformed[0][0][0])
        screen_y = float(transformed[0][0][1])

        # Clamp to screen bounds
        screen_x = max(0, min(self.screen_width - 1, screen_x))
        screen_y = max(0, min(self.screen_height - 1, screen_y))

        return screen_x, screen_y

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

        samples = self.calibration_points[idx]["iris_samples"]
        samples.append((iris_x, iris_y))

        n = len(samples)
        min_samples = self.cal_sample_count
        max_samples = self.cal_max_samples

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

    def start_calibration_point(self, index, screen_x, screen_y):
        """Begin collecting samples for a calibration point."""
        self.calibration_points[index] = {
            "screen": (screen_x, screen_y),
            "iris_samples": [],
        }
        self.current_cal_point = index
        self.calibrating = True

    def finish_calibration(self, output_file):
        """Compute homography from collected calibration data and save."""
        src_points = []  # Iris coordinates
        dst_points = []  # Screen coordinates

        for idx in sorted(self.calibration_points.keys()):
            point = self.calibration_points[idx]
            samples = point["iris_samples"]
            if len(samples) < 5:
                self._emit({"error": f"Not enough samples for point {idx} ({len(samples)} < 5)"})
                return False

            xs = np.array([s[0] for s in samples])
            ys = np.array([s[1] for s in samples])

            # Outlier rejection: remove samples > 2 std devs from mean
            if len(samples) > 10:
                mean_x, mean_y = np.mean(xs), np.mean(ys)
                std_x, std_y = np.std(xs), np.std(ys)
                if std_x > 0.01 and std_y > 0.01:
                    mask = (np.abs(xs - mean_x) < 2 * std_x) & (np.abs(ys - mean_y) < 2 * std_y)
                    xs = xs[mask]
                    ys = ys[mask]

            avg_x = float(np.mean(xs))
            avg_y = float(np.mean(ys))
            src_points.append([avg_x, avg_y])
            dst_points.append(list(point["screen"]))

        if len(src_points) < 4:
            self._emit({"error": f"Need at least 4 calibration points, got {len(src_points)}"})
            return False

        src = np.array(src_points, dtype=np.float64)
        dst = np.array(dst_points, dtype=np.float64)

        homography, status = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if homography is None:
            self._emit({"error": "Failed to compute homography matrix"})
            return False

        self.homography = homography

        # Save calibration data
        cal_data = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "screenResolution": {"width": self.screen_width, "height": self.screen_height},
            "cameraIndex": self.camera_index,
            "points": [
                {
                    "index": idx,
                    "screenX": self.calibration_points[idx]["screen"][0],
                    "screenY": self.calibration_points[idx]["screen"][1],
                    "irisX": float(np.mean([s[0] for s in self.calibration_points[idx]["iris_samples"]])),
                    "irisY": float(np.mean([s[1] for s in self.calibration_points[idx]["iris_samples"]])),
                }
                for idx in sorted(self.calibration_points.keys())
            ],
            "homographyMatrix": homography.tolist(),
        }

        try:
            with open(output_file, 'w') as f:
                json.dump(cal_data, f, indent=2)
            # Report iris range so UI can surface calibration quality
            iris_xs = [p["irisX"] for p in cal_data["points"]]
            iris_ys = [p["irisY"] for p in cal_data["points"]]
            iris_range_x = float(max(iris_xs) - min(iris_xs)) if iris_xs else 0.0
            iris_range_y = float(max(iris_ys) - min(iris_ys)) if iris_ys else 0.0
            self._emit({
                "calibration": "complete",
                "file": output_file,
                "iris_range_x": iris_range_x,
                "iris_range_y": iris_range_y,
                "num_points": len(cal_data["points"]),
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
                if self.homography is None:
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
            )
        elif cmd.get("cmd") == "finish_calibration":
            output = cmd.get("output_file", calibration_output_file)
            tracker.finish_calibration(output)


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
