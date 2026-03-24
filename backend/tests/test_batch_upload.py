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
    db_path = tmp_path / "batch-upload-test.db"
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


def test_batch_upload_accepts_multiple_files_and_reuses_one_session_round(
    tmp_path: Path, monkeypatch
):
    monkeypatch.chdir(tmp_path)

    import cv_pipeline.worker as worker  # type: ignore

    queued_video_ids = []

    def fake_process_video_task(video_id: int):
        queued_video_ids.append(video_id)

    monkeypatch.setattr(worker, "process_video_task", fake_process_video_task)

    client, session_local, engine = _make_client(tmp_path)

    try:
        response = client.post(
            "/api/videos/upload-batch",
            files=[
                ("files", ("20240608125600SHOT0081.MP4", b"first-video", "video/mp4")),
                ("files", ("20240608125710SHOT0082.MOV", b"second-video", "video/quicktime")),
            ],
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "success"
        assert payload["count"] == 2
        assert len(payload["video_ids"]) == 2

        db = session_local()
        try:
            sessions = db.query(models.Session).all()
            rounds = db.query(models.Round).all()
            videos = db.query(models.Video).order_by(models.Video.id.asc()).all()

            assert len(sessions) == 1
            assert sessions[0].date.date() == datetime.datetime.now().date()
            assert len(rounds) == 1
            assert len(videos) == 2
            assert {video.id for video in videos} == set(payload["video_ids"])
            assert all(video.round_id == rounds[0].id for video in videos)
            assert all(video.status == "pending" for video in videos)
            assert "20240608125600SHOT0081.MP4" in Path(videos[0].filepath).name
            assert "20240608125710SHOT0082.MOV" in Path(videos[1].filepath).name
            assert (tmp_path / "uploads" / Path(videos[0].filepath).name).exists()
            assert (tmp_path / "uploads" / Path(videos[1].filepath).name).exists()
        finally:
            db.close()

        assert queued_video_ids == payload["video_ids"]
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
