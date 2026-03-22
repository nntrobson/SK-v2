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


class StabilizedTraceAnnotator:
    def __init__(self, trace_length: int = 120, thickness: int = 2, color: tuple = (0, 165, 255)):
        self.history = {} # tracker_id -> list of (x, y) stabilized
        self.trace_length = trace_length
        self.thickness = thickness
        self.color = color

    def update_and_annotate(self, frame: np.ndarray, tracked_detections: sv.Detections, transform_matrix: np.ndarray) -> np.ndarray:
        # We need to maintain the full physical trajectory history, even if the tracker misses a frame.
        # But we also shouldn't clear history if a tracked_detection is missing for one frame,
        # so we persist the history independently of current detections.
        
        # Update history with STABILIZED coords
        for i in range(len(tracked_detections)):
            t_id = tracked_detections.tracker_id[i]
            bbox = tracked_detections.xyxy[i]
            cx = (bbox[0] + bbox[2]) / 2
            cy = (bbox[1] + bbox[3]) / 2
            
            if t_id not in self.history:
                self.history[t_id] = []
            
            # Don't add duplicate points if the target hasn't moved (happens during tracker coasting)
            if not self.history[t_id] or (abs(self.history[t_id][-1][0] - cx) > 0.1 or abs(self.history[t_id][-1][1] - cy) > 0.1):
                self.history[t_id].append((cx, cy))
            
            # keep history length
            if len(self.history[t_id]) > self.trace_length:
                self.history[t_id].pop(0)

        # Invert the transform matrix to map GLOBAL -> CURRENT screen coords
        inv_transform = np.linalg.inv(transform_matrix)

        # Draw traces mapped back to SCREEN coords
        for t_id, points in self.history.items():
            if len(points) < 2:
                continue
            
            # For drawing continuous paths even with missing frames
            screen_points = []
            for (sx, sy) in points:
                # Apply inverse transformation
                pt = np.array([sx, sy, 1.0])
                pt_screen = inv_transform @ pt
                screen_points.append((int(pt_screen[0]), int(pt_screen[1])))
                
            for i in range(1, len(screen_points)):
                cv2.line(frame, screen_points[i-1], screen_points[i], self.color, self.thickness)
                
        return frame


class TrajectoryVisualizer:
    def __init__(self, fps: int = 60, trace_length: int = 1200): # Allow up to 20 seconds of trace length to cover any shot
        # We use Supervision for ByteTrack and Trace Annotator
        # track_activation_threshold is set to 0.1 to listen for low-confidence detections
        self.tracker = sv.ByteTrack(
            track_activation_threshold=0.1,
            lost_track_buffer=fps * 2,  # Increase coasting memory to 2 seconds
            minimum_matching_threshold=0.8,
            frame_rate=fps,
        )
        self.trace_annotator = StabilizedTraceAnnotator(trace_length=trace_length, thickness=3) # thicker line
        self.box_annotator = sv.BoxAnnotator(thickness=1)
        self.label_annotator = sv.LabelAnnotator(text_scale=0.5, text_padding=5)

    def process_and_annotate(self, original_frame: np.ndarray, stabilized_predictions: List[Dict], transform_matrix: np.ndarray) -> Tuple[np.ndarray, List[Dict]]:
        """
        Takes stabilized predictions, semantic filters for 'clay-targets' AND conf >= 0.1,
        runs them through ByteTrack, and annotates the frame with traces.
        """
        # Semantic Filtering
        clay_preds = [
            p for p in stabilized_predictions 
            if str(p.get("class_name", p.get("class", ""))).lower() == "clay-targets" and float(p.get("confidence", 0.0)) >= 0.1
        ]

        annotated_frame = original_frame.copy()

        # If no clay predictions in current frame, update tracker with empty and update history
        if not clay_preds:
            # When tracking is completely lost, ByteTrack will clear out old tracks 
            # after the buffer, which clears the trace. Instead of letting ByteTrack 
            # draw the trace, we are manually keeping track in self.history in StabilizedTraceAnnotator.
            empty_detections = sv.Detections(
                xyxy=np.empty((0, 4)), confidence=np.array([]), class_id=np.array([])
            )
            tracked_detections = self.tracker.update_with_detections(empty_detections)
            annotated_frame = self.trace_annotator.update_and_annotate(annotated_frame, tracked_detections, transform_matrix)
            return annotated_frame, []

        # Convert to supervision Detections (Stabilized)
        xyxy = []
        confidences = []
        class_ids = []
        
        # Inflate the bounding boxes for the tracker so that fast-moving small clays 
        # still have overlapping IoU between frames, preventing broken tracks.
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
            class_ids.append(0)  # we only have one class here essentially

        detections = sv.Detections(
            xyxy=np.array(xyxy),
            confidence=np.array(confidences),
            class_id=np.array(class_ids)
        )

        # Temporal Linking (Tracking)
        tracked_detections = self.tracker.update_with_detections(detections)
        
        if len(tracked_detections) > 0:
            # Deflate the bounding boxes back to normal size before drawing
            tracked_detections.xyxy[:, 0] += padding
            tracked_detections.xyxy[:, 1] += padding
            tracked_detections.xyxy[:, 2] -= padding
            tracked_detections.xyxy[:, 3] -= padding
        
        # Annotate trace using stabilized history mapped to screen
        annotated_frame = self.trace_annotator.update_and_annotate(annotated_frame, tracked_detections, transform_matrix)

        if len(tracked_detections) > 0:
            # Shift bounding boxes back to screen coords for drawing
            inv_transform = np.linalg.inv(transform_matrix)
            screen_detections = copy.deepcopy(tracked_detections)
            
            for i in range(len(screen_detections)):
                x1, y1, x2, y2 = screen_detections.xyxy[i]
                pts = np.array([
                    [x1, y1, 1.0],
                    [x2, y1, 1.0],
                    [x2, y2, 1.0],
                    [x1, y2, 1.0]
                ])
                pts_screen = (inv_transform @ pts.T).T
                screen_detections.xyxy[i] = [
                    pts_screen[:, 0].min(),
                    pts_screen[:, 1].min(),
                    pts_screen[:, 0].max(),
                    pts_screen[:, 1].max()
                ]

            annotated_frame = self.box_annotator.annotate(
                scene=annotated_frame,
                detections=screen_detections
            )
            
            labels = [
                f"Clay #{tracker_id} {conf:.2f}"
                for conf, tracker_id
                in zip(screen_detections.confidence, screen_detections.tracker_id)
            ]
            annotated_frame = self.label_annotator.annotate(
                scene=annotated_frame,
                detections=screen_detections,
                labels=labels
            )

        # Return tracked results in dict form for potential downstream direction classification
        tracked_results = []
        for i in range(len(tracked_detections)):
            t_box = tracked_detections.xyxy[i]
            tracked_results.append({
                "tracker_id": tracked_detections.tracker_id[i],
                "x": (t_box[0] + t_box[2]) / 2,
                "y": (t_box[1] + t_box[3]) / 2,
                "width": t_box[2] - t_box[0],
                "height": t_box[3] - t_box[1],
                "confidence": tracked_detections.confidence[i],
                "class": "clay-targets"
            })

        return annotated_frame, tracked_results
