import logging

from app import database, models
from cv_pipeline.pipeline import analyze_video_file

logger = logging.getLogger(__name__)

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

        try:
            analysis = analyze_video_file(video.filepath)
        except ValueError:
            video.status = "error_no_shots"
            db.commit()
            return

        new_shot = models.Shot(
            video_id=video_id,
            frame_start=0,
            frame_end=analysis["total_frames"],
            break_label=analysis["break_label"],
            station=analysis["station"],
            presentation=analysis["presentation"],
            confidence=round(max(analysis["station_confidence"], analysis["break_confidence"]), 4),
        )
        db.add(new_shot)
        db.commit()
        db.refresh(new_shot)

        pretrigger_summary = analysis["pretrigger_summary"]
        new_measurement = models.ShotMeasurement(
            shot_id=new_shot.id,
            crosshair_x=pretrigger_summary["crosshair_x"],
            crosshair_y=pretrigger_summary["crosshair_y"],
            clay_x=pretrigger_summary["clay_x"],
            clay_y=pretrigger_summary["clay_y"],
            normalized_x=pretrigger_summary["normalized_x"],
            normalized_y=pretrigger_summary["normalized_y"],
            trajectory=pretrigger_summary["trajectory"],
            tracking_data=analysis["tracking_data"],
        )
        db.add(new_measurement)
        db.commit()

        video.status = "completed"
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Error processing video %s: %s", video_id, e)
        video.status = "error"
        db.commit()
    finally:
        db.close()
