from __future__ import annotations

import csv
import json
import os
import shutil
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d

PACKAGE_SPEC_VERSION = "validation-package/v1"
DEFAULT_SCREENSHOT_COUNT = 18

CLASS_COLORS = {
    "clay-targets": (46, 204, 113),
    "broken-clay": (52, 152, 219),
    "trap-house": (241, 196, 15),
    "trap-house-1-2": (155, 89, 182),
    "trap-house-4-5": (230, 126, 34),
}

MARKER_STYLES = {
    "trigger": {"color": (52, 152, 219), "label": "Trigger"},
    "pretrigger": {"color": (46, 204, 113), "label": "Pre-trigger"},
    "decision_frame": {"color": (231, 76, 60), "label": "Break/Miss Check"},
}


def choose_balanced_video_rows(rows: list[dict], sample_size: int = 10) -> list[dict]:
    grouped: dict[str, deque[dict]] = defaultdict(deque)
    for row in rows:
        filename = (row.get("Filename") or "").strip()
        if not filename:
            continue
        position = (row.get("Position") or "Unknown").strip()
        grouped[position].append(row)

    ordered_positions = sorted(grouped.keys())
    selected: list[dict] = []
    while len(selected) < sample_size and any(grouped.values()):
        for position in ordered_positions:
            if not grouped[position]:
                continue
            selected.append(grouped[position].popleft())
            if len(selected) >= sample_size:
                break
    return selected


def _nearest_frame(frames: list[dict], target_time: Optional[float]) -> Optional[dict]:
    if not frames or target_time is None:
        return None
    return min(frames, key=lambda frame: abs(float(frame.get("time", 0.0)) - float(target_time)))


def select_validation_frames(
    frames: list[dict],
    desired_count: int = DEFAULT_SCREENSHOT_COUNT,
    trigger_time: Optional[float] = None,
    pretrigger_time: Optional[float] = None,
    decision_time: Optional[float] = None,
    first_trap_house_time: Optional[float] = None,
) -> list[dict]:
    if not frames:
        return []

    selected: list[dict] = []
    selected_frame_indices: set[int] = set()

    def add_entry(label: str, frame: Optional[dict]) -> None:
        if not frame:
            return
        frame_idx = int(frame["frame_idx"])
        if frame_idx in selected_frame_indices and label.startswith("spread_"):
            return
        selected.append(
            {
                "label": label,
                "frame_idx": frame_idx,
                "time": float(frame["time"]),
                "frame": frame,
            }
        )
        selected_frame_indices.add(frame_idx)

    add_entry("start", frames[0])
    add_entry("first_trap_house", _nearest_frame(frames, first_trap_house_time))
    add_entry("pretrigger", _nearest_frame(frames, pretrigger_time))
    add_entry("trigger", _nearest_frame(frames, trigger_time))
    add_entry("decision_frame", _nearest_frame(frames, decision_time))
    add_entry("end", frames[-1])

    remaining = max(desired_count - len(selected), 0)
    if remaining > 0 and len(frames) > 1:
        spread_indices = np.linspace(0, len(frames) - 1, num=remaining + 2, dtype=int).tolist()[1:-1]
        spread_counter = 1
        for spread_index in spread_indices:
            frame = frames[spread_index]
            if int(frame["frame_idx"]) in selected_frame_indices:
                continue
            add_entry(f"spread_{spread_counter:02d}", frame)
            spread_counter += 1

    selected.sort(key=lambda item: item["frame_idx"])
    return selected


def _safe_label(label: str) -> str:
    return label.lower().replace(" ", "_").replace("/", "_")


def draw_overlay_boxes(frame: np.ndarray, overlay_boxes: list[dict], timestamp_ms: Optional[int] = None) -> np.ndarray:
    annotated = frame.copy()

    for overlay_box in overlay_boxes:
        bbox = overlay_box.get("bbox")
        if not isinstance(bbox, dict):
            width = float(overlay_box.get("width", 0.0))
            height = float(overlay_box.get("height", 0.0))
            center_x = float(overlay_box.get("x", 0.0))
            center_y = float(overlay_box.get("y", 0.0))
            bbox = {
                "x": center_x - width / 2,
                "y": center_y - height / 2,
                "width": width,
                "height": height,
            }

        class_name = overlay_box.get("class_name", "unknown")
        color = CLASS_COLORS.get(class_name, (255, 255, 255))
        x1 = int(round(float(bbox["x"])))
        y1 = int(round(float(bbox["y"])))
        x2 = int(round(float(bbox["x"]) + float(bbox["width"])))
        y2 = int(round(float(bbox["y"]) + float(bbox["height"])))
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        label = f"{class_name} {float(overlay_box.get('confidence', 0.0)):.2f}"
        cv2.putText(annotated, label, (x1, max(18, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)

    if timestamp_ms is not None:
        label = f"{timestamp_ms} ms"
        text_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)
        top_right_x = annotated.shape[1] - text_size[0] - 20
        cv2.putText(
            annotated,
            label,
            (top_right_x, 32),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

    return annotated


def build_audio_envelope(audio_data: Optional[np.ndarray], width: int) -> np.ndarray:
    if audio_data is None or len(audio_data) == 0:
        return np.zeros(width, dtype=np.float32)

    envelope = gaussian_filter1d(np.abs(audio_data), sigma=150)
    source_indexes = np.linspace(0, len(envelope) - 1, num=width)
    reduced = np.interp(source_indexes, np.arange(len(envelope)), envelope)
    max_value = float(np.max(reduced)) or 1.0
    return (reduced / max_value).astype(np.float32)


def render_waveform_panel(
    width: int,
    height: int,
    envelope: np.ndarray,
    duration_seconds: float,
    current_time: float,
    markers: dict[str, Optional[float]],
) -> np.ndarray:
    panel = np.zeros((height, width, 3), dtype=np.uint8)
    panel[:] = (18, 24, 33)

    chart_top = 25
    chart_bottom = height - 30
    chart_height = max(chart_bottom - chart_top, 1)

    points = []
    for x, amplitude in enumerate(envelope):
        y = chart_bottom - int(float(amplitude) * chart_height)
        points.append([x, y])

    if len(points) > 1:
        cv2.polylines(panel, [np.array(points, dtype=np.int32)], False, (46, 204, 113), 2)
    cv2.line(panel, (0, chart_bottom), (width, chart_bottom), (71, 85, 105), 1)

    def time_to_x(time_s: Optional[float]) -> Optional[int]:
        if time_s is None or duration_seconds <= 0:
            return None
        ratio = max(0.0, min(1.0, float(time_s) / duration_seconds))
        return int(ratio * (width - 1))

    for marker_name, marker_time in markers.items():
        marker_x = time_to_x(marker_time)
        if marker_x is None:
            continue
        style = MARKER_STYLES[marker_name]
        cv2.line(panel, (marker_x, chart_top), (marker_x, chart_bottom), style["color"], 2)
        cv2.putText(panel, style["label"], (max(5, marker_x - 36), 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, style["color"], 1, cv2.LINE_AA)

    playhead_x = time_to_x(current_time)
    if playhead_x is not None:
        cv2.line(panel, (playhead_x, chart_top), (playhead_x, chart_bottom), (255, 255, 255), 2)

    return panel


def flatten_tracking_rows(analysis: dict) -> list[dict]:
    rows: list[dict] = []
    for frame in analysis["tracking_data"]:
        overlay_boxes = frame.get("overlay_boxes", [])
        if not overlay_boxes:
            rows.append(
                {
                    "frame_idx": frame["frame_idx"],
                    "time_ms": int(round(float(frame["time"]) * 1000)),
                    "is_pretrigger_frame": frame.get("is_pretrigger_frame", False),
                    "class_name": "",
                    "confidence": "",
                    "bbox_x": "",
                    "bbox_y": "",
                    "bbox_width": "",
                    "bbox_height": "",
                    "crosshair_x": frame.get("crosshair_x", ""),
                    "crosshair_y": frame.get("crosshair_y", ""),
                    "primary_class_name": frame.get("class_name", ""),
                    "station_prediction": analysis["station"],
                    "break_prediction": analysis["break_label"],
                    "presentation": analysis["presentation"],
                }
            )
            continue

        for overlay_box in overlay_boxes:
            bbox = overlay_box.get("bbox", {})
            rows.append(
                {
                    "frame_idx": frame["frame_idx"],
                    "time_ms": int(round(float(frame["time"]) * 1000)),
                    "is_pretrigger_frame": frame.get("is_pretrigger_frame", False),
                    "class_name": overlay_box.get("class_name", ""),
                    "confidence": overlay_box.get("confidence", ""),
                    "bbox_x": bbox.get("x", ""),
                    "bbox_y": bbox.get("y", ""),
                    "bbox_width": bbox.get("width", ""),
                    "bbox_height": bbox.get("height", ""),
                    "crosshair_x": frame.get("crosshair_x", ""),
                    "crosshair_y": frame.get("crosshair_y", ""),
                    "primary_class_name": frame.get("class_name", ""),
                    "station_prediction": analysis["station"],
                    "break_prediction": analysis["break_label"],
                    "presentation": analysis["presentation"],
                }
            )
    return rows


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _interpolate_box(box_a: dict, box_b: dict, t: float) -> dict:
    interpolated = dict(box_a)
    for key in ("x", "y", "width", "height", "confidence"):
        if key in box_a and key in box_b:
            interpolated[key] = round(_lerp(float(box_a[key]), float(box_b[key]), t), 2)

    bbox_a = box_a.get("bbox")
    bbox_b = box_b.get("bbox")
    if isinstance(bbox_a, dict) and isinstance(bbox_b, dict):
        interpolated["bbox"] = {
            k: round(_lerp(float(bbox_a.get(k, 0)), float(bbox_b.get(k, 0)), t), 2)
            for k in ("x", "y", "width", "height")
        }
    return interpolated


def _interpolate_overlay_boxes(
    tracking_data: list[dict],
    tracking_idx: int,
    frame_idx: int,
) -> list[dict]:
    if not tracking_data:
        return []

    prev = tracking_data[min(tracking_idx, len(tracking_data) - 1)]
    prev_frame_idx = int(prev.get("frame_idx", 0))

    if tracking_idx + 1 >= len(tracking_data) or frame_idx <= prev_frame_idx:
        return prev.get("overlay_boxes", [])

    nxt = tracking_data[tracking_idx + 1]
    nxt_frame_idx = int(nxt.get("frame_idx", prev_frame_idx + 1))
    span = max(nxt_frame_idx - prev_frame_idx, 1)
    t = min(1.0, max(0.0, (frame_idx - prev_frame_idx) / span))

    prev_boxes = prev.get("overlay_boxes", [])
    nxt_boxes = nxt.get("overlay_boxes", [])

    if not prev_boxes:
        return prev_boxes
    if not nxt_boxes:
        return prev_boxes

    prev_by_class: dict[str, dict] = {}
    for box in prev_boxes:
        cn = (box.get("class_name") or "").lower()
        if cn not in prev_by_class:
            prev_by_class[cn] = box

    nxt_by_class: dict[str, dict] = {}
    for box in nxt_boxes:
        cn = (box.get("class_name") or "").lower()
        if cn not in nxt_by_class:
            nxt_by_class[cn] = box

    result: list[dict] = []
    for cn, box_a in prev_by_class.items():
        box_b = nxt_by_class.get(cn)
        if box_b:
            result.append(_interpolate_box(box_a, box_b, t))
        else:
            result.append(box_a)

    return result


def _find_analysis_frame_by_idx(analysis: dict, frame_idx: int) -> Optional[dict]:
    for frame in analysis["tracking_data"]:
        if int(frame.get("frame_idx", -1)) == int(frame_idx):
            return frame
    return None


def _save_csv(path: Path, rows: list[dict]) -> None:
    fieldnames = list(rows[0].keys()) if rows else [
        "frame_idx",
        "time_ms",
        "is_pretrigger_frame",
        "class_name",
        "confidence",
        "bbox_x",
        "bbox_y",
        "bbox_width",
        "bbox_height",
        "crosshair_x",
        "crosshair_y",
        "primary_class_name",
        "station_prediction",
        "break_prediction",
        "presentation",
    ]
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _copy_original_video(video_path: str, package_dir: Path) -> Path:
    destination = package_dir / "original_video" / Path(video_path).name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(video_path, destination)
    return destination


def _build_manifest(analysis: dict, package_dir: Path, screenshot_files: list[str], csv_path: Path, review_video_path: Path, original_video_path: Path) -> dict:
    return {
        "spec_version": PACKAGE_SPEC_VERSION,
        "video_filename": Path(analysis["video_path"]).name,
        "package_dir": str(package_dir),
        "original_video": str(original_video_path),
        "review_video": str(review_video_path),
        "csv_path": str(csv_path),
        "screenshots": screenshot_files,
        "station_prediction": analysis["station"],
        "break_prediction": analysis["break_label"],
        "presentation_prediction": analysis["presentation"],
        "trigger_time_ms": int(round(float(analysis["trigger_time"]) * 1000)),
        "pretrigger_time_ms": int(round(float(analysis["pretrigger_summary"].get("pretrigger_time") or 0.0) * 1000)),
        "decision_time_ms": int(round(float((analysis.get("decision_frame") or {}).get("time", 0.0)) * 1000)),
        "first_trap_house_time_ms": int(round(float((analysis.get("first_trap_house_frame") or {}).get("time", 0.0)) * 1000)),
    }


def _screenshot_filename(index: int, label: str, frame_idx: int) -> str:
    return f"{index:02d}_{_safe_label(label)}_frame_{frame_idx:05d}.jpg"


def write_validation_package(
    analysis: dict,
    output_root: Path,
    screenshot_count: int = DEFAULT_SCREENSHOT_COUNT,
) -> Path:
    package_name = Path(analysis["video_path"]).stem
    package_dir = output_root / package_name
    screenshots_dir = package_dir / "screenshots"
    package_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    original_video_path = _copy_original_video(analysis["video_path"], package_dir)

    csv_rows = flatten_tracking_rows(analysis)
    csv_path = package_dir / "extracted_data.csv"
    _save_csv(csv_path, csv_rows)

    selected_frames = select_validation_frames(
        frames=analysis["tracking_data"],
        desired_count=screenshot_count,
        trigger_time=analysis["trigger_time"],
        pretrigger_time=analysis["pretrigger_summary"].get("pretrigger_time"),
        decision_time=(analysis.get("decision_frame") or {}).get("time"),
        first_trap_house_time=(analysis.get("first_trap_house_frame") or {}).get("time"),
    )

    cached_frames: dict[int, str] = analysis.get("cached_frames", {})
    use_cache = bool(cached_frames)

    def _read_frame(cap_obj, target_idx: int):
        if use_cache and target_idx in cached_frames:
            return cv2.imread(cached_frames[target_idx])
        cap_obj.set(cv2.CAP_PROP_POS_FRAMES, target_idx)
        ret, f = cap_obj.read()
        return f if ret else None

    cap = cv2.VideoCapture(analysis["video_path"])
    screenshot_files: list[str] = []
    for index, selection in enumerate(selected_frames):
        frame_idx = int(selection["frame_idx"])
        frame = _read_frame(cap, frame_idx)
        if frame is None:
            continue
        analysis_frame = _find_analysis_frame_by_idx(analysis, frame_idx) or selection["frame"]
        annotated = draw_overlay_boxes(
            frame,
            analysis_frame.get("overlay_boxes", []),
            timestamp_ms=int(round(float(selection["time"]) * 1000)),
        )
        screenshot_name = _screenshot_filename(index, selection["label"], frame_idx)
        screenshot_path = screenshots_dir / screenshot_name
        cv2.imwrite(str(screenshot_path), annotated)
        screenshot_files.append(str(screenshot_path))

    fps = float(analysis["fps"]) or 60.0
    width = int(analysis["frame_width"])
    height = int(analysis["frame_height"])
    panel_height = max(220, height // 4)
    review_video_path = package_dir / "validation_review.mp4"
    writer = cv2.VideoWriter(
        str(review_video_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height + panel_height),
    )

    envelope = build_audio_envelope(analysis.get("audio_data"), width)
    duration_seconds = max(float(analysis["total_frames"]) / fps, float(analysis["trigger_time"]))
    marker_times = {
        "trigger": analysis["trigger_time"],
        "pretrigger": analysis["pretrigger_summary"].get("pretrigger_time"),
        "decision_frame": (analysis.get("decision_frame") or {}).get("time"),
    }

    tracking_data = analysis["tracking_data"]
    tracking_idx = 0
    total_frames = int(analysis["total_frames"])
    for frame_idx in range(total_frames):
        frame = _read_frame(cap, frame_idx)
        if frame is None:
            break

        while tracking_idx + 1 < len(tracking_data) and int(tracking_data[tracking_idx + 1]["frame_idx"]) <= frame_idx:
            tracking_idx += 1

        overlay_boxes = _interpolate_overlay_boxes(tracking_data, tracking_idx, frame_idx)
        annotated_frame = draw_overlay_boxes(
            frame,
            overlay_boxes,
            timestamp_ms=int(round((frame_idx / fps) * 1000)),
        )
        waveform_panel = render_waveform_panel(
            width=width,
            height=panel_height,
            envelope=envelope,
            duration_seconds=duration_seconds,
            current_time=frame_idx / fps,
            markers=marker_times,
        )
        writer.write(np.vstack([annotated_frame, waveform_panel]))

    writer.release()
    cap.release()

    manifest = _build_manifest(
        analysis=analysis,
        package_dir=package_dir,
        screenshot_files=screenshot_files,
        csv_path=csv_path,
        review_video_path=review_video_path,
        original_video_path=original_video_path,
    )
    validation_results = run_validation_checks(analysis)
    validation_path = package_dir / "validation_results.json"
    validation_path.write_text(json.dumps(validation_results, indent=2))

    if cached_frames:
        import shutil as _shutil
        cache_dir_path = Path(list(cached_frames.values())[0]).parent
        _shutil.rmtree(cache_dir_path, ignore_errors=True)

    manifest["validation_status"] = validation_results["status"]
    manifest["validation_checks"] = validation_results["checks"]
    manifest_path = package_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return package_dir


def _compute_iou(box_a: dict, box_b: dict) -> float:
    ax1 = float(box_a.get("x", 0))
    ay1 = float(box_a.get("y", 0))
    ax2 = ax1 + float(box_a.get("width", 0))
    ay2 = ay1 + float(box_a.get("height", 0))

    bx1 = float(box_b.get("x", 0))
    by1 = float(box_b.get("y", 0))
    bx2 = bx1 + float(box_b.get("width", 0))
    by2 = by1 + float(box_b.get("height", 0))

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_area = max(0.0, inter_x2 - inter_x1) * max(0.0, inter_y2 - inter_y1)

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union_area = area_a + area_b - inter_area
    if union_area <= 0:
        return 0.0
    return inter_area / union_area


def _pick_clay_visible_frames(tracking: list[dict], count: int = 3) -> list[dict]:
    clay_frames = [
        frame for frame in tracking
        if any(
            (box.get("class_name") or "").lower() == "clay-targets"
            for box in frame.get("overlay_boxes", [])
        )
    ]
    if len(clay_frames) <= count:
        return clay_frames
    indices = np.linspace(0, len(clay_frames) - 1, num=count, dtype=int).tolist()
    return [clay_frames[i] for i in indices]


def _get_clay_bbox(boxes: list[dict]) -> Optional[dict]:
    for box in boxes:
        if (box.get("class_name") or box.get("class") or "").lower() == "clay-targets":
            if isinstance(box.get("bbox"), dict):
                return box["bbox"]
            w = float(box.get("width", 0))
            h = float(box.get("height", 0))
            cx = float(box.get("x", 0))
            cy = float(box.get("y", 0))
            return {"x": cx - w / 2, "y": cy - h / 2, "width": w, "height": h}
    return None


def _check_overlay_alignment_iou(
    analysis: dict,
    iou_threshold: float = 0.7,
    sample_count: int = 3,
) -> dict:
    tracking = analysis.get("tracking_data", [])
    cached_frames = analysis.get("cached_frames", {})
    sample_frames = _pick_clay_visible_frames(tracking, count=sample_count)

    if not sample_frames:
        return _check(
            "overlay_frame_alignment",
            False,
            "No clay-visible frames available for alignment check",
        )

    if not cached_frames:
        return _check(
            "overlay_frame_alignment",
            False,
            "No cached frames available; cannot run re-inference alignment check",
        )

    try:
        from cv_pipeline.pipeline import infer_predictions
        from cv_pipeline.analysis import format_overlay_boxes, DEFAULT_CLASS_THRESHOLDS
        from inference_sdk import InferenceHTTPClient

        api_key = analysis.get("_roboflow_api_key") or os.getenv("ROBOFLOW_API_KEY", "")
        model_id = analysis.get("_roboflow_model_id") or f"{os.getenv('ROBOFLOW_PROJECT', 'claytargets-id')}/{os.getenv('ROBOFLOW_VERSION', '19')}"
        client = InferenceHTTPClient(
            api_url="https://detect.roboflow.com",
            api_key=api_key,
        )
    except Exception as exc:
        return _check(
            "overlay_frame_alignment",
            False,
            f"Could not initialize inference client for alignment check: {exc}",
        )

    iou_scores: list[float] = []
    details: list[str] = []

    for frame_entry in sample_frames:
        frame_idx = int(frame_entry.get("frame_idx", -1))
        cache_path = cached_frames.get(frame_idx)
        if not cache_path or not os.path.exists(cache_path):
            details.append(f"frame {frame_idx}: cached image missing, skipped")
            continue

        raw_frame = cv2.imread(cache_path)
        if raw_frame is None:
            details.append(f"frame {frame_idx}: could not read cached image, skipped")
            continue

        fresh_predictions = infer_predictions(client, model_id, raw_frame)
        fresh_boxes = format_overlay_boxes(fresh_predictions, class_thresholds=DEFAULT_CLASS_THRESHOLDS)

        pipeline_bbox = _get_clay_bbox(frame_entry.get("overlay_boxes", []))
        fresh_bbox = _get_clay_bbox(fresh_boxes)

        if pipeline_bbox is None and fresh_bbox is None:
            iou_scores.append(1.0)
            details.append(f"frame {frame_idx}: neither run detected clay (agreement)")
            continue
        if pipeline_bbox is None or fresh_bbox is None:
            iou_scores.append(0.0)
            details.append(f"frame {frame_idx}: detection mismatch (pipeline={'yes' if pipeline_bbox else 'no'}, fresh={'yes' if fresh_bbox else 'no'})")
            continue

        iou = _compute_iou(pipeline_bbox, fresh_bbox)
        iou_scores.append(iou)
        details.append(f"frame {frame_idx}: IoU={iou:.3f}")

    if not iou_scores:
        return _check(
            "overlay_frame_alignment",
            False,
            "No frames could be checked for alignment",
        )

    avg_iou = sum(iou_scores) / len(iou_scores)
    min_iou = min(iou_scores)
    passed = min_iou >= iou_threshold

    return _check(
        "overlay_frame_alignment",
        passed,
        f"Avg IoU={avg_iou:.3f}, Min IoU={min_iou:.3f} (threshold={iou_threshold}). " + "; ".join(details),
    )


def _check(name: str, passed: bool, detail: str, is_warning: bool = False) -> dict:
    if passed:
        return {"name": name, "status": "pass", "detail": detail}
    return {"name": name, "status": "warn" if is_warning else "fail", "detail": detail}


def run_validation_checks(analysis: dict, min_clay_frames: int = 3) -> dict:
    checks: list[dict] = []
    trigger_time = float(analysis.get("trigger_time", 0.0))
    tracking = analysis.get("tracking_data", [])
    pretrigger_summary = analysis.get("pretrigger_summary", {})

    pre_trigger_clay_count = sum(
        1
        for frame in tracking
        if float(frame.get("time", 0.0)) <= trigger_time
        and any(
            (box.get("class_name") or "").lower() in ("clay-targets",)
            for box in frame.get("overlay_boxes", [])
        )
    )
    checks.append(
        _check(
            "clay_detected_before_trigger",
            pre_trigger_clay_count >= min_clay_frames,
            f"{pre_trigger_clay_count} frames with clay before trigger (need >= {min_clay_frames})",
        )
    )

    pretrigger_time = pretrigger_summary.get("pretrigger_time")
    has_pretrigger_clay = pretrigger_time is not None and pre_trigger_clay_count > 0
    checks.append(
        _check(
            "pretrigger_frame_has_clay",
            has_pretrigger_clay,
            f"Pretrigger time: {pretrigger_time}, clay count before trigger: {pre_trigger_clay_count}",
        )
    )

    post_trigger_detection_count = sum(
        1
        for frame in tracking
        if float(frame.get("time", 0.0)) >= trigger_time
        and any(
            (box.get("class_name") or "").lower() in ("clay-targets", "broken-clay")
            for box in frame.get("overlay_boxes", [])
        )
    )
    break_label = analysis.get("break_label", "unknown")
    checks.append(
        _check(
            "break_or_miss_detected",
            break_label in ("break", "miss"),
            f"Break label: {break_label}, post-trigger detections: {post_trigger_detection_count}",
        )
    )

    trap_detected = any(
        any(
            (box.get("class_name") or "").lower() in ("trap-house", "trap-house-1-2", "trap-house-4-5")
            for box in frame.get("overlay_boxes", [])
        )
        for frame in tracking
    )
    checks.append(
        _check(
            "trap_house_detected",
            trap_detected,
            "Trap house detected" if trap_detected else "No trap house detection in any frame",
            is_warning=True,
        )
    )

    alignment_result = _check_overlay_alignment_iou(analysis, iou_threshold=0.7, sample_count=3)
    checks.append(alignment_result)

    clay_frame_indices = sorted(
        int(frame["frame_idx"])
        for frame in tracking
        if float(frame.get("time", 0.0)) <= trigger_time
        and any(
            (box.get("class_name") or "").lower() == "clay-targets"
            for box in frame.get("overlay_boxes", [])
        )
    )
    max_gap = 0
    for i in range(1, len(clay_frame_indices)):
        max_gap = max(max_gap, clay_frame_indices[i] - clay_frame_indices[i - 1])
    fps = float(analysis.get("fps", 60))
    gap_threshold = int(fps * 0.5)
    checks.append(
        _check(
            "detection_continuity",
            max_gap <= gap_threshold,
            f"Max gap between clay detections: {max_gap} frames ({max_gap / fps:.2f}s), threshold: {gap_threshold} frames",
            is_warning=True,
        )
    )

    has_fail = any(c["status"] == "fail" for c in checks)
    has_warn = any(c["status"] == "warn" for c in checks)
    overall = "fail" if has_fail else ("review" if has_warn else "pass")

    return {"status": overall, "checks": checks}
