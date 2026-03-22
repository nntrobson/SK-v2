from __future__ import annotations

import logging
import os
import tempfile
from typing import Any, Dict, Optional

import cv2

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
DEFAULT_FRAME_STRIDE = max(1, int(os.getenv("ROBOFLOW_FRAME_STRIDE", "1")))
CLAY_THRESHOLD = float(os.getenv("CLAY_CONFIDENCE_THRESHOLD", "0.45"))
BROKEN_THRESHOLD = float(os.getenv("BROKEN_CLAY_CONFIDENCE_THRESHOLD", "0.60"))
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


def classify_presentation(trajectory: list[dict]) -> str:
    if len(trajectory) < 2:
        return "straight"

    delta_x = float(trajectory[-1]["x"]) - float(trajectory[0]["x"])
    if delta_x <= -4.0:
        return "hard_left"
    if delta_x <= -1.5:
        return "moderate_left"
    if delta_x >= 4.0:
        return "hard_right"
    if delta_x >= 1.5:
        return "moderate_right"
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

    if break_label == "break":
        for frame in post_trigger_frames:
            for box in frame.get("overlay_boxes", []):
                if canonical_class_name(box.get("class_name")) == "broken-clay" and float(box.get("confidence", 0.0)) >= break_threshold:
                    return frame
    elif break_label == "miss":
        for frame in post_trigger_frames:
            for box in frame.get("overlay_boxes", []):
                if canonical_class_name(box.get("class_name")) == "clay-targets" and float(box.get("confidence", 0.0)) >= miss_threshold:
                    return frame

    return max(
        post_trigger_frames,
        key=lambda frame: max((float(box.get("confidence", 0.0)) for box in frame.get("overlay_boxes", [])), default=0.0),
    )


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
    if not shot_times:
        raise ValueError(f"No gunshot detected in {video_path}")

    trigger_time = float(shot_times[0])

    from inference_sdk import InferenceHTTPClient

    client = InferenceHTTPClient(
        api_url="https://detect.roboflow.com",
        api_key=api_key or os.getenv("ROBOFLOW_API_KEY", ""),
    )
    model_id = f"{project_name or os.getenv('ROBOFLOW_PROJECT', 'claytargets-id')}/{version or os.getenv('ROBOFLOW_VERSION', '19')}"

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
    )
    presentation = classify_presentation(pretrigger_summary["trajectory"])

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
