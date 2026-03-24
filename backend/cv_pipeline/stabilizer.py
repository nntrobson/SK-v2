import logging
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np
import supervision as sv
import copy

logger = logging.getLogger(__name__)

class GlobalMotionStabilizer:
    def __init__(self):
        self.prev_gray = None
        self.prev_pts = None
        # Accumulated transformation from current frame to the reference (first) frame
        # We start with the identity matrix
        self.cumulative_transform = np.eye(3, dtype=np.float32)

    def _get_mask(self, shape):
        """
        Creates a mask to ignore the gun barrel and UI elements at the bottom.
        shape: (height, width)
        """
        mask = np.ones(shape, dtype=np.uint8) * 255
        h, w = shape
        
        # Mask out the bottom 30% of the center to hide the gun barrel
        mask[int(h * 0.7):, :] = 0
        return mask

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """
        Calculates optical flow, updates the cumulative transformation matrix,
        and returns the matrix that maps the CURRENT frame coordinates to the 
        REFERENCE (first) frame coordinates.
        """
        curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if self.prev_gray is None:
            self.prev_gray = curr_gray
            self.prev_pts = cv2.goodFeaturesToTrack(
                self.prev_gray,
                maxCorners=200,
                qualityLevel=0.01,
                minDistance=30,
                blockSize=3,
                mask=self._get_mask(curr_gray.shape)
            )
            return self.cumulative_transform

        # If we lost tracking points, re-detect
        if self.prev_pts is None or len(self.prev_pts) < 10:
            self.prev_pts = cv2.goodFeaturesToTrack(
                self.prev_gray,
                maxCorners=200,
                qualityLevel=0.01,
                minDistance=30,
                blockSize=3,
                mask=self._get_mask(self.prev_gray.shape)
            )

        if self.prev_pts is not None and len(self.prev_pts) >= 10:
            curr_pts, status, err = cv2.calcOpticalFlowPyrLK(self.prev_gray, curr_gray, self.prev_pts, None)
            
            # Filter good points
            idx = np.where(status == 1)[0]
            prev_pts_good = self.prev_pts[idx]
            curr_pts_good = curr_pts[idx]

            # We want the transformation from CURRENT to PREVIOUS frame
            # so that when we accumulate, we go from CURRENT -> PREV -> ... -> FIRST
            if len(prev_pts_good) >= 4:
                # Estimate affine transform from current to previous
                # m: 2x3 matrix mapping current points to previous points
                m, inliers = cv2.estimateAffinePartial2D(curr_pts_good, prev_pts_good, method=cv2.RANSAC)
                
                if m is not None:
                    # Convert to 3x3
                    m3 = np.eye(3, dtype=np.float32)
                    m3[0:2, :] = m
                    
                    # Accumulate transformation
                    self.cumulative_transform = self.cumulative_transform @ m3
                
            # Update for next frame
            self.prev_gray = curr_gray
            self.prev_pts = curr_pts_good.reshape(-1, 1, 2) if len(curr_pts_good) > 0 else None
        else:
            self.prev_gray = curr_gray

        return self.cumulative_transform

    def stabilize_predictions(self, predictions: List[Dict], transform_matrix: np.ndarray) -> List[Dict]:
        """
        Maps current predictions to the global (reference) coordinate space using the cumulative transform matrix.
        transform_matrix: 3x3 matrix mapping CURRENT -> REFERENCE.
        """
        stabilized = []
        for p in predictions:
            p_copy = p.copy()
            x = float(p["x"])
            y = float(p["y"])
            
            # Apply affine transformation: [x_new, y_new, 1]^T = M * [x, y, 1]^T
            pt = np.array([x, y, 1.0])
            pt_new = transform_matrix @ pt
            
            p_copy["x"] = pt_new[0]
            p_copy["y"] = pt_new[1]
            stabilized.append(p_copy)
        return stabilized


class CrosshairTraceAnnotator:
    """Track and draw the gun/crosshair path in stabilized space.

    The crosshair is always at frame center in screen space, but moves in
    global (stabilized) space as the camera pans.  Drawing this trail on
    screen shows how the gun tracked toward the target.
    """

    def __init__(self, trace_length: int = 1200, thickness: int = 2, color: tuple = (0, 0, 255)):
        self.history: list[tuple[float, float]] = []
        self.trace_length = trace_length
        self.thickness = thickness
        self.color = color
        self.frozen = False

    def freeze(self) -> None:
        self.frozen = True

    def update_and_annotate(
        self,
        frame: np.ndarray,
        transform_matrix: np.ndarray,
        frame_width: int,
        frame_height: int,
        clay_active: bool = False,
    ) -> np.ndarray:
        if not clay_active and not self.history:
            return frame

        if not self.frozen:
            cx, cy = frame_width / 2.0, frame_height / 2.0
            pt_global = transform_matrix @ np.array([cx, cy, 1.0])
            self.history.append((float(pt_global[0]), float(pt_global[1])))

            if len(self.history) > self.trace_length:
                self.history.pop(0)

        if len(self.history) >= 2:
            inv_transform = np.linalg.inv(transform_matrix)
            screen_points = []
            for gx, gy in self.history:
                pt_screen = inv_transform @ np.array([gx, gy, 1.0])
                screen_points.append((int(pt_screen[0]), int(pt_screen[1])))

            for i in range(1, len(screen_points)):
                cv2.line(frame, screen_points[i - 1], screen_points[i], self.color, self.thickness)

        return frame


class StabilizedTraceAnnotator:
    SMOOTH_WINDOW = 7

    def __init__(self, trace_length: int = 120, thickness: int = 2, color: tuple = (0, 165, 255)):
        self.history = [] # list of (x, y) stabilized
        self.trace_length = trace_length
        self.thickness = thickness
        self.color = color
        self.frozen = False

    def freeze(self) -> None:
        self.frozen = True

    def update_and_annotate(self, frame: np.ndarray, tracked_detections: sv.Detections, transform_matrix: np.ndarray) -> np.ndarray:
        if not self.frozen and len(tracked_detections) > 0:
            # Pick the most confident or first detection if multiple
            # Usually only one primary clay is tracked
            idx = 0
            if hasattr(tracked_detections, 'confidence') and tracked_detections.confidence is not None and len(tracked_detections.confidence) > 0:
                idx = np.argmax(tracked_detections.confidence)
                
            bbox = tracked_detections.xyxy[idx]
            cx = (bbox[0] + bbox[2]) / 2
            cy = (bbox[1] + bbox[3]) / 2

            if not self.history or (abs(self.history[-1][0] - cx) > 0.1 or abs(self.history[-1][1] - cy) > 0.1):
                self.history.append((cx, cy))

            if len(self.history) > self.trace_length:
                self.history.pop(0)

        inv_transform = np.linalg.inv(transform_matrix)

        if len(self.history) >= 2:
            screen_points_raw = []
            for (sx, sy) in self.history:
                pt_screen = inv_transform @ np.array([sx, sy, 1.0])
                screen_points_raw.append((pt_screen[0], pt_screen[1]))

            w = self.SMOOTH_WINDOW
            smoothed = []
            for i in range(len(screen_points_raw)):
                lo = max(0, i - w // 2)
                hi = min(len(screen_points_raw), i + w // 2 + 1)
                avg_x = sum(p[0] for p in screen_points_raw[lo:hi]) / (hi - lo)
                avg_y = sum(p[1] for p in screen_points_raw[lo:hi]) / (hi - lo)
                smoothed.append((int(avg_x), int(avg_y)))

            for i in range(1, len(smoothed)):
                cv2.line(frame, smoothed[i-1], smoothed[i], self.color, self.thickness)

        return frame


class TrajectoryVisualizer:
    def __init__(self, fps: int = 60, trace_length: int = 1200):
        self.tracker = sv.ByteTrack(
            track_activation_threshold=0.05,
            lost_track_buffer=fps * 3,
            minimum_matching_threshold=0.4,
            frame_rate=fps,
        )
        self.trace_annotator = StabilizedTraceAnnotator(trace_length=trace_length, thickness=3)
        self.crosshair_annotator = CrosshairTraceAnnotator(trace_length=trace_length, thickness=2)

    def freeze_trails(self) -> None:
        self.trace_annotator.freeze()
        self.crosshair_annotator.freeze()

    def process_and_annotate(self, original_frame: np.ndarray, stabilized_predictions: List[Dict], transform_matrix: np.ndarray, frame_width: int = 0, frame_height: int = 0) -> Tuple[np.ndarray, List[Dict]]:
        """
        Runs stabilized clay predictions through ByteTrack, draws the trajectory
        trace on the frame, and returns screen-mapped detection dicts so the
        caller can draw bounding boxes in a consistent style.
        """
        clay_preds = [
            p for p in stabilized_predictions
            if str(p.get("class_name", p.get("class", ""))).lower() == "clay-targets" and float(p.get("confidence", 0.0)) >= 0.1
        ]

        annotated_frame = original_frame.copy()

        fw = frame_width or original_frame.shape[1]
        fh = frame_height or original_frame.shape[0]

        if not clay_preds:
            empty_detections = sv.Detections(
                xyxy=np.empty((0, 4)), confidence=np.array([]), class_id=np.array([])
            )
            tracked_detections = self.tracker.update_with_detections(empty_detections)
            annotated_frame = self.trace_annotator.update_and_annotate(annotated_frame, tracked_detections, transform_matrix)
            annotated_frame = self.crosshair_annotator.update_and_annotate(annotated_frame, transform_matrix, fw, fh, clay_active=False)
            return annotated_frame, []

        xyxy = []
        confidences = []
        class_ids = []
        padding = 100

        for p in clay_preds:
            x, y, w, h = float(p["x"]), float(p["y"]), float(p["width"]), float(p["height"])
            xyxy.append([
                x - w / 2 - padding,
                y - h / 2 - padding,
                x + w / 2 + padding,
                y + h / 2 + padding
            ])
            confidences.append(float(p["confidence"]))
            class_ids.append(0)

        detections = sv.Detections(
            xyxy=np.array(xyxy),
            confidence=np.array(confidences),
            class_id=np.array(class_ids)
        )

        tracked_detections = self.tracker.update_with_detections(detections)

        if len(tracked_detections) > 0:
            tracked_detections.xyxy[:, 0] += padding
            tracked_detections.xyxy[:, 1] += padding
            tracked_detections.xyxy[:, 2] -= padding
            tracked_detections.xyxy[:, 3] -= padding

        annotated_frame = self.trace_annotator.update_and_annotate(annotated_frame, tracked_detections, transform_matrix)
        annotated_frame = self.crosshair_annotator.update_and_annotate(annotated_frame, transform_matrix, fw, fh, clay_active=len(tracked_detections) > 0)

        screen_results: List[Dict] = []
        if len(tracked_detections) > 0:
            inv_transform = np.linalg.inv(transform_matrix)
            for i in range(len(tracked_detections)):
                x1, y1, x2, y2 = tracked_detections.xyxy[i]
                pts = np.array([
                    [x1, y1, 1.0],
                    [x2, y1, 1.0],
                    [x2, y2, 1.0],
                    [x1, y2, 1.0]
                ])
                pts_screen = (inv_transform @ pts.T).T
                sx1 = float(pts_screen[:, 0].min())
                sy1 = float(pts_screen[:, 1].min())
                sx2 = float(pts_screen[:, 0].max())
                sy2 = float(pts_screen[:, 1].max())
                cx = (sx1 + sx2) / 2
                cy = (sy1 + sy2) / 2
                screen_results.append({
                    "class_name": "clay-targets",
                    "confidence": round(float(tracked_detections.confidence[i]), 4),
                    "x": round(cx, 2),
                    "y": round(cy, 2),
                    "width": round(sx2 - sx1, 2),
                    "height": round(sy2 - sy1, 2),
                    "bbox": {
                        "x": round(sx1, 2),
                        "y": round(sy1, 2),
                        "width": round(sx2 - sx1, 2),
                        "height": round(sy2 - sy1, 2),
                    },
                })

        return annotated_frame, screen_results
