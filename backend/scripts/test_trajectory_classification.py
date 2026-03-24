import os
import sys
import glob
import csv
import pickle
from pathlib import Path

# Add backend dir to python path to import our modules
backend_dir = Path(__file__).parent.parent
sys.path.append(str(backend_dir))

from cv_pipeline.pipeline import analyze_video_file, classify_presentation
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def save_plots(plots, output_dir, count_by_station):
    """Save current state of all plots."""
    for station, (fig, ax) in plots.items():
        # Clear any existing reference lines (we'll re-add them)
        # Save current lines
        lines = ax.get_lines()
        
        # Create a temporary copy for saving
        fig_temp, ax_temp = plt.subplots(figsize=(12, 10))
        
        # Copy all trajectory lines
        for line in lines:
            ax_temp.plot(line.get_xdata(), line.get_ydata(), 
                        color=line.get_color(), alpha=line.get_alpha(), 
                        linewidth=line.get_linewidth())
        
        # Add reference lines
        ax_temp.axvline(x=0, color='k', linestyle='--', alpha=0.5, label='Center (0)')
        ax_temp.axvline(x=-1.5, color='cyan', linestyle=':', alpha=0.5, label='Mod Left (-1.5)')
        ax_temp.axvline(x=-4.0, color='blue', linestyle=':', alpha=0.5, label='Hard Left (-4.0)')
        ax_temp.axvline(x=1.5, color='orange', linestyle=':', alpha=0.5, label='Mod Right (1.5)')
        ax_temp.axvline(x=4.0, color='red', linestyle=':', alpha=0.5, label='Hard Right (4.0)')
        
        count = count_by_station.get(station, 0)
        ax_temp.set_title(f"Aggregated Normalized Trajectories - {station} ({count} shots)")
        ax_temp.set_xlabel("Normalized X Offset (Inches / Pixels)")
        ax_temp.set_ylabel("Y Offset")
        ax_temp.grid(True, alpha=0.2)
        
        # Legend
        handles, labels = ax_temp.get_legend_handles_labels()
        by_label = dict(zip(labels, handles))
        ax_temp.legend(by_label.values(), by_label.keys())
        
        plot_path = output_dir / f"aggregated_trajectories_{station}.png"
        fig_temp.savefig(plot_path, dpi=150)
        plt.close(fig_temp)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Test trajectory classification mathematically and visually.")
    parser.add_argument("--videos-dir", type=str, default="/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/uploaded_videos", help="Directory containing test videos")
    parser.add_argument("--sample-size", type=int, default=None, help="Number of videos to sample (None = all)")
    parser.add_argument("--use-cache", action="store_true", default=True, help="Use cached analysis if available")
    args = parser.parse_args()

    videos_dir = Path(args.videos_dir)
    output_dir = backend_dir / "validation_output"
    output_dir.mkdir(exist_ok=True)
    
    # CSV setup - write header immediately
    csv_path = output_dir / "trajectory_coordinates.csv"
    fieldnames = ["video_name", "station", "raw_delta_x", "stabilized_delta_x", "stabilized_delta_y", 
                  "normalized_delta_x", "predicted_class", "actual_class", "num_trajectory_points",
                  "trajectory_x_coords", "trajectory_y_coords", "normalized_x_coords"]
    
    # Write CSV header
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
    
    print(f"Looking for videos in {videos_dir}...", flush=True)
    print(f"CSV will be written incrementally to: {csv_path}", flush=True)
    
    video_files = glob.glob(str(videos_dir / "*.MP4")) + glob.glob(str(videos_dir / "*.mp4")) + glob.glob(str(videos_dir / "*.MOV")) + glob.glob(str(videos_dir / "*.mov"))
    
    # Remove duplicates
    video_files = list(set(video_files))
    video_files.sort()
    
    if args.sample_size:
        import random
        random.shuffle(video_files)
        video_files = video_files[:args.sample_size]
    
    print(f"Found {len(video_files)} videos. Processing all of them...", flush=True)
    print("-" * 130, flush=True)
    print(f"{'Video':<35} | {'Station':<15} | {'Raw DeltaX':>10} | {'Stabilized DeltaX':>16} | {'Normalized DeltaX':>17} | {'Final Class'}", flush=True)
    print("-" * 130, flush=True)
    
    # We will accumulate trajectories into separate plots per station
    plots = {
        "trap-house-1-2": plt.subplots(figsize=(12, 10)),
        "trap-house": plt.subplots(figsize=(12, 10)),
        "trap-house-4-5": plt.subplots(figsize=(12, 10)),
        "unknown": plt.subplots(figsize=(12, 10)),
    }
    
    # Track counts per station
    count_by_station = {"trap-house-1-2": 0, "trap-house": 0, "trap-house-4-5": 0, "unknown": 0}
    processed_count = 0
    
    for idx, v in enumerate(video_files):
        try:
            video_name = os.path.basename(v)
            print(f"[{idx+1}/{len(video_files)}] Processing {video_name}...", flush=True)
            
            cache_file = output_dir / f"{video_name}.pkl"
            if args.use_cache and cache_file.exists():
                with open(cache_file, "rb") as f:
                    analysis = pickle.load(f)
            else:
                analysis = analyze_video_file(v, frame_stride=5)
                try:
                    with open(cache_file, "wb") as f:
                        pickle.dump(analysis, f)
                except Exception as e:
                    print(f"  Failed to cache {video_name}: {e}", flush=True)
            
            station = analysis["station"]
            trajectory = analysis["pretrigger_summary"]["trajectory"]
            tracking_data = analysis["pretrigger_summary"]["tracking_data"]
            
            if not trajectory or len(trajectory) < 2:
                print(f"  [{video_name}] SKIPPED: Not enough trajectory data.", flush=True)
                continue
            
            # Calculate deltas
            raw_delta_x = tracking_data[-1]["pixel_dx"] - tracking_data[0]["pixel_dx"]
            stabilized_delta_x = trajectory[-1]["x"] - trajectory[0]["x"]
            stabilized_delta_y = trajectory[-1]["y"] - trajectory[0]["y"]
            
            normalized_delta_x = stabilized_delta_x
            if station == "trap-house-1-2":
                normalized_delta_x -= 3.5
            elif station == "trap-house-4-5":
                normalized_delta_x += 3.5
                
            final_class = classify_presentation(trajectory, station)
            
            # Create normalized trajectory points
            norm_xs = []
            stab_xs = [pt["x"] for pt in trajectory]
            stab_ys = [pt["y"] for pt in trajectory]
            for pt in trajectory:
                nx = pt["x"]
                if station == "trap-house-1-2":
                    nx -= 3.5
                elif station == "trap-house-4-5":
                    nx += 3.5
                norm_xs.append(nx)
            
            # Write row to CSV immediately (append mode)
            csv_row = {
                "video_name": video_name,
                "station": station,
                "raw_delta_x": round(raw_delta_x, 2),
                "stabilized_delta_x": round(stabilized_delta_x, 2),
                "stabilized_delta_y": round(stabilized_delta_y, 2),
                "normalized_delta_x": round(normalized_delta_x, 2),
                "predicted_class": final_class,
                "actual_class": "",  # For user to fill in
                "num_trajectory_points": len(trajectory),
                "trajectory_x_coords": ";".join([f"{x:.2f}" for x in stab_xs]),
                "trajectory_y_coords": ";".join([f"{y:.2f}" for y in stab_ys]),
                "normalized_x_coords": ";".join([f"{x:.2f}" for x in norm_xs]),
            }
            
            with open(csv_path, "a", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writerow(csv_row)
            
            # Plot this specific line on the specific station overlay
            color = 'gray'
            if final_class == "hard_left": color = 'blue'
            elif final_class == "moderate_left": color = 'cyan'
            elif final_class == "straight": color = 'green'
            elif final_class == "moderate_right": color = 'orange'
            elif final_class == "hard_right": color = 'red'
            
            fig, ax = plots[station]
            ax.plot(norm_xs, stab_ys, color=color, alpha=0.6, linewidth=2)
            count_by_station[station] += 1
            processed_count += 1
            
            print(f"{video_name:<35} | {station:<15} | {raw_delta_x:>10.2f} | {stabilized_delta_x:>16.2f} | {normalized_delta_x:>17.2f} | {final_class}", flush=True)
            
            # Save plots every 10 videos
            if processed_count % 10 == 0:
                print(f"  [Saving plots... {processed_count} videos processed]", flush=True)
                save_plots(plots, output_dir, count_by_station)
                
        except Exception as e:
            print(f"  [{os.path.basename(v)}] ERROR: {e}", flush=True)
            import traceback
            traceback.print_exc()
    
    # Final save of plots
    print(f"\nSaving final plots...", flush=True)
    save_plots(plots, output_dir, count_by_station)
    
    # Close the original figures
    for station, (fig, ax) in plots.items():
        plt.close(fig)
    
    print(f"\n=== COMPLETE ===", flush=True)
    print(f"Processed {processed_count} videos successfully.", flush=True)
    print(f"CSV with trajectory coordinates: {csv_path}", flush=True)
    print(f"Plots saved to: {output_dir}/aggregated_trajectories_*.png", flush=True)

if __name__ == "__main__":
    main()
