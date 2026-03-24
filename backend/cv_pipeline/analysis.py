from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Tuple

from cv_pipeline.detectors import calculate_clay_offset

TRAP_HOUSE_CLASSES = {"trap-house-1-2", "trap-house", "trap-house-4-5"}
TRACKED_CLASSES = TRAP_HOUSE_CLASSES | {"clay-targets", "broken-clay"}
DEFAULT_CLASS_THRESHOLDS = {
    "clay-targets": 0.35,
    "broken-clay": 0.40,
}
CLASS_RENDER_ORDER = {
    "trap-house-1-2": 0,
    "trap-house": 0,
    "trap-house-4-5": 0,
    "clay-targets": 1,
    "broken-clay": 2,
}


def canonical_class_name(class_name: Optional[str]) -> str:
    return (class_name or "").strip().lower()


def build_bbox(prediction: Dict) -> Dict[str, float]:
    x = float(prediction["x"])
    y = float(prediction["y"])
    width = float(prediction["width"])
    height = float(prediction["height"])
    return {
        "x": round(x - width / 2, 2),
        "y": round(y - height / 2, 2),
        "width": round(width, 2),
        "height": round(height, 2),
    }


def _ensure_bbox(box: Dict) -> Dict[str, float]:
    if "bbox" in box and isinstance(box["bbox"], dict):
        return box["bbox"]
    return build_bbox(box)


def format_overlay_boxes(
    predictions: Iterable[Dict],
    class_thresholds: Optional[Dict[str, float]] = None,
) -> List[Dict]:
    thresholds = {**DEFAULT_CLASS_THRESHOLDS, **(class_thresholds or {})}
    best_trap_house: Optional[Dict] = None
    best_clay: Optional[Dict] = None
    formatted: List[Dict] = []

    for prediction in predictions:
        class_name = canonical_class_name(prediction.get("class"))
        if class_name not in TRACKED_CLASSES:
            continue

        confidence = float(prediction.get("confidence", 0.0))
        if class_name in TRAP_HOUSE_CLASSES:
            current = {
                "class_name": class_name,
                "confidence": round(confidence, 4),
                "x": float(prediction["x"]),
                "y": float(prediction["y"]),
                "width": float(prediction["width"]),
                "height": float(prediction["height"]),
                "bbox": build_bbox(prediction),
            }
            if not best_trap_house or current["confidence"] > best_trap_house["confidence"]:
                best_trap_house = current
            continue

        if confidence < thresholds.get(class_name, 0.0):
            continue

        box = {
            "class_name": class_name,
            "confidence": round(confidence, 4),
            "x": float(prediction["x"]),
            "y": float(prediction["y"]),
            "width": float(prediction["width"]),
            "height": float(prediction["height"]),
            "bbox": build_bbox(prediction),
        }

        if class_name == "clay-targets":
            if not best_clay or box["confidence"] > best_clay["confidence"]:
                best_clay = box
            continue

        formatted.append(box)

    ordered = []
    if best_trap_house:
        ordered.append(best_trap_house)
    if best_clay:
        ordered.append(best_clay)
    ordered.extend(
        sorted(
            formatted,
            key=lambda box: (CLASS_RENDER_ORDER.get(box["class_name"], 99), -box["confidence"]),
        )
    )
    return ordered


def aggregate_station_label(frames: Iterable[Dict]) -> Tuple[Optional[str], float]:
    trap_scores: Dict[str, float] = {}
    trap_counts: Dict[str, int] = {}

    for frame in frames:
        for box in frame.get("overlay_boxes", []):
            class_name = canonical_class_name(box.get("class_name"))
            if class_name not in TRAP_HOUSE_CLASSES:
                continue
            trap_scores[class_name] = trap_scores.get(class_name, 0.0) + float(box.get("confidence", 0.0))
            trap_counts[class_name] = trap_counts.get(class_name, 0) + 1

    if not trap_scores:
        return None, 0.0

    station = max(
        trap_scores,
        key=lambda class_name: (trap_counts.get(class_name, 0), trap_scores[class_name]),
    )
    confidence = 1.0 if trap_counts.get(station, 0) > 1 else round(min(1.0, trap_scores[station]), 4)
    return station, confidence


def _get_primary_box(frame: Dict, class_name: str) -> Optional[Dict]:
    canonical_name = canonical_class_name(class_name)
    candidates = [
        box
        for box in frame.get("overlay_boxes", [])
        if canonical_class_name(box.get("class_name")) == canonical_name
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda box: float(box.get("confidence", 0.0)))


def build_pretrigger_track(
    frames: List[Dict],
    trigger_time: float,
    frame_width: int,
    frame_height: int,
) -> Dict:
    crosshair_x = frame_width / 2
    crosshair_y = frame_height / 2
    track_points: List[Dict] = []
    trajectory: List[Dict] = []
    final_box: Optional[Dict] = None

    for frame in frames:
        if float(frame.get("time", 0.0)) > trigger_time:
            continue

        clay_box = _get_primary_box(frame, "clay-targets")
        if not clay_box:
            continue

        final_box = clay_box
        
        import numpy as np

        clay_cx = float(clay_box["x"])
        clay_cy = float(clay_box["y"])
        xhair_gx, xhair_gy = crosshair_x, crosshair_y

        transform_matrix = frame.get("transform_matrix")
        if transform_matrix:
            tm = np.array(transform_matrix)
            clay_global = tm @ np.array([clay_cx, clay_cy, 1.0])
            clay_cx, clay_cy = clay_global[0], clay_global[1]
            xhair_global = tm @ np.array([crosshair_x, crosshair_y, 1.0])
            xhair_gx, xhair_gy = xhair_global[0], xhair_global[1]

        pixel_to_inches = 4.33 / max(float(clay_box["width"]), 1.0)
        normalized_x = round(float(clay_cx - xhair_gx) * pixel_to_inches, 2)
        normalized_y = round(float(xhair_gy - clay_cy) * pixel_to_inches, 2)
        point = {
            "time": round(float(frame["time"]), 4),
            "frame_idx": int(frame.get("frame_idx", 0)),
            "pixel_dx": round(float(clay_box["x"]) - crosshair_x, 2),
            "pixel_dy": round(crosshair_y - float(clay_box["y"]), 2),
            "inch_x": normalized_x,
            "inch_y": normalized_y,
            "clay_x": round(float(clay_box["x"]), 2),
            "clay_y": round(float(clay_box["y"]), 2),
            "crosshair_x": round(crosshair_x, 2),
            "crosshair_y": round(crosshair_y, 2),
            "width": round(float(clay_box["width"]), 2),
            "height": round(float(clay_box["height"]), 2),
            "confidence": float(clay_box["confidence"]),
            "class_name": "clay-targets",
            "bbox": _ensure_bbox(clay_box),
            "overlay_boxes": frame.get("overlay_boxes", []),
            "source": "smoothed_track",
        }
        track_points.append(point)
        trajectory.append({
            "x": normalized_x,
            "y": normalized_y,
            "gx": round(float(clay_cx), 2),
            "gy": round(float(clay_cy), 2),
        })

    if not final_box or not track_points:
        return {
            "tracking_data": [],
            "trajectory": [],
            "pretrigger_time": None,
            "clay_x": crosshair_x,
            "clay_y": crosshair_y,
            "crosshair_x": crosshair_x,
            "crosshair_y": crosshair_y,
            "normalized_x": 0.0,
            "normalized_y": 0.0,
            "pretrigger_boxes": [],
        }

    # Pre-trigger point = the tracked clay frame closest to 0.45s before the trigger.
    target_pretrigger_time = trigger_time - 0.45
    pretrigger_point = min(
        track_points,
        key=lambda pt: abs(float(pt["time"]) - target_pretrigger_time),
    )

    # Truncate trajectory and tracking_data to only include points up to the
    # pretrigger time.  Later points (between pretrigger and trigger) are still
    # used for break detection but should not influence trajectory classification.
    pretrigger_cutoff = float(pretrigger_point["time"])
    keep = [i for i, p in enumerate(track_points) if float(p["time"]) <= pretrigger_cutoff]
    track_points = [track_points[i] for i in keep]
    trajectory = [trajectory[i] for i in keep]

    return {
        "tracking_data": track_points,
        "trajectory": trajectory,
        "pretrigger_time": pretrigger_point["time"],
        "clay_x": pretrigger_point["clay_x"],
        "clay_y": pretrigger_point["clay_y"],
        "crosshair_x": pretrigger_point["crosshair_x"],
        "crosshair_y": pretrigger_point["crosshair_y"],
        "normalized_x": pretrigger_point["inch_x"],
        "normalized_y": pretrigger_point["inch_y"],
        "pretrigger_boxes": pretrigger_point["overlay_boxes"],
    }


def build_overlay_timeline(
    frames: List[Dict],
    frame_width: int,
    frame_height: int,
    pretrigger_time: Optional[float] = None,
) -> List[Dict]:
    crosshair_x = round(frame_width / 2, 2)
    crosshair_y = round(frame_height / 2, 2)
    timeline: List[Dict] = []

    for frame in frames:
        clay_box = _get_primary_box(frame, "clay-targets")
        broken_box = _get_primary_box(frame, "broken-clay")
        primary_box = broken_box or clay_box

        entry = {
            "time": round(float(frame.get("time", 0.0)), 4),
            "frame_idx": int(frame.get("frame_idx", 0)),
            "crosshair_x": crosshair_x,
            "crosshair_y": crosshair_y,
            "overlay_boxes": frame.get("overlay_boxes", []),
            "is_pretrigger_frame": pretrigger_time is not None
            and abs(float(frame.get("time", 0.0)) - pretrigger_time) < 1e-4,
        }

        if primary_box:
            entry.update(
                {
                    "clay_x": round(float(primary_box["x"]), 2),
                    "clay_y": round(float(primary_box["y"]), 2),
                    "width": round(float(primary_box["width"]), 2),
                    "height": round(float(primary_box["height"]), 2),
                    "confidence": float(primary_box.get("confidence", 0.0)),
                    "class_name": canonical_class_name(primary_box.get("class_name")),
                    "bbox": _ensure_bbox(primary_box),
                }
            )
        else:
            entry.update(
                {
                    "clay_x": crosshair_x,
                    "clay_y": crosshair_y,
                    "width": 0.0,
                    "height": 0.0,
                    "confidence": 0.0,
                    "class_name": None,
                    "bbox": None,
                }
            )

        timeline.append(entry)

    return timeline


def classify_break_state(
    frames: List[Dict],
    trigger_time: float,
    break_threshold: float = 0.70,
    miss_threshold: float = 0.70,
    pretrigger_time: Optional[float] = None,
) -> Tuple[str, float]:
    cutoff = pretrigger_time if pretrigger_time is not None else trigger_time
    max_broken_confidence = 0.0
    max_clay_confidence = 0.0
    any_broken_detected = False

    for frame in frames:
        if float(frame.get("time", 0.0)) < cutoff:
            continue

        # Scan raw_predictions (unfiltered) so low-confidence broken-clay
        # detections that were stripped by the overlay threshold still count.
        for pred in frame.get("raw_predictions", []):
            if canonical_class_name(pred.get("class")) == "broken-clay":
                conf = float(pred.get("confidence", 0.0))
                if conf > 0:
                    any_broken_detected = True
                    max_broken_confidence = max(max_broken_confidence, conf)

        clay_box = _get_primary_box(frame, "clay-targets")
        if clay_box:
            max_clay_confidence = max(max_clay_confidence, float(clay_box.get("confidence", 0.0)))

    if any_broken_detected:
        return "break", round(max_broken_confidence, 4)
    if max_clay_confidence >= miss_threshold:
        return "miss", round(max_clay_confidence, 4)
    return "unknown", round(max(max_broken_confidence, max_clay_confidence), 4)


def sample_validation_frames(frames: List[Dict], sample_count: int = 10) -> List[Dict]:
    visible_frames = [frame for frame in frames if frame.get("overlay_boxes")]
    if not visible_frames:
        return []

    if len(visible_frames) <= sample_count:
        return visible_frames

    last_index = len(visible_frames) - 1
    indexes = set()
    for sample_idx in range(sample_count):
        ratio = sample_idx / (sample_count - 1)
        indexes.add(round(ratio * last_index))

    ordered_indexes = sorted(indexes)
    return [visible_frames[index] for index in ordered_indexes[:sample_count]]
