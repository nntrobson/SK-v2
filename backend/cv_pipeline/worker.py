import datetime
import logging
import tempfile
import time
from pathlib import Path

from app import database, models
from cv_pipeline.pipeline import analyze_video_file
from cv_pipeline.validation_package import generate_dashboard_video

logger = logging.getLogger(__name__)


def _throttled_progress_reporter(db, video_id: int):
    """Limit DB writes (Roboflow loop is slow; still throttle noisy callbacks)."""
    last: list = [None, -1.0]  # time, last progress

    def report(p: float, stage: str) -> None:
        now = time.time()
        if (
            last[0] is not None
            and now - last[0] < 1.25
            and p - last[1] < 0.015
            and p < 0.99
        ):
            return
        last[0] = now
        last[1] = p
        v = db.query(models.Video).filter(models.Video.id == video_id).first()
        if not v:
            return
        v.processing_progress = min(1.0, max(0.0, p))
        v.processing_stage = stage
        db.commit()

    return report


def _generate_dashboard_assets(analysis: dict, video_filepath: str) -> None:
    """Generate H.264 overlay video + pretrigger snapshot next to the uploaded video."""
    video_path = Path(video_filepath)
    review_path = video_path.parent / f"{video_path.stem}_review.mp4"
    snapshot_path = video_path.parent / f"{video_path.stem}_pretrigger.jpg"
    try:
        generate_dashboard_video(analysis, review_path, snapshot_path)
    except Exception as exc:
        logger.warning("Dashboard asset generation failed: %s", exc)


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
        video.processing_progress = 0.0
        video.processing_stage = "Starting pipeline"
        video.processing_started_at = datetime.datetime.utcnow()
        db.commit()

        report = _throttled_progress_reporter(db, video_id)

        cache_dir = tempfile.mkdtemp(prefix=f"shotcache_{video_id}_")
        try:
            analysis = analyze_video_file(
                video.filepath,
                cache_frames_dir=cache_dir,
                progress_callback=report,
            )
        except ValueError:
            video.status = "error_no_shots"
            video.processing_progress = None
            video.processing_stage = None
            video.processing_started_at = None
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

        report(0.92, "Rendering preview video")
        _generate_dashboard_assets(analysis, video.filepath)

        video.status = "completed"
        video.processing_progress = None
        video.processing_stage = None
        video.processing_started_at = None
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Error processing video %s: %s", video_id, e)
        video = db.query(models.Video).filter(models.Video.id == video_id).first()
        if video:
            video.status = "error"
            video.processing_progress = None
            video.processing_stage = None
            video.processing_started_at = None
            db.commit()
    finally:
        db.close()
