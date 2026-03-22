from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cv_pipeline.pipeline import analyze_video_file
from cv_pipeline.validation_package import (
    choose_balanced_video_rows,
    write_validation_package,
)

DEFAULT_CSV_PATH = Path("/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/shots_data.csv")
DEFAULT_VIDEO_DIR = Path("/Users/Nick_Robson/Library/CloudStorage/OneDrive-McKinsey&Company/Documents/Cursor/Shotkam/data/uploaded_videos")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate ShotKam CV validation packages.")
    parser.add_argument("--csv-path", type=Path, default=DEFAULT_CSV_PATH)
    parser.add_argument("--video-dir", type=Path, default=DEFAULT_VIDEO_DIR)
    parser.add_argument("--output-root", type=Path, default=ROOT / "validation_packages")
    parser.add_argument("--sample-size", type=int, default=10)
    parser.add_argument("--screenshot-count", type=int, default=18)
    parser.add_argument("--frame-stride", type=int, default=None)
    parser.add_argument("--api-key", default=os.getenv("ROBOFLOW_API_KEY"))
    parser.add_argument("--project-name", default=os.getenv("ROBOFLOW_PROJECT", "claytargets-id"))
    parser.add_argument("--version", default=os.getenv("ROBOFLOW_VERSION", "19"))
    parser.add_argument("--filenames", nargs="*", default=None)
    return parser.parse_args()


def load_csv_rows(csv_path: Path) -> list[dict]:
    with csv_path.open() as handle:
        return list(csv.DictReader(handle))


def resolve_video_rows(rows: list[dict], video_dir: Path, filenames: list[str] | None, sample_size: int) -> list[dict]:
    if filenames:
        wanted = {name.strip() for name in filenames}
        return [row for row in rows if (row.get("Filename") or "").strip() in wanted]
    return choose_balanced_video_rows(rows, sample_size=sample_size)


def main() -> int:
    args = parse_args()
    run_dir = args.output_root / f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir.mkdir(parents=True, exist_ok=True)

    rows = load_csv_rows(args.csv_path)
    selected_rows = resolve_video_rows(rows, args.video_dir, args.filenames, args.sample_size)

    if not selected_rows:
        print("No matching video rows found.")
        return 1

    summary_rows = []
    for index, row in enumerate(selected_rows, start=1):
        filename = (row.get("Filename") or "").strip()
        video_path = args.video_dir / filename
        if not video_path.exists():
            print(f"[{index}/{len(selected_rows)}] Missing video: {video_path}")
            summary_rows.append(
                {
                    "filename": filename,
                    "status": "missing",
                    "validation_status": "",
                    "package_dir": "",
                    "station": "",
                    "break_label": "",
                    "pretrigger_time_ms": "",
                }
            )
            continue

        import tempfile
        cache_dir = tempfile.mkdtemp(prefix=f"shotcache_{Path(filename).stem}_")
        print(f"[{index}/{len(selected_rows)}] Processing {filename}")
        try:
            analysis = analyze_video_file(
                str(video_path),
                api_key=args.api_key,
                project_name=args.project_name,
                version=args.version,
                frame_stride=args.frame_stride,
                cache_frames_dir=cache_dir,
            )
            package_dir = write_validation_package(
                analysis=analysis,
                output_root=run_dir,
                screenshot_count=args.screenshot_count,
            )
            validation_status = "pass"
            vr_path = package_dir / "validation_results.json"
            if vr_path.exists():
                vr = json.loads(vr_path.read_text())
                validation_status = vr.get("status", "unknown")
            print(f"[{index}/{len(selected_rows)}] Package ready: {package_dir} [{validation_status.upper()}]")
            summary_rows.append(
                {
                    "filename": filename,
                    "status": "ok",
                    "validation_status": validation_status,
                    "package_dir": str(package_dir),
                    "station": analysis["station"],
                    "break_label": analysis["break_label"],
                    "pretrigger_time_ms": int(round(float(analysis["pretrigger_summary"].get("pretrigger_time") or 0.0) * 1000)),
                }
            )
        except Exception as exc:
            print(f"[{index}/{len(selected_rows)}] Failed {filename}: {exc}")
            summary_rows.append(
                {
                    "filename": filename,
                    "status": "error",
                    "validation_status": "",
                    "package_dir": "",
                    "station": "",
                    "break_label": "",
                    "pretrigger_time_ms": "",
                }
            )

    summary_path = run_dir / "batch_summary.csv"
    with summary_path.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["filename", "status", "validation_status", "package_dir", "station", "break_label", "pretrigger_time_ms"],
        )
        writer.writeheader()
        writer.writerows(summary_rows)

    manifest_path = run_dir / "batch_manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "run_dir": str(run_dir),
                "sample_size": len(selected_rows),
                "summary_csv": str(summary_path),
                "packages": summary_rows,
            },
            indent=2,
        )
    )

    print(f"Validation packages written to: {run_dir}")
    print(f"Batch summary: {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
