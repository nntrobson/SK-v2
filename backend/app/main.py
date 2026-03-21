from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from app import database, models

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
                res.append({
                    "id": s.id,
                    "x": meas.normalized_x if meas else 0,
                    "y": meas.normalized_y if meas else 0,
                    "type": "hit" if s.break_label == "break" else "miss",
                    "presentation": s.presentation.lower() if s.presentation else "straight",
                    "trajectory": meas.trajectory if meas and meas.trajectory else [],
                    "video_path": v.filepath,
                    "clay_x": meas.clay_x if meas else 0,
                    "clay_y": meas.clay_y if meas else 0,
                    "crosshair_x": meas.crosshair_x if meas else 0,
                    "crosshair_y": meas.crosshair_y if meas else 0,
                    "tracking_data": meas.tracking_data if meas and meas.tracking_data else []
                })
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
    
    return {"status": "success", "video_id": video.id, "message": "Neural Uplink Initialized."}


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
