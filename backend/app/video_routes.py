import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from app import models, database, auth
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from cv_pipeline import worker

router = APIRouter(prefix="/videos", tags=["videos"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload")
def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    round_id: int = Form(...),
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(database.get_db)
):
    db_round = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not db_round:
        raise HTTPException(status_code=404, detail="Round not found")

    file_extension = file.filename.split(".")[-1] if "." in file.filename else "mp4"
    
    new_video = models.Video(round_id=round_id, filepath="", status="uploading")
    db.add(new_video)
    db.commit()
    db.refresh(new_video)
    
    filepath = os.path.join(UPLOAD_DIR, f"video_{new_video.id}.{file_extension}")
    try:
        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        db.delete(new_video)
        db.commit()
        raise HTTPException(status_code=500, detail="Failed to save video")
        
    new_video.filepath = filepath
    new_video.status = "uploaded"
    db.commit()
    db.refresh(new_video)
    
    background_tasks.add_task(worker.process_video_task, new_video.id)
    
    return {"id": new_video.id, "filepath": new_video.filepath, "status": new_video.status}

@router.get("/")
def list_videos(round_id: int = None, current_user: models.User = Depends(auth.get_current_user), db: Session = Depends(database.get_db)):
    query = db.query(models.Video)
    if round_id:
        query = query.filter(models.Video.round_id == round_id)
    return query.all()
