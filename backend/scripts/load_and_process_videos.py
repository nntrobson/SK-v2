from __future__ import annotations

import datetime
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import SessionLocal
from app import models
from cv_pipeline.pipeline import analyze_video_file

VIDEO_DIR = Path("/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/uploaded_videos")

VIDEOS = [
    "20240608122032SHOT0018.MP4",
    "20240608122050SHOT0019.MP4",
    "20240608123302SHOT0020.MP4",
    "20240608123346SHOT0021.MP4",
    "20240608123406SHOT0022.MP4",
    "20240608123424SHOT0023.MP4",
    "20240608123444SHOT0024.MP4",
    "20240608123502SHOT0025.MP4",
    "20240608123518SHOT0026.MP4",
    "20240608123540SHOT0027.MP4",
]


def main() -> int:
    db = SessionLocal()

    session_date = datetime.datetime(2024, 6, 8)
    session = db.query(models.Session).filter(models.Session.date == session_date).first()
    if not session:
        session = models.Session(
            date=session_date,
            metadata_json={"venue": "Silver Dollar Club", "notes": "June 8 2024 session"},
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    round_entry = db.query(models.Round).filter(models.Round.session_id == session.id).first()
    if not round_entry:
        round_entry = models.Round(session_id=session.id, type="Trap Singles")
        db.add(round_entry)
        db.commit()
        db.refresh(round_entry)

    for idx, filename in enumerate(VIDEOS, start=1):
        filepath = str(VIDEO_DIR / filename)
        if not os.path.exists(filepath):
            print(f"[{idx}/{len(VIDEOS)}] MISSING: {filename}")
            continue

        existing = db.query(models.Video).filter(models.Video.filepath == filepath).first()
        if existing:
            print(f"[{idx}/{len(VIDEOS)}] Already loaded: {filename} (video_id={existing.id})")
            for shot in db.query(models.Shot).filter(models.Shot.video_id == existing.id).all():
                db.query(models.ShotMeasurement).filter(models.ShotMeasurement.shot_id == shot.id).delete()
            db.query(models.Shot).filter(models.Shot.video_id == existing.id).delete()
            existing.status = "pending"
            db.commit()
            video = existing
        else:
            video = models.Video(round_id=round_entry.id, filepath=filepath, status="pending")
            db.add(video)
            db.commit()
            db.refresh(video)

        print(f"[{idx}/{len(VIDEOS)}] Processing {filename} (video_id={video.id})")
        try:
            analysis = analyze_video_file(filepath, frame_stride=15)

            for shot in db.query(models.Shot).filter(models.Shot.video_id == video.id).all():
                db.query(models.ShotMeasurement).filter(models.ShotMeasurement.shot_id == shot.id).delete()
            db.query(models.Shot).filter(models.Shot.video_id == video.id).delete()

            new_shot = models.Shot(
                video_id=video.id,
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

            ps = analysis["pretrigger_summary"]
            meas = models.ShotMeasurement(
                shot_id=new_shot.id,
                crosshair_x=ps["crosshair_x"],
                crosshair_y=ps["crosshair_y"],
                clay_x=ps["clay_x"],
                clay_y=ps["clay_y"],
                normalized_x=ps["normalized_x"],
                normalized_y=ps["normalized_y"],
                trajectory=ps["trajectory"],
                tracking_data=analysis["tracking_data"],
            )
            db.add(meas)
            video.status = "completed"
            db.commit()
            print(f"[{idx}/{len(VIDEOS)}] Done: station={analysis['station']} break={analysis['break_label']}")
        except Exception as exc:
            print(f"[{idx}/{len(VIDEOS)}] FAILED: {exc}")
            video.status = "error"
            db.commit()

    db.close()
    print("All done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
