import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, JSON
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=True) # Optional for MVP just in case over OAuth
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    sessions = relationship("Session", back_populates="user")
    corrections = relationship("Correction", back_populates="user")

class Session(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    date = Column(DateTime, default=datetime.datetime.utcnow)
    metadata_json = Column(JSON, nullable=True) # gun, choke, notes, etc
    
    user = relationship("User", back_populates="sessions")
    rounds = relationship("Round", back_populates="session")

class Round(Base):
    __tablename__ = "rounds"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"))
    type = Column(String, default="trap_singles")
    score = Column(Integer, nullable=True)

    session = relationship("Session", back_populates="rounds")
    videos = relationship("Video", back_populates="round")

class Video(Base):
    __tablename__ = "videos"
    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("rounds.id"))
    filepath = Column(String, nullable=False)
    status = Column(String, default="uploaded") # processing, done, error
    processing_progress = Column(Float, nullable=True)  # 0.0–1.0 while processing
    processing_stage = Column(String, nullable=True)
    processing_started_at = Column(DateTime, nullable=True)

    round = relationship("Round", back_populates="videos")
    shots = relationship("Shot", back_populates="video")

class Shot(Base):
    __tablename__ = "shots"
    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"))
    frame_start = Column(Integer, nullable=True)
    frame_end = Column(Integer, nullable=True)
    break_label = Column(String, nullable=True) # "break", "miss"
    station = Column(String, nullable=True) # "post_1", "post_2"
    presentation = Column(String, nullable=True) # "hard_left", "straight", etc.
    confidence = Column(Float, nullable=True)

    video = relationship("Video", back_populates="shots")
    measurements = relationship("ShotMeasurement", back_populates="shot", uselist=False)
    corrections = relationship("Correction", back_populates="shot")

class ShotMeasurement(Base):
    __tablename__ = "shot_measurements"
    shot_id = Column(Integer, ForeignKey("shots.id"), primary_key=True)
    crosshair_x = Column(Float, nullable=True)
    crosshair_y = Column(Float, nullable=True)
    clay_x = Column(Float, nullable=True)
    clay_y = Column(Float, nullable=True)
    normalized_x = Column(Float, nullable=True)
    normalized_y = Column(Float, nullable=True)
    trajectory = Column(JSON, nullable=True)
    tracking_data = Column(JSON, nullable=True)

    shot = relationship("Shot", back_populates="measurements")

class Correction(Base):
    __tablename__ = "corrections"
    id = Column(Integer, primary_key=True, index=True)
    shot_id = Column(Integer, ForeignKey("shots.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    correction_type = Column(String) # "break_label", "station", "bounding_box"
    original_value = Column(String, nullable=True)
    corrected_value = Column(String, nullable=True)

    shot = relationship("Shot", back_populates="corrections")
    user = relationship("User", back_populates="corrections")
