import os
import sys
import cv2
import json

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal
from app import models

def verify_sync():
    db = SessionLocal()
    
    # Get the shot measurement that has tracking data
    measurement = db.query(models.ShotMeasurement).filter(models.ShotMeasurement.shot_id == 1).first()
    if not measurement:
        print("No measurement id=1 found")
        return
        
    tracking_data = measurement.tracking_data
    if not tracking_data:
        print("No tracking data in measurement 1")
        return
        
    shot = db.query(models.Shot).filter(models.Shot.id == measurement.shot_id).first()
    video = db.query(models.Video).filter(models.Video.id == shot.video_id).first()
    
    video_path = video.filepath
    if not os.path.exists(video_path):
        print(f"Video {video_path} not found")
        return
        
    print(f"Verifying {len(tracking_data)} tracked frames for {video_path}")
    
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 120.0
    
    artifact_dir = "/Users/Nick_Robson/.gemini/antigravity/brain/eff64865-b4de-4219-8d7d-5938c627261a"
    
    # Save the first 10 frames
    saved_frames = []
    for i, track in enumerate(tracking_data[:10]):
        time_sec = track['time']
        frame_idx = int(time_sec * fps)
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            print(f"Failed to read frame at {time_sec}s")
            continue
            
        cx = track['clay_x']
        cy = track['clay_y']
        w = track.get('width', 30)
        h = track.get('height', 20)
        conf = track.get('confidence', 0.9)
        name = track.get('class_name', 'Clay-targets')
        
        x1, y1 = int(cx - w/2), int(cy - h/2)
        x2, y2 = int(cx + w/2), int(cy + h/2)
        
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        label = f"{name} {conf:.2f}"
        cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
        
        out_path = os.path.join(artifact_dir, f"verification_frame_{i}.jpg")
        cv2.imwrite(out_path, frame)
        saved_frames.append(out_path)
        print(f"Saved {out_path}")
        
    cap.release()
    db.close()
    
    # generate markdown array of images
    markdown = "## Tracking Data Raw Frame Verification\n\n"
    for path in saved_frames:
        markdown += f"![Frame {os.path.basename(path)}]({path})\n\n"
        
    with open(os.path.join(artifact_dir, "verification.md"), "w") as f:
        f.write(markdown)
        
    print("Verification complete.")

if __name__ == "__main__":
    verify_sync()
