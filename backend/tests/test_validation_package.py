import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cv_pipeline.validation_package import (  # type: ignore
    choose_balanced_video_rows,
    select_validation_frames,
)


def test_choose_balanced_video_rows_spreads_selection_across_positions():
    rows = []
    for idx in range(6):
        rows.append({"Filename": f"left_{idx}.MP4", "Position": "Trap-house-1-2"})
        rows.append({"Filename": f"middle_{idx}.MP4", "Position": "Trap-house"})
        rows.append({"Filename": f"right_{idx}.MP4", "Position": "Trap-house-4-5"})

    selected = choose_balanced_video_rows(rows, sample_size=10)

    assert len(selected) == 10
    selected_positions = [row["Position"] for row in selected]
    assert selected_positions.count("Trap-house-1-2") >= 3
    assert selected_positions.count("Trap-house") >= 3
    assert selected_positions.count("Trap-house-4-5") >= 3


def test_select_validation_frames_includes_required_milestones_and_spread():
    frames = [
        {
            "frame_idx": frame_idx,
            "time": frame_idx / 60.0,
            "overlay_boxes": [{"class_name": "clay-targets", "confidence": 0.8}],
        }
        for frame_idx in range(0, 180, 6)
    ]

    selected = select_validation_frames(
        frames=frames,
        desired_count=18,
        trigger_time=1.2,
        pretrigger_time=1.0,
        decision_time=1.45,
        first_trap_house_time=0.3,
    )

    assert 15 <= len(selected) <= 20
    tags = {item["label"]: item["frame_idx"] for item in selected}
    assert "first_trap_house" in tags
    assert "pretrigger" in tags
    assert "decision_frame" in tags
    assert "trigger" in tags
    assert min(item["frame_idx"] for item in selected) == 0
    assert max(item["frame_idx"] for item in selected) == 174
