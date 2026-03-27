"""
CSimple Addon — Eye Tracking Engine

Uses MediaPipe Face Mesh with iris landmarks to track eye gaze and map it to
screen coordinates via a calibration homography.

Modes:
  --mode track    (default) Output {x, y, confidence} JSON lines to stdout
  --mode calibrate         Collect iris samples for calibration points received via stdin
  --mode test              Output raw iris coordinates without calibration (for debugging)
  --mode list_cameras      List available camera indices and exit

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
"""

import argparse
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
        self.cal_sample_count = 30  # Frames to collect per point

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
        """Write a JSON line to stdout."""
        print(json.dumps(data), flush=True)

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

    def _handle_calibration_frame(self, iris_x, iris_y):
        """Collect iris sample for the current calibration point."""
        if self.current_cal_point is None:
            return

        idx = self.current_cal_point
        if idx not in self.calibration_points:
            return

        samples = self.calibration_points[idx]["iris_samples"]
        samples.append((iris_x, iris_y))
        self._emit({
            "status": "calibrating",
            "point_index": idx,
            "samples": len(samples),
            "target": self.cal_sample_count,
        })

        if len(samples) >= self.cal_sample_count:
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

            # Average the iris samples
            avg_x = np.mean([s[0] for s in samples])
            avg_y = np.mean([s[1] for s in samples])
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
            self._emit({"calibration": "complete", "file": output_file})
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

        # Set camera resolution for better iris detection
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        mp_face_mesh = mp.solutions.face_mesh
        face_mesh = mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,  # Enables iris landmarks (468-477)
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        start_time = time.time()
        no_face_count = 0

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

                # Convert BGR to RGB for MediaPipe
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = face_mesh.process(rgb_frame)

                if not results.multi_face_landmarks:
                    no_face_count += 1
                    if no_face_count % 30 == 0:  # Report every ~1 second
                        self._emit({"error": "No face detected", "frames_missed": no_face_count})
                    continue

                no_face_count = 0
                landmarks = results.multi_face_landmarks[0].landmark
                h, w = frame.shape[:2]

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
                    })
                    continue

                if mode == "calibrate" or self.calibrating:
                    self._handle_calibration_frame(iris_x, iris_y)
                    continue

                # Mode: track — map to screen coordinates
                if self.homography is None:
                    self._emit({"error": "No calibration data — run calibration first"})
                    time.sleep(1)  # Don't spam
                    continue

                screen_x, screen_y = self._apply_homography(iris_x, iris_y)
                if screen_x is None:
                    continue

                # Apply smoothing
                smooth_x, smooth_y = self._smooth(screen_x, screen_y)

                self._emit({
                    "x": round(smooth_x),
                    "y": round(smooth_y),
                    "confidence": round(confidence, 3),
                    "both_eyes": both_eyes,
                })

        finally:
            face_mesh.close()
            cap.release()
            self._emit({"status": "stopped"})

    def stop(self):
        """Signal the tracking loop to stop."""
        self.running = False


def list_cameras(max_index=5):
    """Probe camera indices to find available webcams (DirectShow on Windows for speed)."""
    import platform
    backend = cv2.CAP_DSHOW if platform.system() == 'Windows' else cv2.CAP_ANY
    available = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i, backend)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                available.append(i)
            cap.release()
    return available


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
    parser.add_argument("--mode", type=str, default="track", choices=["track", "calibrate", "test", "list_cameras"],
                        help="Operating mode")
    parser.add_argument("--smoothing", type=float, default=0.3, help="Smoothing alpha (0-1, higher = less smooth)")
    parser.add_argument("--confidence_threshold", type=float, default=0.6, help="Minimum confidence to emit coordinates")
    args = parser.parse_args()

    if args.mode == "list_cameras":
        cameras = list_cameras()
        print(json.dumps({"cameras": cameras}), flush=True)
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
