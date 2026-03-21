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
        for r in rounds:
            videos = db.query(models.Video).filter(models.Video.round_id == r.id).all()
            for v in videos:
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
            "total": total_shots
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
                    "video_path": v.filepath
                })
    return res
