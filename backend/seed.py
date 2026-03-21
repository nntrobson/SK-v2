import os
import sys
import glob
from dotenv import load_dotenv

load_dotenv()

# Ensure backend directory is in the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal, engine
from app import models
from cv_pipeline.worker import process_video_task

def seed():
    # Make sure tables exist
    models.Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    files = glob.glob("/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/uploaded_videos/*.MP4")
    print(f"Found {len(files)} files to process.")
    
    count = 0
    for filepath in files:
        exists = db.query(models.Video).filter(models.Video.filepath == filepath).first()
        if exists:
            # print(f"Skipping {filepath}, already exists.")
            continue
            
        filename = os.path.basename(filepath)
        # 20240526141452SHOT0023.MP4 -> Date 2024-05-26
        date_str = filename[:8]
        date_formatted = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
        
        import datetime
        dt = datetime.datetime.strptime(date_formatted, "%Y-%m-%d")
        
        session = db.query(models.Session).filter(models.Session.date == dt).first()
        if not session:
            session = models.Session(date=dt, metadata_json={"venue": "Silver Dollar Club", "notes": "Auto-imported"})
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
        
        try:
            process_video_task(video.id)
            count += 1
            print(f"Processed {count} videos...")
            if count >= 2:
                print("Stopping early after 2 videos for MVP testing (Full Video Tracking).")
                break
        except Exception as e:
            print(f"Failed processing {filepath}: {e}")
            video.status = "error"
            db.commit()
            
    db.close()
    print(f"Seeding complete. Processed {count} new videos.")

if __name__ == "__main__":
    seed()
