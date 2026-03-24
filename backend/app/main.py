import os
from typing import Optional

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app import database, models
from app.shot_payloads import serialize_session_shot

app = FastAPI(title="ShotTracker API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/sessions")
def get_sessions(db: Session = Depends(database.get_db)):
    sessions = db.query(models.Session).all()
    res = []
    for s in sessions:
        rounds = db.query(models.Round).filter(models.Round.session_id == s.id).all()
        total_shots = 0
        hits = 0
        session_status = "completed"
        
        for r in rounds:
            videos = db.query(models.Video).filter(models.Video.round_id == r.id).all()
            for v in videos:
                if v.status in ["pending", "processing"]:
                    session_status = "processing"
                elif v.status == "error" and session_status != "processing":
                    session_status = "error"
                
                shots = db.query(models.Shot).filter(models.Shot.video_id == v.id).all()
                total_shots += len(shots)
                hits += sum(1 for shot in shots if shot.break_label == "break")
        
        # MOCK_SESSIONS expected format
        res.append({
            "id": s.id,
            "date": s.date.strftime("%b %d, %Y") if hasattr(s.date, "strftime") else str(s.date),
            "venue": s.metadata_json.get("venue", "Unknown") if s.metadata_json else "Unknown",
            "type": rounds[0].type if rounds else "Unknown",
            "score": hits,
            "total": total_shots,
            "status": session_status
        })
    return res

@app.get("/api/shots")
def get_all_shots(db: Session = Depends(database.get_db)):
    """All shots across all sessions with trajectory data for cross-session analysis."""
    shots = db.query(models.Shot).all()
    res = []
    for s in shots:
        meas = db.query(models.ShotMeasurement).filter(models.ShotMeasurement.shot_id == s.id).first()
        video = db.query(models.Video).filter(models.Video.id == s.video_id).first()
        if not meas or not video:
            continue
        res.append({
            "id": s.id,
            "video_name": os.path.basename(video.filepath),
            "station": getattr(s, "station", None),
            "presentation": (s.presentation or "straight").lower(),
            "break_label": s.break_label,
            "trajectory": meas.trajectory or [],
        })
    return res


@app.get("/api/sessions/{session_id}/shots")
def get_session_shots(session_id: int, db: Session = Depends(database.get_db)):
    rounds = db.query(models.Round).filter(models.Round.session_id == session_id).all()
    res = []
    for r in rounds:
        videos = db.query(models.Video).filter(models.Video.round_id == r.id).all()
        for v in videos:
            shots = db.query(models.Shot).filter(models.Shot.video_id == v.id).all()
            for s in shots:
                meas = db.query(models.ShotMeasurement).filter(models.ShotMeasurement.shot_id == s.id).first()
                res.append(serialize_session_shot(shot=s, measurement=meas, video=v))
    return res


class ShotClassificationUpdate(BaseModel):
    break_label: Optional[str] = None
    station: Optional[str] = None
    presentation: Optional[str] = None


@app.patch("/api/shots/{shot_id}")
def patch_shot_classification(shot_id: int, body: ShotClassificationUpdate, db: Session = Depends(database.get_db)):
    shot = db.query(models.Shot).filter(models.Shot.id == shot_id).first()
    if not shot:
        return Response(status_code=404)

    if body.break_label is not None:
        label = body.break_label.strip().lower()
        if label not in ("break", "miss", "unknown"):
            return Response(status_code=422)
        shot.break_label = label

    if body.station is not None:
        st = body.station.strip().lower()
        shot.station = st if st else None

    if body.presentation is not None:
        pres = body.presentation.strip().lower()
        shot.presentation = pres if pres else None

    db.commit()
    db.refresh(shot)

    video = db.query(models.Video).filter(models.Video.id == shot.video_id).first()
    if not video:
        return Response(status_code=404)
    meas = db.query(models.ShotMeasurement).filter(models.ShotMeasurement.shot_id == shot.id).first()
    return serialize_session_shot(shot=shot, measurement=meas, video=video)

import os
import cv2
import uuid
import shutil
import datetime
from fastapi import File, UploadFile, BackgroundTasks
from fastapi.responses import FileResponse, Response

@app.post("/api/videos/upload")
async def upload_video(
    background_tasks: BackgroundTasks, 
    file: UploadFile = File(...), 
    db: Session = Depends(database.get_db)
):
    # Save the file to disk
    os.makedirs("uploads", exist_ok=True)
    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    filepath = os.path.abspath(os.path.join("uploads", unique_filename))
    
    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Create DB Entries
    dt = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    session = db.query(models.Session).filter(models.Session.date == dt).first()
    if not session:
        session = models.Session(date=dt, metadata_json={"venue": "Silver Dollar Club (Upload)", "notes": "Manual UI Upload"})
        db.add(session)
        db.commit()
        db.refresh(session)
        
    round_entry = db.query(models.Round).filter(models.Round.session_id == session.id).first()
    if not round_entry:
        round_entry = models.Round(session_id=session.id, type="Trap Singles")
        db.add(round_entry)
        db.commit()
        db.refresh(round_entry)
        
    video = models.Video(round_id=round_entry.id, filepath=filepath, status="pending")
    db.add(video)
    db.commit()
    db.refresh(video)
    
    # Spawn background worker so the frontend isn't blocked mapping 400 inference requests
    from cv_pipeline.worker import process_video_task
    background_tasks.add_task(process_video_task, video.id)
    
    return {"status": "success", "video_id": video.id, "message": "Upload successful."}


@app.get("/api/sessions/{session_id}")
def get_session(session_id: int, db: Session = Depends(database.get_db)):
    s = db.query(models.Session).filter(models.Session.id == session_id).first()
    if not s:
        return Response(status_code=404)
        
    rounds = db.query(models.Round).filter(models.Round.session_id == s.id).all()
        
    return {
        "id": s.id,
        "date": s.date.strftime("%b %d, %Y") if hasattr(s.date, "strftime") else str(s.date),
        "venue": s.metadata_json.get("venue", "Unknown") if s.metadata_json else "Unknown",
        "type": rounds[0].type if rounds else "Unknown",
        "metadata": s.metadata_json
    }

class SessionUpdate(BaseModel):
    venue: Optional[str] = None
    date: Optional[str] = None
    type: Optional[str] = None

@app.put("/api/sessions/{session_id}")
def update_session(session_id: int, update_data: SessionUpdate, db: Session = Depends(database.get_db)):
    session = db.query(models.Session).filter(models.Session.id == session_id).first()
    if not session:
        return Response(status_code=404)
    
    if update_data.venue is not None:
        meta = session.metadata_json or {}
        meta["venue"] = update_data.venue
        session.metadata_json = meta
        # Required to trigger JSON update in some SQLAlchemy versions depending on how it's mapped
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(session, "metadata_json")
        
    if update_data.date is not None:
        try:
            # Try parsing the standard display format first
            parsed_date = datetime.datetime.strptime(update_data.date, "%b %d, %Y")
            session.date = parsed_date
        except ValueError:
            try:
                # Fallback to ISO format if needed
                parsed_date = datetime.datetime.strptime(update_data.date, "%Y-%m-%d")
                session.date = parsed_date
            except ValueError:
                pass # ignore if parsing fails
                
    if update_data.type is not None:
        round_entry = db.query(models.Round).filter(models.Round.session_id == session.id).first()
        if round_entry:
            round_entry.type = update_data.type
    
    db.commit()
    return {"status": "success"}

class VideoMove(BaseModel):
    session_id: Optional[int] = None
    new_event_name: Optional[str] = None

@app.put("/api/videos/{video_id}/move")
def move_video(video_id: int, move_data: VideoMove, db: Session = Depends(database.get_db)):
    video = db.query(models.Video).filter(models.Video.id == video_id).first()
    if not video:
        return Response(status_code=404)
        
    if move_data.new_event_name:
        # Create a new session
        dt = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        session = models.Session(date=dt, metadata_json={"venue": move_data.new_event_name, "notes": "Categorized"})
        db.add(session)
        db.commit()
        db.refresh(session)
        target_session_id = session.id
    elif move_data.session_id:
        target_session_id = move_data.session_id
    else:
        return Response(status_code=400)
        
    # Get or create a round in the target session
    round_entry = db.query(models.Round).filter(models.Round.session_id == target_session_id).first()
    if not round_entry:
        round_entry = models.Round(session_id=target_session_id, type="Trap Singles")
        db.add(round_entry)
        db.commit()
        db.refresh(round_entry)
        
    video.round_id = round_entry.id
    db.commit()
    
    return {"status": "success", "new_session_id": target_session_id}

import json as _json
from pathlib import Path as _Path
import tempfile as _tempfile

VALIDATION_PACKAGES_ROOT = _Path(__file__).resolve().parents[1] / "validation_packages"

@app.get("/api/validation/packages")
def list_validation_packages():
    if not VALIDATION_PACKAGES_ROOT.exists():
        return []
    runs = []
    for run_dir in sorted(VALIDATION_PACKAGES_ROOT.iterdir(), reverse=True):
        if not run_dir.is_dir() or not run_dir.name.startswith("run_"):
            continue
        manifest_path = run_dir / "batch_manifest.json"
        if manifest_path.exists():
            runs.append(_json.loads(manifest_path.read_text()))
        else:
            packages = []
            for pkg_dir in sorted(run_dir.iterdir()):
                pkg_manifest = pkg_dir / "manifest.json"
                if pkg_manifest.exists():
                    packages.append(_json.loads(pkg_manifest.read_text()))
            runs.append({"run_dir": str(run_dir), "packages": packages})
    return runs


@app.post("/api/validation/generate")
async def generate_validation_package(
    background_tasks: BackgroundTasks,
    video_id: int,
    db: Session = Depends(database.get_db),
):
    video = db.query(models.Video).filter(models.Video.id == video_id).first()
    if not video:
        return Response(status_code=404)
    if not os.path.exists(video.filepath):
        return Response(status_code=404)

    def _run_validation(filepath: str):
        from cv_pipeline.pipeline import analyze_video_file
        from cv_pipeline.validation_package import write_validation_package
        cache_dir = _tempfile.mkdtemp(prefix="shotcache_val_")
        try:
            analysis = analyze_video_file(filepath, frame_stride=5, cache_frames_dir=cache_dir)
            write_validation_package(analysis, output_root=VALIDATION_PACKAGES_ROOT)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Validation package generation failed")

    background_tasks.add_task(_run_validation, video.filepath)
    return {"status": "queued", "video_id": video_id}


@app.get("/api/validation/packages/{run_name}/{package_name}/screenshots")
def list_validation_screenshots(run_name: str, package_name: str):
    pkg_dir = VALIDATION_PACKAGES_ROOT / run_name / package_name / "screenshots"
    if not pkg_dir.exists():
        return []
    return sorted([f.name for f in pkg_dir.iterdir() if f.suffix in (".jpg", ".png")])


@app.get("/api/validation/packages/{run_name}/{package_name}/screenshots/{filename}")
def serve_validation_screenshot(run_name: str, package_name: str, filename: str):
    path = VALIDATION_PACKAGES_ROOT / run_name / package_name / "screenshots" / filename
    if path.exists() and path.suffix in (".jpg", ".png"):
        return FileResponse(str(path), media_type=f"image/{path.suffix[1:]}")
    return Response(status_code=404)


@app.get("/api/validation/packages/{run_name}/{package_name}/review-video")
def serve_validation_review_video(run_name: str, package_name: str):
    path = VALIDATION_PACKAGES_ROOT / run_name / package_name / "validation_review.mp4"
    if path.exists():
        return FileResponse(str(path), media_type="video/mp4")
    return Response(status_code=404)


@app.post("/api/videos/{video_id}/reprocess")
async def reprocess_video(
    video_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(database.get_db),
):
    video = db.query(models.Video).filter(models.Video.id == video_id).first()
    if not video:
        return Response(status_code=404)

    existing_shots = db.query(models.Shot).filter(models.Shot.video_id == video_id).all()
    for shot in existing_shots:
        db.query(models.ShotMeasurement).filter(models.ShotMeasurement.shot_id == shot.id).delete()
    db.query(models.Shot).filter(models.Shot.video_id == video_id).delete()
    video.status = "pending"
    db.commit()

    from cv_pipeline.worker import process_video_task
    background_tasks.add_task(process_video_task, video.id)
    return {"status": "queued", "video_id": video_id}


@app.post("/api/videos/reprocess-all")
async def reprocess_all_videos(
    background_tasks: BackgroundTasks,
    db: Session = Depends(database.get_db),
):
    videos = db.query(models.Video).all()
    queued = []
    for video in videos:
        if not os.path.exists(video.filepath):
            continue
        existing_shots = db.query(models.Shot).filter(models.Shot.video_id == video.id).all()
        for shot in existing_shots:
            db.query(models.ShotMeasurement).filter(models.ShotMeasurement.shot_id == shot.id).delete()
        db.query(models.Shot).filter(models.Shot.video_id == video.id).delete()
        video.status = "pending"
        db.commit()

        from cv_pipeline.worker import process_video_task
        background_tasks.add_task(process_video_task, video.id)
        queued.append(video.id)
    return {"status": "queued", "video_ids": queued}


@app.get("/api/videos/serve")
def serve_video(path: str):
    p = _Path(path)
    review = p.parent / f"{p.stem}_review.mp4"
    if review.exists():
        return FileResponse(str(review), media_type="video/mp4")
    if os.path.exists(path):
        return FileResponse(path, media_type="video/mp4")
    return Response(status_code=404)


@app.get("/api/videos/frame")
def serve_video_frame(path: str, time_ms: int = 1000, frame_idx: int = -1):
    p = _Path(path)
    snapshot = p.parent / f"{p.stem}_pretrigger.jpg"
    if snapshot.exists():
        return FileResponse(str(snapshot), media_type="image/jpeg")

    if not os.path.exists(path):
        return Response(status_code=404)

    cap = cv2.VideoCapture(path)

    if frame_idx >= 0:
        for i in range(frame_idx + 1):
            ret, frame = cap.read()
            if not ret:
                break
    else:
        cap.set(cv2.CAP_PROP_POS_MSEC, time_ms)
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = cap.read()

    cap.release()

    if ret:
        ok, buffer = cv2.imencode('.jpg', frame)
        if ok:
            return Response(content=buffer.tobytes(), media_type="image/jpeg")

    return Response(status_code=404)
