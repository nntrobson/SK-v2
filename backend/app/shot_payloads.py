from __future__ import annotations

from typing import Any, Dict, Optional

from cv_pipeline.analysis import sample_validation_frames


def map_break_label_to_type(break_label: Optional[str]) -> str:
    if break_label == "break":
        return "hit"
    if break_label == "miss":
        return "miss"
    return "unknown"


def serialize_session_shot(shot: Any, measurement: Any, video: Any) -> Dict[str, Any]:
    tracking_data = measurement.tracking_data if measurement and measurement.tracking_data else []
    pretrigger_frame = next(
        (frame for frame in tracking_data if frame.get("is_pretrigger_frame")),
        tracking_data[-1] if tracking_data else {},
    )

    return {
        "id": shot.id,
        "x": measurement.normalized_x if measurement else 0,
        "y": measurement.normalized_y if measurement else 0,
        "type": map_break_label_to_type(getattr(shot, "break_label", None)),
        "break_label": getattr(shot, "break_label", None),
        "presentation": shot.presentation.lower() if getattr(shot, "presentation", None) else "straight",
        "station": getattr(shot, "station", None),
        "confidence": getattr(shot, "confidence", None),
        "trajectory": measurement.trajectory if measurement and measurement.trajectory else [],
        "video_id": video.id,
        "video_path": video.filepath,
        "clay_x": measurement.clay_x if measurement else 0,
        "clay_y": measurement.clay_y if measurement else 0,
        "crosshair_x": measurement.crosshair_x if measurement else 0,
        "crosshair_y": measurement.crosshair_y if measurement else 0,
        "tracking_data": tracking_data,
        "pretrigger_time": pretrigger_frame.get("time"),
        "pretrigger_frame_idx": pretrigger_frame.get("frame_idx"),
        "pretrigger_boxes": pretrigger_frame.get("overlay_boxes", []),
        "overlay_validation_samples": sample_validation_frames(tracking_data, sample_count=10),
    }
