"""Load pre-computed validation_output/*.pkl files into the ShotTracker database.

Groups videos by date (from filename), creates Session/Round/Video/Shot/
ShotMeasurement rows, and re-classifies presentation using the current
classify_presentation pipeline.

Usage:
    cd backend && source venv/bin/activate
    python scripts/load_validation_output.py [--clear]

    --clear   Wipe all existing sessions/rounds/videos/shots before loading.
"""
from __future__ import annotations

import datetime
import glob
import os
import pickle
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import SessionLocal, engine
from app import models
from cv_pipeline.pipeline import classify_presentation

VALIDATION_DIR = os.path.join(os.path.dirname(__file__), "..", "validation_output")


def load(clear: bool = False):
    models.Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if clear:
        print("Clearing existing data…")
        db.query(models.ShotMeasurement).delete()
        db.query(models.Correction).delete()
        db.query(models.Shot).delete()
        db.query(models.Video).delete()
        db.query(models.Round).delete()
        db.query(models.Session).delete()
        db.commit()

    pkl_files = sorted(glob.glob(os.path.join(VALIDATION_DIR, "*.pkl")))
    print(f"Found {len(pkl_files)} pkl files in {VALIDATION_DIR}")

    session_cache: dict[str, models.Session] = {}
    round_cache: dict[int, models.Round] = {}
    loaded = 0

    for pkl_path in pkl_files:
        filename = os.path.basename(pkl_path)
        date_str = filename[:8]
        video_path_original = None

        try:
            with open(pkl_path, "rb") as f:
                analysis = pickle.load(f)
        except Exception as e:
            print(f"  SKIP {filename}: {e}")
            continue

        video_path_original = analysis.get("video_path", pkl_path)

        already = db.query(models.Video).filter(
            models.Video.filepath == video_path_original
        ).first()
        if already:
            continue

        dt = datetime.datetime.strptime(date_str, "%Y%m%d")

        if date_str not in session_cache:
            session = db.query(models.Session).filter(models.Session.date == dt).first()
            if not session:
                session = models.Session(
                    date=dt,
                    metadata_json={"venue": "Silver Dollar Club", "notes": "Loaded from validation_output"},
                )
                db.add(session)
                db.commit()
                db.refresh(session)
            session_cache[date_str] = session

        session = session_cache[date_str]

        if session.id not in round_cache:
            rnd = db.query(models.Round).filter(models.Round.session_id == session.id).first()
            if not rnd:
                rnd = models.Round(session_id=session.id, type="Trap Singles")
                db.add(rnd)
                db.commit()
                db.refresh(rnd)
            round_cache[session.id] = rnd

        rnd = round_cache[session.id]

        video = models.Video(
            round_id=rnd.id,
            filepath=video_path_original,
            status="completed",
        )
        db.add(video)
        db.commit()
        db.refresh(video)

        pretrigger = analysis.get("pretrigger_summary", {})
        trajectory = pretrigger.get("trajectory", [])
        station = analysis.get("station", "unknown")

        presentation = classify_presentation(trajectory, station)

        shot = models.Shot(
            video_id=video.id,
            frame_start=0,
            frame_end=analysis.get("total_frames", 0),
            break_label=analysis.get("break_label", "unknown"),
            station=station,
            presentation=presentation,
            confidence=round(
                max(
                    analysis.get("station_confidence", 0),
                    analysis.get("break_confidence", 0),
                ),
                4,
            ),
        )
        db.add(shot)
        db.commit()
        db.refresh(shot)

        tracking_data = analysis.get("tracking_data")
        if isinstance(tracking_data, list) and tracking_data:
            for entry in tracking_data:
                if "transform_matrix" in entry:
                    del entry["transform_matrix"]

        meas = models.ShotMeasurement(
            shot_id=shot.id,
            crosshair_x=pretrigger.get("crosshair_x"),
            crosshair_y=pretrigger.get("crosshair_y"),
            clay_x=pretrigger.get("clay_x"),
            clay_y=pretrigger.get("clay_y"),
            normalized_x=_to_float(pretrigger.get("normalized_x")),
            normalized_y=_to_float(pretrigger.get("normalized_y")),
            trajectory=_sanitize_json(trajectory),
            tracking_data=_sanitize_json(tracking_data),
        )
        db.add(meas)
        db.commit()

        loaded += 1
        if loaded % 25 == 0:
            print(f"  Loaded {loaded}/{len(pkl_files)}…")

    db.close()
    print(f"Done. Loaded {loaded} new shots from {len(pkl_files)} pkl files.")


def _to_float(v):
    if v is None:
        return None
    return float(v)


def _sanitize_json(obj):
    """Convert numpy types to native Python for JSON storage."""
    import numpy as np

    if obj is None:
        return None
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {k: _sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_json(item) for item in obj]
    return obj


if __name__ == "__main__":
    clear = "--clear" in sys.argv
    load(clear=clear)
