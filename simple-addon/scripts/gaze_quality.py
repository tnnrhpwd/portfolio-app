"""
Simple Addon — Gaze Quality Helpers (pure math)

Accuracy in degrees of visual angle is the metric the eye-tracking industry
reports (a good remote webcam tracker lands ~0.5–1.0°, consumer-grade
~1.0–2.0°). Reporting calibration error in pixels alone is meaningless across
displays, so we convert pixel residuals to degrees using the screen's physical
size and the assumed viewing distance.

This module is pure Python (no OpenCV / MediaPipe) and unit-testable.
"""

import math

# ~24" 1080p monitor pitch (mm/px), used only when physical screen size is
# unknown and we have to fall back to a reasonable default.
DEFAULT_PIXEL_PITCH_MM = 0.2765

# Industry-style accuracy bands for a consumer webcam eye tracker.
GOOD_DEG = 0.8
FAIR_DEG = 1.5


def estimate_pixel_pitch(screen_width_px, screen_height_px,
                         screen_width_mm=None, screen_height_mm=None):
    """Return the pixel pitch (mm/px) of the display.

    Uses the physical screen dimensions when provided (most accurate); otherwise
    falls back to a 24" diagonal assumption so the number is still meaningful.
    """
    if screen_width_mm and screen_height_mm:
        w = screen_width_mm / max(screen_width_px, 1)
        h = screen_height_mm / max(screen_height_px, 1)
        return (w + h) / 2.0
    diag_px = math.hypot(screen_width_px, screen_height_px)
    if diag_px <= 0:
        return DEFAULT_PIXEL_PITCH_MM
    diag_mm = 24.0 * 25.4  # 24-inch reference display
    return diag_mm / diag_px


def px_to_deg(px_error, screen_width_px, screen_height_px,
              viewing_distance_mm=600.0, screen_width_mm=None,
              screen_height_mm=None):
    """Convert a screen-pixel error into degrees of visual angle."""
    if px_error <= 0 or viewing_distance_mm <= 0:
        return 0.0
    pitch = estimate_pixel_pitch(screen_width_px, screen_height_px,
                                 screen_width_mm, screen_height_mm)
    mm = px_error * pitch
    return math.degrees(2.0 * math.atan2(mm, 2.0 * viewing_distance_mm))


def classify_accuracy(mean_deg, good_deg=GOOD_DEG, fair_deg=FAIR_DEG):
    """Classify a mean accuracy (degrees) as 'good' / 'fair' / 'poor'."""
    if mean_deg is None:
        return "unknown"
    if mean_deg <= good_deg:
        return "good"
    if mean_deg <= fair_deg:
        return "fair"
    return "poor"


if __name__ == "__main__":
    deg = px_to_deg(100, 1920, 1080, viewing_distance_mm=600.0,
                    screen_width_mm=530.0, screen_height_mm=300.0)
    print(f"gaze_quality self-test: 100px @ 1920x1080/530x300mm/600mm = {deg:.3f} deg "
          f"({classify_accuracy(deg)})")
