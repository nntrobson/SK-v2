import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cv_pipeline.analysis import (  # type: ignore
    aggregate_station_label,
    build_overlay_timeline,
    build_pretrigger_track,
    classify_break_state,
    format_overlay_boxes,
    sample_validation_frames,
)


def test_format_overlay_boxes_keeps_best_trap_house_and_thresholded_targets():
    predictions = [
        {"class": "trap-house", "confidence": 0.72, "x": 100, "y": 200, "width": 40, "height": 20},
        {"class": "trap-house", "confidence": 0.61, "x": 95, "y": 195, "width": 44, "height": 24},
        {"class": "Clay-targets", "confidence": 0.65, "x": 300, "y": 120, "width": 22, "height": 18},
        {"class": "Broken-Clay", "confidence": 0.59, "x": 312, "y": 125, "width": 28, "height": 20},
        {"class": "Broken-Clay", "confidence": 0.83, "x": 315, "y": 126, "width": 29, "height": 21},
    ]

    boxes = format_overlay_boxes(predictions, class_thresholds={"Clay-targets": 0.6, "Broken-Clay": 0.6})

    assert [box["class_name"] for box in boxes] == ["trap-house", "clay-targets", "broken-clay"]
    assert boxes[0]["confidence"] == 0.72
    assert boxes[2]["confidence"] == 0.83


def test_aggregate_station_label_prefers_highest_combined_trap_house_evidence():
    frames = [
        {"overlay_boxes": [{"class_name": "trap-house-1-2", "confidence": 0.77}]},
        {"overlay_boxes": [{"class_name": "trap-house", "confidence": 0.88}]},
        {"overlay_boxes": [{"class_name": "trap-house", "confidence": 0.83}]},
    ]

    station, confidence = aggregate_station_label(frames)

    assert station == "trap-house"
    assert confidence == 1.0


def test_build_pretrigger_track_limits_points_to_before_trigger_and_computes_offsets():
    frames = [
        {
            "time": 0.10,
            "frame_idx": 6,
            "overlay_boxes": [{"class_name": "Clay-targets", "confidence": 0.72, "x": 620, "y": 340, "width": 44, "height": 40}],
        },
        {
            "time": 0.30,
            "frame_idx": 18,
            "overlay_boxes": [{"class_name": "Clay-targets", "confidence": 0.81, "x": 700, "y": 310, "width": 40, "height": 38}],
        },
        {
            "time": 0.55,
            "frame_idx": 33,
            "overlay_boxes": [{"class_name": "Clay-targets", "confidence": 0.91, "x": 760, "y": 290, "width": 38, "height": 36}],
        },
    ]

    summary = build_pretrigger_track(
        frames=frames,
        trigger_time=0.42,
        frame_width=1280,
        frame_height=720,
    )

    assert len(summary["tracking_data"]) == 2
    assert summary["pretrigger_time"] == 0.30
    assert summary["clay_x"] == 700
    assert summary["crosshair_x"] == 640
    assert summary["normalized_x"] > 0
    assert summary["normalized_y"] > 0
    assert summary["trajectory"][-1]["x"] == summary["normalized_x"]


def test_build_overlay_timeline_preserves_full_clip_boxes_and_primary_clay_fields():
    frames = [
        {
            "time": 0.10,
            "frame_idx": 6,
            "overlay_boxes": [
                {"class_name": "trap-house", "confidence": 0.72, "x": 120, "y": 210, "width": 40, "height": 24},
                {"class_name": "Clay-targets", "confidence": 0.75, "x": 620, "y": 340, "width": 44, "height": 40},
            ],
        },
        {
            "time": 0.55,
            "frame_idx": 33,
            "overlay_boxes": [
                {"class_name": "Broken-Clay", "confidence": 0.84, "x": 760, "y": 290, "width": 38, "height": 36},
            ],
        },
    ]

    timeline = build_overlay_timeline(frames=frames, frame_width=1280, frame_height=720)

    assert len(timeline) == 2
    assert timeline[0]["clay_x"] == 620
    assert timeline[0]["overlay_boxes"][0]["class_name"] == "trap-house"
    assert timeline[1]["class_name"] == "broken-clay"
    assert timeline[1]["bbox"]["width"] == 38


def test_classify_break_state_returns_unknown_when_signal_is_weak():
    frames = [
        {"time": 0.30, "overlay_boxes": [{"class_name": "Clay-targets", "confidence": 0.64, "x": 700, "y": 310, "width": 40, "height": 38}]},
        {"time": 0.48, "overlay_boxes": [{"class_name": "Broken-Clay", "confidence": 0.56, "x": 730, "y": 295, "width": 35, "height": 30}]},
    ]

    label, confidence = classify_break_state(frames=frames, trigger_time=0.42, break_threshold=0.7)

    assert label == "unknown"
    assert round(confidence, 2) == 0.56


def test_classify_break_state_returns_break_for_confident_broken_clay():
    frames = [
        {"time": 0.45, "overlay_boxes": [{"class_name": "Broken-Clay", "confidence": 0.82, "x": 730, "y": 295, "width": 35, "height": 30}]},
        {"time": 0.52, "overlay_boxes": [{"class_name": "Broken-Clay", "confidence": 0.87, "x": 745, "y": 288, "width": 34, "height": 28}]},
    ]

    label, confidence = classify_break_state(frames=frames, trigger_time=0.42, break_threshold=0.7)

    assert label == "break"
    assert confidence == 0.87


def test_sample_validation_frames_spreads_ten_samples_across_visible_flight_path():
    frames = [
        {"frame_idx": frame_idx, "time": frame_idx / 60.0, "overlay_boxes": [{"class_name": "Clay-targets", "confidence": 0.7, "x": 600, "y": 320, "width": 40, "height": 35}]}
        for frame_idx in range(5, 55)
    ]

    samples = sample_validation_frames(frames, sample_count=10)

    assert len(samples) == 10
    assert samples[0]["frame_idx"] == 5
    assert samples[-1]["frame_idx"] == 54
    assert len({sample["frame_idx"] for sample in samples}) == 10
