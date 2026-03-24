import datetime
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import database, models  # type: ignore
from app.main import app  # type: ignore


def _make_client(tmp_path: Path):
    db_path = tmp_path / "delete-video-test.db"
    engine = create_engine(
        f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    testing_session_local = sessionmaker(
        autocommit=False, autoflush=False, bind=engine
    )
    models.Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[database.get_db] = override_get_db
    return TestClient(app), testing_session_local, engine


def _seed_video_graph(db, video_path: Path):
    session = models.Session(
        date=datetime.datetime(2026, 3, 24),
        metadata_json={"venue": "Delete Test Club"},
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    round_entry = models.Round(session_id=session.id, type="Trap Singles")
    db.add(round_entry)
    db.commit()
    db.refresh(round_entry)

    video = models.Video(
        round_id=round_entry.id,
        filepath=str(video_path),
        status="completed",
    )
    db.add(video)
    db.commit()
    db.refresh(video)

    shot = models.Shot(
        video_id=video.id,
        break_label="break",
        station="trap-house",
        presentation="straight",
        confidence=0.93,
    )
    db.add(shot)
    db.commit()
    db.refresh(shot)

    measurement = models.ShotMeasurement(
        shot_id=shot.id,
        crosshair_x=640,
        crosshair_y=360,
        clay_x=690,
        clay_y=320,
        normalized_x=1.2,
        normalized_y=-0.4,
        trajectory=[{"x": 0.6, "y": -0.2}, {"x": 1.2, "y": -0.4}],
        tracking_data=[],
    )
    correction = models.Correction(
        shot_id=shot.id,
        user_id=None,
        correction_type="break_label",
        original_value="miss",
        corrected_value="break",
    )
    db.add(measurement)
    db.add(correction)
    db.commit()

    return {
        "session_id": session.id,
        "round_id": round_entry.id,
        "video_id": video.id,
        "shot_id": shot.id,
    }


def test_delete_video_removes_assets_and_prunes_empty_session_tree(tmp_path: Path):
    client, session_local, engine = _make_client(tmp_path)
    video_path = tmp_path / "uploads" / "clip.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(b"video-bytes")
    review_path = video_path.parent / "clip_review.mp4"
    review_path.write_bytes(b"review-bytes")
    snapshot_path = video_path.parent / "clip_pretrigger.jpg"
    snapshot_path.write_bytes(b"snapshot-bytes")

    db = session_local()
    ids = _seed_video_graph(db, video_path)
    db.close()

    try:
        response = client.delete(f"/api/videos/{ids['video_id']}")

        assert response.status_code == 200

        verify_db = session_local()
        try:
            assert (
                verify_db.query(models.Video)
                .filter(models.Video.id == ids["video_id"])
                .first()
                is None
            )
            assert (
                verify_db.query(models.Shot)
                .filter(models.Shot.id == ids["shot_id"])
                .first()
                is None
            )
            assert (
                verify_db.query(models.ShotMeasurement)
                .filter(models.ShotMeasurement.shot_id == ids["shot_id"])
                .first()
                is None
            )
            assert (
                verify_db.query(models.Correction)
                .filter(models.Correction.shot_id == ids["shot_id"])
                .first()
                is None
            )
            assert (
                verify_db.query(models.Round)
                .filter(models.Round.id == ids["round_id"])
                .first()
                is None
            )
            assert (
                verify_db.query(models.Session)
                .filter(models.Session.id == ids["session_id"])
                .first()
                is None
            )
        finally:
            verify_db.close()

        assert not video_path.exists()
        assert not review_path.exists()
        assert not snapshot_path.exists()
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_delete_video_keeps_parent_records_when_other_videos_remain(tmp_path: Path):
    client, session_local, engine = _make_client(tmp_path)
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    first_video_path = uploads_dir / "first.mp4"
    first_video_path.write_bytes(b"first")
    second_video_path = uploads_dir / "second.mp4"
    second_video_path.write_bytes(b"second")

    db = session_local()
    ids = _seed_video_graph(db, first_video_path)

    second_video = models.Video(
        round_id=ids["round_id"],
        filepath=str(second_video_path),
        status="completed",
    )
    db.add(second_video)
    db.commit()
    db.refresh(second_video)
    db.close()

    try:
        response = client.delete(f"/api/videos/{ids['video_id']}")

        assert response.status_code == 200

        verify_db = session_local()
        try:
            assert (
                verify_db.query(models.Video)
                .filter(models.Video.id == second_video.id)
                .first()
                is not None
            )
            assert (
                verify_db.query(models.Round)
                .filter(models.Round.id == ids["round_id"])
                .first()
                is not None
            )
            assert (
                verify_db.query(models.Session)
                .filter(models.Session.id == ids["session_id"])
                .first()
                is not None
            )
        finally:
            verify_db.close()
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
