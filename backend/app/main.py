from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
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

from pydantic import BaseModel

from typing import Optional

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

@app.get("/api/videos/serve")
def serve_video(path: str):
    if os.path.exists(path):
        return FileResponse(path, media_type="video/mp4")
    return Response(status_code=404)

@app.get("/api/videos/frame")
def serve_video_frame(path: str, time_ms: int = 1000):
    if not os.path.exists(path):
        return Response(status_code=404)
    # Get frame at specified time_ms
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_MSEC, time_ms)
    ret, frame = cap.read()
    if not ret:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ret, frame = cap.read()
    cap.release()
    
    if ret:
        ret, buffer = cv2.imencode('.jpg', frame)
        if ret:
            return Response(content=buffer.tobytes(), media_type="image/jpeg")
            
    return Response(status_code=404)
