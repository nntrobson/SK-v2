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

DATE_LABELS = {
    "20240526": ("May 26, 2024", datetime.datetime(2024, 5, 26)),
    "20240608": ("June 8, 2024", datetime.datetime(2024, 6, 8)),
    "20240609": ("June 9, 2024", datetime.datetime(2024, 6, 9)),
    "20240623": ("June 23, 2024", datetime.datetime(2024, 6, 23)),
    "20240817": ("August 17, 2024", datetime.datetime(2024, 8, 17)),
}


def _get_or_create_session_and_round(db, date_prefix: str):
    label, session_date = DATE_LABELS.get(date_prefix, (f"Session {date_prefix}", datetime.datetime.strptime(date_prefix, "%Y%m%d")))
    session = db.query(models.Session).filter(models.Session.date == session_date).first()
    if not session:
        session = models.Session(date=session_date, metadata_json={"venue": "Silver Dollar Club", "notes": label})
        db.add(session)
        db.commit()
        db.refresh(session)
    round_entry = db.query(models.Round).filter(models.Round.session_id == session.id).first()
    if not round_entry:
        round_entry = models.Round(session_id=session.id, type="Trap Singles")
        db.add(round_entry)
        db.commit()
        db.refresh(round_entry)
    return session, round_entry


def main() -> int:
    db = SessionLocal()

    all_files = sorted(f for f in os.listdir(VIDEO_DIR) if f.upper().endswith(".MP4"))
    total = len(all_files)
    print(f"Found {total} videos in {VIDEO_DIR}")

    for idx, filename in enumerate(all_files, start=1):
        filepath = str(VIDEO_DIR / filename)
        date_prefix = filename[:8]
        _, round_entry = _get_or_create_session_and_round(db, date_prefix)
        if not os.path.exists(filepath):
            print(f"[{idx}/{total}] MISSING: {filename}")
            continue

        existing = db.query(models.Video).filter(models.Video.filepath == filepath).first()
        if existing:
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

        print(f"[{idx}/{total}] Processing {filename} (video_id={video.id})")
        try:
            analysis = analyze_video_file(filepath, frame_stride=15)

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
            print(f"[{idx}/{total}] Done: station={analysis['station']} break={analysis['break_label']}")
        except Exception as exc:
            print(f"[{idx}/{total}] FAILED: {exc}")
            video.status = "error"
            db.commit()

    db.close()
    print("All done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
