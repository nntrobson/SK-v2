from __future__ import annotations

import logging
import math
import os
import tempfile
from typing import Any, Dict, Optional

import cv2
import numpy as np

from cv_pipeline.analysis import (
    aggregate_station_label,
    build_overlay_timeline,
    build_pretrigger_track,
    canonical_class_name,
    classify_break_state,
    format_overlay_boxes,
)
from cv_pipeline.processor import detect_gunshot_onset, extract_audio_track

logger = logging.getLogger(__name__)

DEFAULT_FPS = float(os.getenv("SHOTKAM_DEFAULT_FPS", "60"))
DEFAULT_FRAME_STRIDE = max(1, int(os.getenv("ROBOFLOW_FRAME_STRIDE", "5")))
CLAY_THRESHOLD = float(os.getenv("CLAY_CONFIDENCE_THRESHOLD", "0.35"))
BROKEN_THRESHOLD = float(os.getenv("BROKEN_CLAY_CONFIDENCE_THRESHOLD", "0.40"))
BREAK_DECISION_THRESHOLD = float(os.getenv("BREAK_DECISION_THRESHOLD", "0.70"))
MISS_DECISION_THRESHOLD = float(os.getenv("MISS_DECISION_THRESHOLD", "0.75"))


def infer_predictions(client: Any, model_id: str, frame) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        cv2.imwrite(tmp.name, frame)
        tmp_path = tmp.name

    try:
        result = client.infer(tmp_path, model_id=model_id)
    except Exception as exc:
        logger.warning("Roboflow inference failed: %s", exc)
        result = {}
    finally:
        os.unlink(tmp_path)

    return result.get("predictions", []) if isinstance(result, dict) else []


DIRECTION_THRESH_MODERATE = float(os.getenv("DIRECTION_THRESH_MODERATE", "8"))
DIRECTION_THRESH_HARD = float(os.getenv("DIRECTION_THRESH_HARD", "30"))
MAHALANOBIS_THRESHOLD = float(os.getenv("MAHALANOBIS_THRESHOLD", "3.0"))


def _compute_outlier_mask(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Build a boolean mask marking outlier trajectory points.

    Three-stage filter matching the validated HTML classifier:
      1. Endpoint trimming (first and last points — noisy detection edges)
      2. Backward motion — step moves against the dominant trajectory direction
      3. Mahalanobis distance on (dx, dy) step vectors — catches sudden jumps
    """
    n = len(xs)
    mask = np.zeros(n, dtype=bool)
    if n <= 4:
        return mask

    mask[0] = True
    mask[n - 1] = True

    # Backward motion: dot(step, dominant_direction) < 0
    dir_x = xs[-1] - xs[0]
    dir_y = ys[-1] - ys[0]
    dir_len = math.sqrt(dir_x * dir_x + dir_y * dir_y)
    if dir_len > 0.01:
        udx, udy = dir_x / dir_len, dir_y / dir_len
        for i in range(2, n - 1):
            step_x = xs[i] - xs[i - 1]
            step_y = ys[i] - ys[i - 1]
            if step_x * udx + step_y * udy < 0:
                mask[i] = True

    # Mahalanobis distance on step vectors between clean (non-masked) points
    steps = []
    for i in range(1, n):
        if mask[i] or mask[i - 1]:
            continue
        steps.append((xs[i] - xs[i - 1], ys[i] - ys[i - 1], i))

    if len(steps) >= 4:
        dxs = np.array([s[0] for s in steps])
        dys = np.array([s[1] for s in steps])
        mean_dx, mean_dy = dxs.mean(), dys.mean()

        cx = dxs - mean_dx
        cy = dys - mean_dy
        sxx = np.mean(cx * cx)
        sxy = np.mean(cx * cy)
        syy = np.mean(cy * cy)

        det = sxx * syy - sxy * sxy
        if det > 1e-10:
            inv_sxx = syy / det
            inv_sxy = -sxy / det
            inv_syy = sxx / det
            for j, (dx, dy, orig_idx) in enumerate(steps):
                cdx = dx - mean_dx
                cdy = dy - mean_dy
                mah = math.sqrt(
                    cdx * cdx * inv_sxx + 2 * cdx * cdy * inv_sxy + cdy * cdy * inv_syy
                )
                if mah > MAHALANOBIS_THRESHOLD:
                    mask[orig_idx] = True

    return mask


def classify_presentation(trajectory: list[dict], station: str) -> str:
    """Classify shot direction using parabolic trajectory fit.

    Uses stabilized global-space coordinates (gx/gy) when available so
    the fit sees the clay's physical flight path rather than its position
    relative to the moving crosshair.  Falls back to normalized x/y if
    global coords are absent.

    Pipeline:
      1. Origin-normalize (first point -> 0,0)
      2. Apply station perspective correction (+/-3.5 px for global coords)
      3. Outlier mask: endpoint trim + backward motion + Mahalanobis
      4. Parabolic least-squares fit on clean points
      5. Angle = atan(dx/dy at y_mid) in degrees
    """
    if len(trajectory) < 2:
        return "straight"

    use_global = all("gx" in p and "gy" in p for p in trajectory)
    if use_global:
        raw_xs = [float(p["gx"]) for p in trajectory]
        raw_ys = [float(p["gy"]) for p in trajectory]
    else:
        raw_xs = [float(p["x"]) for p in trajectory]
        raw_ys = [float(p["y"]) for p in trajectory]

    x0, y0 = raw_xs[0], raw_ys[0]
    xs_list = [x - x0 for x in raw_xs]
    ys_list = [y - y0 for y in raw_ys]

    if not use_global:
        if station == "trap-house-1-2":
            xs_list = [x - 3.5 for x in xs_list]
        elif station == "trap-house-4-5":
            xs_list = [x + 3.5 for x in xs_list]

    xs_all = np.array(xs_list)
    ys_all = np.array(ys_list)

    mask = _compute_outlier_mask(xs_all, ys_all)
    xs_clean = xs_all[~mask]
    ys_clean = ys_all[~mask]

    if len(xs_clean) < 3:
        # Not enough clean points — fall back to all points
        a, b, c, r2 = _quadratic_fit(ys_all, xs_all)
        if len(ys_all) < 3:
            delta_x = float(xs_all[-1] - xs_all[0])
            dy = float(ys_all[-1] - ys_all[0])
            angle_deg = math.atan2(delta_x, dy) * (180.0 / math.pi) if dy != 0 else 0.0
            return _classify_angle(angle_deg)
        y_mid = (ys_all[0] + ys_all[-1]) / 2.0
        slope_at_mid = 2 * a * y_mid + b
        angle_deg = math.atan(slope_at_mid) * (180.0 / math.pi)
        return _classify_angle(angle_deg)

    a, b, c, r2 = _quadratic_fit(ys_clean, xs_clean)

    y_mid = (ys_clean[0] + ys_clean[-1]) / 2.0
    slope_at_mid = 2 * a * y_mid + b
    angle_deg = math.atan(slope_at_mid) * (180.0 / math.pi)

    return _classify_angle(angle_deg)


def _quadratic_fit(
    y_vals: np.ndarray, x_vals: np.ndarray
) -> tuple[float, float, float, float]:
    """Fit x = a*y^2 + b*y + c. Returns (a, b, c, r^2)."""
    if len(y_vals) < 3:
        return 0.0, 0.0, 0.0, 0.0
    A = np.column_stack([y_vals**2, y_vals, np.ones_like(y_vals)])
    coeffs, _, _, _ = np.linalg.lstsq(A, x_vals, rcond=None)
    a, b, c = coeffs

    ss_res = np.sum((x_vals - A @ coeffs) ** 2)
    ss_tot = np.sum((x_vals - np.mean(x_vals)) ** 2)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    return float(a), float(b), float(c), float(r2)


def _classify_angle(angle_deg: float) -> str:
    """Classify direction from angle (degrees from vertical). Negative = left."""
    abs_angle = abs(angle_deg)
    if abs_angle >= DIRECTION_THRESH_HARD:
        return "hard_left" if angle_deg < 0 else "hard_right"
    if abs_angle >= DIRECTION_THRESH_MODERATE:
        return "moderate_left" if angle_deg < 0 else "moderate_right"
    return "straight"


def _nearest_frame(frames: list[dict], target_time: Optional[float]) -> Optional[dict]:
    if not frames or target_time is None:
        return None
    return min(frames, key=lambda frame: abs(float(frame.get("time", 0.0)) - float(target_time)))


def _first_frame_with_class(frames: list[dict], class_names: set[str]) -> Optional[dict]:
    for frame in frames:
        for box in frame.get("overlay_boxes", []):
            if canonical_class_name(box.get("class_name")) in class_names:
                return frame
    return None


def determine_decision_frame(
    frames: list[dict],
    trigger_time: float,
    break_label: str,
    break_threshold: float = BREAK_DECISION_THRESHOLD,
    miss_threshold: float = MISS_DECISION_THRESHOLD,
) -> Optional[dict]:
    post_trigger_frames = [frame for frame in frames if float(frame.get("time", 0.0)) >= trigger_time]
    if not post_trigger_frames:
        return _nearest_frame(frames, trigger_time)

    decision_frame = None
    if break_label == "break":
        for frame in post_trigger_frames:
            for box in frame.get("overlay_boxes", []):
                if canonical_class_name(box.get("class_name")) == "broken-clay" and float(box.get("confidence", 0.0)) >= break_threshold:
                    decision_frame = frame
                    break
            if decision_frame:
                break
    elif break_label == "miss":
        for frame in post_trigger_frames:
            for box in frame.get("overlay_boxes", []):
                if canonical_class_name(box.get("class_name")) == "clay-targets" and float(box.get("confidence", 0.0)) >= miss_threshold:
                    decision_frame = frame
                    break
            if decision_frame:
                break

    if not decision_frame:
        decision_frame = max(
            post_trigger_frames,
            key=lambda frame: max((float(box.get("confidence", 0.0)) for box in frame.get("overlay_boxes", [])), default=0.0),
        )

    # Move the decision frame backward by 1 frame if possible
    decision_idx = next((i for i, f in enumerate(frames) if f == decision_frame), -1)
    if decision_idx != -1:
        decision_idx = max(0, decision_idx - 1)
        return frames[decision_idx]
    
    return decision_frame


def analyze_video_file(
    video_path: str,
    api_key: Optional[str] = None,
    project_name: Optional[str] = None,
    version: Optional[str] = None,
    frame_stride: Optional[int] = None,
    cache_frames_dir: Optional[str] = None,
) -> Dict[str, Any]:
    audio_data, sample_rate = extract_audio_track(video_path)
    shot_times = detect_gunshot_onset(audio_data, sample_rate=sample_rate or 44100) if audio_data is not None else []
    
    # FOR TESTING: If no gunshot detected, fall back to mid-video
    if not shot_times:
        logger.warning(f"No gunshot detected in {video_path}, using middle of video for testing.")
        cap_temp = cv2.VideoCapture(video_path)
        fps_temp = cap_temp.get(cv2.CAP_PROP_FPS)
        total_frames_temp = cap_temp.get(cv2.CAP_PROP_FRAME_COUNT)
        cap_temp.release()
        
        if fps_temp > 0 and total_frames_temp > 0:
             # Assume shot is at 75% through the video
             trigger_time = (total_frames_temp * 0.75) / fps_temp
        else:
            raise ValueError(f"No gunshot detected in {video_path} and could not determine fallback time.")
    else:
        trigger_time = float(shot_times[0])

    from inference_sdk import InferenceHTTPClient

    client = InferenceHTTPClient(
        api_url="https://detect.roboflow.com",
        api_key=api_key or os.getenv("ROBOFLOW_API_KEY", "6njbZLMNIDGfPz9ZxxPT"),
    )
    model_id = f"{project_name or os.getenv('ROBOFLOW_PROJECT', 'claytargets-id')}/{version or os.getenv('ROBOFLOW_VERSION', '29')}"

    stride = max(1, frame_stride or DEFAULT_FRAME_STRIDE)

    if cache_frames_dir:
        os.makedirs(cache_frames_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps < 1.0:
        fps = DEFAULT_FPS
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    from cv_pipeline.stabilizer import GlobalMotionStabilizer
    stabilizer = GlobalMotionStabilizer()

    frame_analysis: list[dict] = []
    all_raw_frames: dict[int, str] = {}
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if cache_frames_dir:
            cache_path = os.path.join(cache_frames_dir, f"frame_{frame_idx:06d}.jpg")
            cv2.imwrite(cache_path, frame)
            all_raw_frames[frame_idx] = cache_path

        # Always run stabilization on every frame to maintain tracking consistency
        transform_matrix = stabilizer.process_frame(frame)

        if frame_idx % stride != 0:
            frame_idx += 1
            continue

        predictions = infer_predictions(client, model_id, frame)
        overlay_boxes = format_overlay_boxes(
            predictions,
            class_thresholds={
                "clay-targets": CLAY_THRESHOLD,
                "broken-clay": BROKEN_THRESHOLD,
            },
        )
        frame_analysis.append(
            {
                "time": round(frame_idx / fps, 4),
                "frame_idx": frame_idx,
                "overlay_boxes": overlay_boxes,
                "raw_predictions": predictions,
                "transform_matrix": transform_matrix.tolist(),  # Save as list for JSON serialization
            }
        )
        frame_idx += 1
    cap.release()

    station, station_confidence = aggregate_station_label(frame_analysis)
    pretrigger_summary = build_pretrigger_track(
        frames=frame_analysis,
        trigger_time=trigger_time,
        frame_width=frame_width,
        frame_height=frame_height,
    )
    overlay_timeline = build_overlay_timeline(
        frames=frame_analysis,
        frame_width=frame_width,
        frame_height=frame_height,
        pretrigger_time=pretrigger_summary["pretrigger_time"],
    )
    break_label, break_confidence = classify_break_state(
        frames=frame_analysis,
        trigger_time=trigger_time,
        break_threshold=BREAK_DECISION_THRESHOLD,
        miss_threshold=MISS_DECISION_THRESHOLD,
        pretrigger_time=pretrigger_summary.get("pretrigger_time"),
    )
    presentation = classify_presentation(pretrigger_summary["trajectory"], station or "unknown")

    first_trap_frame = _first_frame_with_class(
        overlay_timeline,
        {"trap-house", "trap-house-1-2", "trap-house-4-5"},
    )
    decision_frame = determine_decision_frame(frame_analysis, trigger_time, break_label)
    pretrigger_frame = _nearest_frame(overlay_timeline, pretrigger_summary.get("pretrigger_time"))

    return {
        "video_path": video_path,
        "fps": fps,
        "total_frames": total_frames,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "audio_data": audio_data,
        "audio_sample_rate": sample_rate,
        "trigger_time": trigger_time,
        "shot_times": shot_times,
        "station": station or "unknown",
        "station_confidence": station_confidence,
        "break_label": break_label,
        "break_confidence": break_confidence,
        "presentation": presentation,
        "pretrigger_summary": pretrigger_summary,
        "tracking_data": overlay_timeline,
        "frame_analysis": frame_analysis,
        "first_trap_house_frame": first_trap_frame,
        "decision_frame": _nearest_frame(overlay_timeline, decision_frame.get("time")) if decision_frame else None,
        "pretrigger_frame": pretrigger_frame,
        "cached_frames": all_raw_frames,
        "_roboflow_api_key": api_key or os.getenv("ROBOFLOW_API_KEY", ""),
        "_roboflow_model_id": model_id,
    }
