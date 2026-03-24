import logging
from pathlib import Path

from sqlalchemy.orm import Session

from app import models

logger = logging.getLogger(__name__)


def _related_video_asset_paths(filepath: str) -> list[Path]:
    if not filepath:
        return []
    video_path = Path(filepath)
    return [
        video_path,
        video_path.parent / f"{video_path.stem}_review.mp4",
        video_path.parent / f"{video_path.stem}_pretrigger.jpg",
    ]


def _delete_file_if_present(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except OSError as exc:
        logger.warning("Failed to delete video asset %s: %s", path, exc)


def delete_video_instance(db: Session, video: models.Video) -> dict:
    video_id = video.id
    round_id = video.round_id
    round_entry = (
        db.query(models.Round).filter(models.Round.id == round_id).first()
        if round_id is not None
        else None
    )
    session_id = round_entry.session_id if round_entry else None
    asset_paths = _related_video_asset_paths(video.filepath)

    shots = db.query(models.Shot).filter(models.Shot.video_id == video_id).all()
    shot_ids = [shot.id for shot in shots]

    if shot_ids:
        db.query(models.ShotMeasurement).filter(
            models.ShotMeasurement.shot_id.in_(shot_ids)
        ).delete(synchronize_session=False)
        db.query(models.Correction).filter(
            models.Correction.shot_id.in_(shot_ids)
        ).delete(synchronize_session=False)
        db.query(models.Shot).filter(models.Shot.id.in_(shot_ids)).delete(
            synchronize_session=False
        )

    db.delete(video)
    db.flush()

    deleted_round = False
    deleted_session = False

    if round_entry:
        round_has_videos = (
            db.query(models.Video).filter(models.Video.round_id == round_id).first()
            is not None
        )
        if not round_has_videos:
            db.delete(round_entry)
            deleted_round = True
            db.flush()

    if session_id is not None:
        session_has_rounds = (
            db.query(models.Round)
            .filter(models.Round.session_id == session_id)
            .first()
            is not None
        )
        if not session_has_rounds:
            session = (
                db.query(models.Session)
                .filter(models.Session.id == session_id)
                .first()
            )
            if session:
                db.delete(session)
                deleted_session = True

    db.commit()

    for path in asset_paths:
        _delete_file_if_present(path)

    return {
        "status": "deleted",
        "video_id": video_id,
        "round_deleted": deleted_round,
        "session_deleted": deleted_session,
        "deleted_shot_ids": shot_ids,
    }
