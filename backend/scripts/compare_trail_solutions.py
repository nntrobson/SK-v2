"""Generate side-by-side validation packages with different trail strategies.

Runs the CV pipeline ONCE, then renders three review videos from the same
analysis data, each labelled with a different trail approach so the user can
visually compare the squiggle fix candidates.

Solutions:
  A  overlay_trail   – Trail drawn from the same interpolated overlay_boxes
                        clay centers that drive the bounding box.  No ByteTrack.
  B  dominant_id     – Keep the stabilized ByteTrack path but restrict to the
                        single dominant tracker-ID history and reject backward /
                        large-jump steps before appending.
  C  smoothed_trail  – Same stabilized ByteTrack path, but apply a 5-point
                        moving-average on the screen-mapped trail before drawing.
"""
from __future__ import annotations

import math
import os
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import cv2
import numpy as np
import supervision as sv

from cv_pipeline.pipeline import analyze_video_file
from cv_pipeline.validation_package import (
    _interpolate_overlay_boxes,
    _interpolate_raw_predictions,
    draw_overlay_boxes,
    render_waveform_panel,
    build_audio_envelope,
)
from cv_pipeline.stabilizer import GlobalMotionStabilizer, CrosshairTraceAnnotator


# ---------------------------------------------------------------------------
# Trail strategy helpers
# ---------------------------------------------------------------------------

class OverlayBoxTrail:
    """Solution A – draw the orange trail from the same clay centers used for
    the bounding boxes (interpolated overlay_boxes), stabilised into global
    space via the per-frame transform matrix and then projected back."""

    def __init__(self, color=(0, 165, 255), thickness=3):
        self.global_history: list[tuple[float, float]] = []
        self.color = color
        self.thickness = thickness
        self.frozen = False

    def freeze(self):
        self.frozen = True

    def update(self, clay_cx: float | None, clay_cy: float | None,
               transform_matrix: np.ndarray):
        if self.frozen:
            return
        if clay_cx is None or clay_cy is None:
            return
        pt_global = transform_matrix @ np.array([clay_cx, clay_cy, 1.0])
        self.global_history.append((float(pt_global[0]), float(pt_global[1])))

    def draw(self, frame: np.ndarray, transform_matrix: np.ndarray) -> np.ndarray:
        if len(self.global_history) < 2:
            return frame
        inv = np.linalg.inv(transform_matrix)
        pts = []
        for gx, gy in self.global_history:
            sp = inv @ np.array([gx, gy, 1.0])
            pts.append((int(sp[0]), int(sp[1])))
        for i in range(1, len(pts)):
            cv2.line(frame, pts[i - 1], pts[i], self.color, self.thickness)
        return frame


class DominantIdTrail:
    """Solution B – use ByteTrack but keep only the longest tracker-ID
    history.  Reject backward steps and large jumps (> 3x median step)."""

    def __init__(self, fps=60, trace_length=1200, color=(0, 165, 255), thickness=3):
        self.tracker = sv.ByteTrack(
            track_activation_threshold=0.1,
            lost_track_buffer=fps * 2,
            minimum_matching_threshold=0.8,
            frame_rate=fps,
        )
        self.history: dict[int, list[tuple[float, float]]] = {}
        self.trace_length = trace_length
        self.color = color
        self.thickness = thickness
        self.frozen = False
        self.padding = 100

    def freeze(self):
        self.frozen = True

    def update(self, clay_preds: list[dict], transform_matrix: np.ndarray):
        if not clay_preds:
            empty = sv.Detections(xyxy=np.empty((0, 4)),
                                  confidence=np.array([]),
                                  class_id=np.array([]))
            self.tracker.update_with_detections(empty)
            return

        xyxy, confs, cids = [], [], []
        for p in clay_preds:
            x, y, w, h = float(p["x"]), float(p["y"]), float(p["width"]), float(p["height"])
            xyxy.append([x - w/2 - self.padding, y - h/2 - self.padding,
                         x + w/2 + self.padding, y + h/2 + self.padding])
            confs.append(float(p["confidence"]))
            cids.append(0)

        dets = sv.Detections(xyxy=np.array(xyxy),
                             confidence=np.array(confs),
                             class_id=np.array(cids))
        tracked = self.tracker.update_with_detections(dets)

        if len(tracked) > 0:
            tracked.xyxy[:, 0] += self.padding
            tracked.xyxy[:, 1] += self.padding
            tracked.xyxy[:, 2] -= self.padding
            tracked.xyxy[:, 3] -= self.padding

        if self.frozen:
            return

        for i in range(len(tracked)):
            tid = tracked.tracker_id[i]
            bbox = tracked.xyxy[i]
            cx = (bbox[0] + bbox[2]) / 2
            cy = (bbox[1] + bbox[3]) / 2
            if tid not in self.history:
                self.history[tid] = []

            hist = self.history[tid]
            if hist:
                prev = hist[-1]
                dx = cx - prev[0]
                dy = cy - prev[1]
                step_len = math.sqrt(dx*dx + dy*dy)

                if len(hist) >= 3:
                    recent_steps = []
                    for j in range(max(0, len(hist)-5), len(hist)-1):
                        ddx = hist[j+1][0] - hist[j][0]
                        ddy = hist[j+1][1] - hist[j][1]
                        recent_steps.append(math.sqrt(ddx*ddx + ddy*ddy))
                    median_step = sorted(recent_steps)[len(recent_steps)//2] if recent_steps else step_len
                    if step_len > 3.0 * max(median_step, 1.0):
                        continue

                    dom_dx = hist[-1][0] - hist[0][0]
                    dom_dy = hist[-1][1] - hist[0][1]
                    dom_len = math.sqrt(dom_dx*dom_dx + dom_dy*dom_dy)
                    if dom_len > 1.0 and (dx*dom_dx + dy*dom_dy) / dom_len < -0.5 * step_len:
                        continue

            hist.append((cx, cy))
            if len(hist) > self.trace_length:
                hist.pop(0)

    def draw(self, frame: np.ndarray, transform_matrix: np.ndarray) -> np.ndarray:
        if not self.history:
            return frame

        best_tid = max(self.history, key=lambda k: len(self.history[k]))
        points = self.history[best_tid]
        if len(points) < 2:
            return frame

        inv = np.linalg.inv(transform_matrix)
        screen_pts = []
        for sx, sy in points:
            pt = inv @ np.array([sx, sy, 1.0])
            screen_pts.append((int(pt[0]), int(pt[1])))

        for i in range(1, len(screen_pts)):
            cv2.line(frame, screen_pts[i-1], screen_pts[i], self.color, self.thickness)
        return frame


class SmoothedTrail:
    """Solution C – same raw stabilized ByteTrack path as current, but apply
    a moving-average window before drawing."""

    def __init__(self, fps=60, trace_length=1200, color=(0, 165, 255),
                 thickness=3, window=5):
        self.tracker = sv.ByteTrack(
            track_activation_threshold=0.1,
            lost_track_buffer=fps * 2,
            minimum_matching_threshold=0.8,
            frame_rate=fps,
        )
        self.history: dict[int, list[tuple[float, float]]] = {}
        self.trace_length = trace_length
        self.color = color
        self.thickness = thickness
        self.window = window
        self.frozen = False
        self.padding = 100

    def freeze(self):
        self.frozen = True

    def update(self, clay_preds: list[dict], transform_matrix: np.ndarray):
        if not clay_preds:
            empty = sv.Detections(xyxy=np.empty((0, 4)),
                                  confidence=np.array([]),
                                  class_id=np.array([]))
            self.tracker.update_with_detections(empty)
            return

        xyxy, confs, cids = [], [], []
        for p in clay_preds:
            x, y, w, h = float(p["x"]), float(p["y"]), float(p["width"]), float(p["height"])
            xyxy.append([x - w/2 - self.padding, y - h/2 - self.padding,
                         x + w/2 + self.padding, y + h/2 + self.padding])
            confs.append(float(p["confidence"]))
            cids.append(0)

        dets = sv.Detections(xyxy=np.array(xyxy),
                             confidence=np.array(confs),
                             class_id=np.array(cids))
        tracked = self.tracker.update_with_detections(dets)

        if len(tracked) > 0:
            tracked.xyxy[:, 0] += self.padding
            tracked.xyxy[:, 1] += self.padding
            tracked.xyxy[:, 2] -= self.padding
            tracked.xyxy[:, 3] -= self.padding

        if self.frozen:
            return

        for i in range(len(tracked)):
            tid = tracked.tracker_id[i]
            bbox = tracked.xyxy[i]
            cx = (bbox[0] + bbox[2]) / 2
            cy = (bbox[1] + bbox[3]) / 2

            if tid not in self.history:
                self.history[tid] = []

            hist = self.history[tid]
            if not hist or (abs(hist[-1][0] - cx) > 0.1 or abs(hist[-1][1] - cy) > 0.1):
                hist.append((cx, cy))
            if len(hist) > self.trace_length:
                hist.pop(0)

    def draw(self, frame: np.ndarray, transform_matrix: np.ndarray) -> np.ndarray:
        if not self.history:
            return frame

        inv = np.linalg.inv(transform_matrix)

        for tid, raw_pts in self.history.items():
            if len(raw_pts) < 2:
                continue

            screen_pts = []
            for sx, sy in raw_pts:
                pt = inv @ np.array([sx, sy, 1.0])
                screen_pts.append((pt[0], pt[1]))

            w = self.window
            smoothed = []
            for i in range(len(screen_pts)):
                lo = max(0, i - w // 2)
                hi = min(len(screen_pts), i + w // 2 + 1)
                avg_x = sum(p[0] for p in screen_pts[lo:hi]) / (hi - lo)
                avg_y = sum(p[1] for p in screen_pts[lo:hi]) / (hi - lo)
                smoothed.append((int(avg_x), int(avg_y)))

            for i in range(1, len(smoothed)):
                cv2.line(frame, smoothed[i-1], smoothed[i], self.color, self.thickness)

        return frame


# ---------------------------------------------------------------------------
# Render one review video with a given trail strategy
# ---------------------------------------------------------------------------

def render_review_video(
    analysis: dict,
    trail_strategy,
    output_path: Path,
    label: str,
):
    fps = float(analysis["fps"]) or 60.0
    width = int(analysis["frame_width"])
    height = int(analysis["frame_height"])
    total_frames = int(analysis["total_frames"])
    tracking_data = analysis["tracking_data"]
    frame_analysis_data = analysis.get("frame_analysis", [])
    cached_frames: dict[int, str] = analysis.get("cached_frames", {})
    use_cache = bool(cached_frames)

    panel_height = max(220, height // 4)
    envelope = build_audio_envelope(analysis.get("audio_data"), width)
    duration_seconds = max(total_frames / fps, float(analysis["trigger_time"]))
    marker_times = {
        "trigger": analysis["trigger_time"],
        "pretrigger": analysis["pretrigger_summary"].get("pretrigger_time"),
        "decision_frame": (analysis.get("decision_frame") or {}).get("time"),
    }

    pretrigger_time = analysis["pretrigger_summary"].get("pretrigger_time")

    stabilizer = GlobalMotionStabilizer()
    crosshair = CrosshairTraceAnnotator(trace_length=int(fps * 20), thickness=2)

    cap = cv2.VideoCapture(analysis["video_path"])
    writer = cv2.VideoWriter(
        str(output_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height + panel_height),
    )

    tracking_idx = 0
    trails_frozen = False

    for frame_idx in range(total_frames):
        if use_cache and frame_idx in cached_frames:
            frame = cv2.imread(cached_frames[frame_idx])
        else:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break

        current_time = frame_idx / fps
        if not trails_frozen and pretrigger_time is not None and current_time >= pretrigger_time:
            trail_strategy.freeze()
            crosshair.freeze()
            trails_frozen = True

        while tracking_idx + 1 < len(tracking_data) and int(tracking_data[tracking_idx + 1]["frame_idx"]) <= frame_idx:
            tracking_idx += 1

        overlay_boxes = _interpolate_overlay_boxes(tracking_data, tracking_idx, frame_idx)
        annotated = frame.copy()

        transform_matrix = stabilizer.process_frame(annotated)

        raw_preds = _interpolate_raw_predictions(frame_analysis_data, tracking_idx, frame_idx)
        stabilized_preds = stabilizer.stabilize_predictions(raw_preds, transform_matrix)
        clay_preds = [
            p for p in stabilized_preds
            if str(p.get("class_name", p.get("class", ""))).lower() == "clay-targets"
            and float(p.get("confidence", 0.0)) >= 0.1
        ]

        if isinstance(trail_strategy, OverlayBoxTrail):
            clay_center_x, clay_center_y = None, None
            for box in overlay_boxes:
                cn = (box.get("class_name") or "").lower()
                if cn == "clay-targets":
                    bbox = box.get("bbox")
                    if isinstance(bbox, dict):
                        clay_center_x = float(bbox["x"]) + float(bbox["width"]) / 2
                        clay_center_y = float(bbox["y"]) + float(bbox["height"]) / 2
                    else:
                        clay_center_x = float(box["x"])
                        clay_center_y = float(box["y"])
                    break
            trail_strategy.update(clay_center_x, clay_center_y, transform_matrix)
        else:
            trail_strategy.update(clay_preds, transform_matrix)

        annotated = trail_strategy.draw(annotated, transform_matrix)

        clay_active = any(
            (b.get("class_name") or "").lower() == "clay-targets"
            for b in overlay_boxes
        )
        annotated = crosshair.update_and_annotate(
            annotated, transform_matrix, width, height, clay_active=clay_active
        )

        annotated = draw_overlay_boxes(
            annotated, overlay_boxes,
            timestamp_ms=int(round(current_time * 1000)),
        )

        cv2.putText(
            annotated, f"[{label}]",
            (10, height - 20),
            cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2, cv2.LINE_AA,
        )

        panel = render_waveform_panel(
            width=width, height=panel_height,
            envelope=envelope,
            duration_seconds=duration_seconds,
            current_time=current_time,
            markers=marker_times,
        )
        writer.write(np.vstack([annotated, panel]))

    writer.release()
    cap.release()
    print(f"  [{label}] Written -> {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Compare trail-smoothing solutions")
    parser.add_argument("--filename", default="20240608125600SHOT0081.MP4")
    parser.add_argument("--video-dir", type=Path,
                        default=Path("/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/uploaded_videos"))
    parser.add_argument("--output-dir", type=Path, default=ROOT / "validation_packages" / "trail_comparison")
    args = parser.parse_args()

    video_path = args.video_dir / args.filename
    if not video_path.exists():
        print(f"Video not found: {video_path}")
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Running CV pipeline on {args.filename} ...")
    cache_dir = tempfile.mkdtemp(prefix="trail_cmp_")
    analysis = analyze_video_file(str(video_path), cache_frames_dir=cache_dir)
    print(f"  Pipeline complete. {len(analysis['frame_analysis'])} keyframes analysed.")

    fps = float(analysis["fps"]) or 60.0

    solutions = [
        ("A_overlay_trail", OverlayBoxTrail(color=(0, 165, 255), thickness=3)),
        ("B_dominant_id",   DominantIdTrail(fps=int(fps), trace_length=int(fps*20),
                                            color=(0, 165, 255), thickness=3)),
        ("C_smoothed_trail", SmoothedTrail(fps=int(fps), trace_length=int(fps*20),
                                           color=(0, 165, 255), thickness=3, window=7)),
    ]

    for label, strategy in solutions:
        out_path = args.output_dir / f"{Path(args.filename).stem}_{label}.mp4"
        render_review_video(analysis, strategy, out_path, label)

    print(f"\nAll 3 comparison videos in: {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
