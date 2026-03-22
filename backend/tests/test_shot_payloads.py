import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.shot_payloads import serialize_session_shot  # type: ignore


def test_serialize_session_shot_exposes_overlay_and_unknown_break_state():
    shot = SimpleNamespace(
        id=17,
        break_label="unknown",
        presentation="hard_left",
        station="trap-house-4-5",
        confidence=0.78,
    )
    measurement = SimpleNamespace(
        normalized_x=1.25,
        normalized_y=-0.75,
        trajectory=[{"x": 0.4, "y": 0.2}, {"x": 1.25, "y": -0.75}],
        clay_x=712.0,
        clay_y=305.0,
        crosshair_x=640.0,
        crosshair_y=360.0,
        tracking_data=[
            {
                "time": 0.31,
                "frame_idx": 19,
                "clay_x": 712.0,
                "clay_y": 305.0,
                "crosshair_x": 640.0,
                "crosshair_y": 360.0,
                "bbox": {"x": 690.0, "y": 287.0, "width": 44.0, "height": 36.0},
                "overlay_boxes": [
                    {
                        "class_name": "clay-targets",
                        "confidence": 0.84,
                        "bbox": {"x": 690.0, "y": 287.0, "width": 44.0, "height": 36.0},
                    }
                ],
            }
        ],
    )
    video = SimpleNamespace(id=5, filepath="/tmp/example.mp4")

    payload = serialize_session_shot(shot=shot, measurement=measurement, video=video)

    assert payload["id"] == 17
    assert payload["type"] == "unknown"
    assert payload["break_label"] == "unknown"
    assert payload["station"] == "trap-house-4-5"
    assert payload["pretrigger_time"] == 0.31
    assert payload["pretrigger_boxes"][0]["class_name"] == "clay-targets"
    assert payload["tracking_data"][0]["bbox"]["width"] == 44.0
