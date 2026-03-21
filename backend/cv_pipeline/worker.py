import os
import time
from sqlalchemy.orm import Session
from app import models, database
from cv_pipeline.processor import extract_audio_from_video, detect_gunshot_onset, extract_shot_frames
from cv_pipeline.detectors import RoboflowDetector, calculate_clay_offset

def process_video_task(video_id: int):
    """
    Background worker that runs the CV pipeline on an uploaded video.
    For the MVP, we are using a simple synchronous function that can be spawned
    via FastAPI BackgroundTasks.
    """
    db = next(database.get_db())
    video = db.query(models.Video).filter(models.Video.id == video_id).first()
    if not video:
        return
    
    try:
        video.status = "processing"
        db.commit()

        # Step 1: Video Frame Extraction & Shot Segmentation (Audio)
        audio_data = extract_audio_from_video(video.filepath)
        shot_times = []
        if audio_data is not None:
            shot_times = detect_gunshot_onset(audio_data)
            
        if not shot_times:
            # Fallback if no audio spikes detected
            video.status = "error_no_shots"
            db.commit()
            return
            
        # Extract frames before the shot
        shot_frames = extract_shot_frames(video.filepath, shot_times)
        
        # Step 2: Initialize Roboflow
        rf_key = os.getenv("ROBOFLOW_API_KEY", "dummy_key")
        detector = RoboflowDetector(api_key=rf_key, project_name="clay-tracker", version=1)
        # detector.initialize() # Skip actual initialization if dummy key for MVP
        
        # Step 3 & 4: Process each shot
        for frame_data in shot_frames:
            # detection = detector.detect(frame_data['frame_data'])
            # best_clay = detector.get_best_clay_target(detection, width, height)
            
            # Dummy logic until real API key is inserted for MVP
            width = frame_data['frame_data'].shape[1]
            height = frame_data['frame_data'].shape[0]
            
            # Create Shot DB record
            new_shot = models.Shot(
                video_id=video_id,
                frame_start=frame_data['frame_num'],
                frame_end=frame_data['frame_num'] + 30, # dummy range
                break_label="break", # dummy classification
                station="Unknown",
                presentation="Unknown",
                confidence=0.9
            )
            db.add(new_shot)
            db.commit()
            db.refresh(new_shot)
            
            # Compute offset (Dummy values for now without real RF response)
            X_offset, Y_offset = 2.5, 1.2
            
            new_measurement = models.ShotMeasurement(
                shot_id=new_shot.id,
                crosshair_x=width/2,
                crosshair_y=height/2,
                clay_x=(width/2) + 50,
                clay_y=(height/2) - 20,
                normalized_x=X_offset,
                normalized_y=Y_offset
            )
            db.add(new_measurement)
            db.commit()
        
        video.status = "done"
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Error processing video {video_id}: {e}")
        video.status = "error"
        db.commit()
    finally:
        db.close()
