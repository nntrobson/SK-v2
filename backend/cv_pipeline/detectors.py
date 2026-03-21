import os
import cv2
import tempfile
from typing import Optional, List, Dict

import logging
logger = logging.getLogger(__name__)

class RoboflowDetector:
    def __init__(self, api_key: str, project_name: str, version: int):
        self.api_key = api_key
        self.project_name = project_name
        self.version = version
        self.model = None

    def initialize(self) -> bool:
        try:
            from roboflow import Roboflow
            rf = Roboflow(api_key=self.api_key)
            project = rf.workspace().project(self.project_name)
            self.model = project.version(self.version).model
            return True
        except Exception as e:
            logger.error(f"Failed to initialize Roboflow: {e}")
            return False

    def detect(self, image_np, confidence_threshold: float = 0.3) -> List[Dict]:
        if not self.model:
            return []
            
        try:
            # Save to temporary file for inference
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                cv2.imwrite(tmp.name, image_np)
                image_path = tmp.name
            
            result = self.model.predict(image_path, confidence=confidence_threshold)
            os.unlink(image_path)
            
            predictions = result.json().get('predictions', [])
            return predictions
        except Exception as e:
            logger.error(f"Detection failed: {e}")
            return []

    def get_best_clay_target(self, predictions: List[Dict], width: int, height: int) -> Optional[Dict]:
        clays = [p for p in predictions if p.get('class') == 'Clay-targets']
        if not clays:
            return None
            
        center_x = width / 2
        center_y = height / 2
        
        # Sort by confidence descending, then by distance to center
        def sort_key(p):
            dist = ((p['x'] - center_x)**2 + (p['y'] - center_y)**2)**0.5
            return (-p['confidence'], dist)
            
        clays.sort(key=sort_key)
        return clays[0]

def calculate_clay_offset(clay_pred: Dict, frame_width: int, frame_height: int, clay_diameter_inches: float = 4.33) -> tuple[float, float]:
    """Calculate the offset of the clay from the center of the frame in inches"""
    pixel_to_inches = clay_diameter_inches / clay_pred['width']
    
    # Shotkam crosshair is always dead center of the frame
    frame_center_x = frame_width / 2
    frame_center_y = frame_height / 2
    
    X_offset = (clay_pred['x'] - frame_center_x) * pixel_to_inches
    # Invert Y to standard cartesian (up is positive)
    Y_offset = (frame_center_y - clay_pred['y']) * pixel_to_inches
    
    return round(X_offset, 2), round(Y_offset, 2)
