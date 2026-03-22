import os
import cv2
import sys
import argparse
from inference_sdk import InferenceHTTPClient
import numpy as np
from dotenv import load_dotenv

sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from cv_pipeline.stabilizer import GlobalMotionStabilizer, TrajectoryVisualizer

import supervision as sv

def main(video_path: str, output_path: str):
    load_dotenv()
    
    api_key = os.getenv("ROBOFLOW_API_KEY")
    if not api_key:
        print("Please set ROBOFLOW_API_KEY in your environment.")
        return

    # 1. High-Sensitivity Detection using roboflow package
    from roboflow import Roboflow
    rf = Roboflow(api_key=api_key)
    project = rf.workspace().project("claytargets-id")
    model = project.version(19).model

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps < 1.0:
        fps = 60.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Try to find the gunshot to focus on the interesting part
    from cv_pipeline.processor import extract_audio_track, detect_gunshot_onset
    audio_data, sample_rate = extract_audio_track(video_path)
    shot_times = detect_gunshot_onset(audio_data, sample_rate=sample_rate or 44100) if audio_data is not None else []
    
    start_frame = 0
    end_frame = min(300, total_frames)
    
    if shot_times:
        trigger_time = shot_times[0]
        # Start 2 seconds before trigger, end 2 seconds after
        start_frame = max(0, int((trigger_time - 2.0) * fps))
        end_frame = min(total_frames, int((trigger_time + 2.0) * fps))
        print(f"Gunshot detected at {trigger_time:.2f}s. Processing frames {start_frame} to {end_frame}.")
    
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    frame_idx = start_frame

    # 3. Global Motion Stabilization Setup
    stabilizer = GlobalMotionStabilizer()
    visualizer = TrajectoryVisualizer(fps=int(fps))

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    print(f"Processing video: {video_path}")
    print(f"Output will be saved to: {output_path}")

    # For validation
    track_history = {}
    stabilized_points = []
    
    os.makedirs("backend/validation_output", exist_ok=True)

    while frame_idx <= end_frame:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Save to temp for inference
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            cv2.imwrite(tmp.name, frame)
            tmp_path = tmp.name

        try:
            # We set a very low confidence to catch everything (0.1)
            result = model.predict(tmp_path, confidence=0.1)
            # The result from roboflow SDK might be accessed via .json()
            predictions = result.json().get('predictions', [])
            if frame_idx % 10 == 0:
                print(f"Predictions at frame {frame_idx}: {len(predictions)}", flush=True)
        except Exception as e:
            print(f"Inference error at frame {frame_idx}: {e}")
            predictions = []
        finally:
            os.unlink(tmp_path)

        # ---------------------------
        # STABILIZED & FILTERED BRANCH
        # ---------------------------
        transform_matrix = stabilizer.process_frame(frame)
        stabilized_preds = stabilizer.stabilize_predictions(predictions, transform_matrix)
        
        # 4. Semantic Filtering & 5. Parallel Visualization (Handled in visualizer)
        filtered_frame, tracked_results = visualizer.process_and_annotate(frame, stabilized_preds, transform_matrix)
        
        # Validation: track IDs and points
        for tr in tracked_results:
            tid = tr["tracker_id"]
            if tid not in track_history:
                track_history[tid] = []
            track_history[tid].append((tr["x"], tr["y"]))
            
        if frame_idx in [150, 200, 250]:
            cv2.imwrite(f"backend/validation_output/frame_{frame_idx}.jpg", filtered_frame)
            
        # Write to video
        out.write(filtered_frame)
        
        frame_idx += 1
        if frame_idx % 10 == 0:
            print(f"Processed {frame_idx} frames...", flush=True)
            
        if frame_idx >= end_frame:
            print(f"Reached end frame {end_frame} for demo. Stopping.", flush=True)
            break

    cap.release()
    out.release()
    print("Done!")
    
    print("\n--- Validation Metrics ---")
    print(f"Total unique track IDs assigned: {len(track_history)}")
    for tid, points in track_history.items():
        print(f"Track ID {tid}: {len(points)} frames tracked")
        
    print("--------------------------")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Visualize Anchor-Based Trajectory Stabilization")
    parser.add_argument("--video", type=str, required=True, help="Path to input video")
    parser.add_argument("--output", type=str, default="stabilized_output.mp4", help="Path to output video")
    args = parser.parse_args()
    
    main(args.video, args.output)
