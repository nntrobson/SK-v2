import sys
import os
import cv2
from inference_sdk import InferenceHTTPClient
from dotenv import load_dotenv

load_dotenv()

def test_inference():
    video_path = "/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/uploaded_videos/20240817120613SHOT0022.MP4"
    
    if not os.path.exists(video_path):
        # find real video
        import glob
        video_files = glob.glob("/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/uploaded_videos/*.MP4")
        if not video_files:
            print("No video found")
            return
        video_path = video_files[0]
        
    print(f"Using video: {video_path}")
    
    cap = cv2.VideoCapture(video_path)
    # capture halfway
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Total frames: {total_frames}")
    
    cap.set(cv2.CAP_PROP_POS_FRAMES, total_frames // 2)
    
    CLIENT = InferenceHTTPClient(
        api_url="https://detect.roboflow.com",
        api_key=os.getenv("ROBOFLOW_API_KEY")
    )
    model_id = f"{os.getenv('ROBOFLOW_PROJECT')}/{os.getenv('ROBOFLOW_VERSION')}"
    print(f"Running inference on model: {model_id}")
    
    # scan subsequent frames until we find a target
    for frame_idx in range(total_frames // 3, total_frames - 30, 5):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret: continue
            
        cv2.imwrite("temp_frame.jpg", frame)
        result = CLIENT.infer("temp_frame.jpg", model_id=model_id)
        
        predictions = result.get("predictions", [])
        if predictions:
            print(f"Found predictions on frame {frame_idx}: {predictions}")
            for p in predictions:
                x, y, w, h = int(p["x"]), int(p["y"]), int(p["width"]), int(p["height"])
                x1, y1 = int(x - w/2), int(y - h/2)
                x2, y2 = int(x + w/2), int(y + h/2)
                
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                label = f"{p['class']} {p['confidence']:.2f}"
                cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                
            height, width, _ = frame.shape
            cv2.circle(frame, (width//2, height//2), 5, (0, 0, 255), -1)

            artifact_dir = "/Users/Nick_Robson/.gemini/antigravity/brain/eff64865-b4de-4219-8d7d-5938c627261a"
            out_path = os.path.join(artifact_dir, "inference_screenshot.jpg")
            cv2.imwrite(out_path, frame)
            print(f"Screenshot saved to {out_path}")
            break
    else:
        print("No predictions found in video")
    cap.release()

if __name__ == "__main__":
    test_inference()
