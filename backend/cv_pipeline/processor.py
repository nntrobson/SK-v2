import cv2
import os
import tempfile
import numpy as np
import subprocess
from pathlib import Path
from scipy.ndimage import gaussian_filter1d
from scipy.io import wavfile
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

def extract_audio_track(video_path: str) -> Tuple[Optional[np.ndarray], int]:
    """Extract audio track as normalized float32 numpy array and sample rate."""
    try:
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            audio_path = tmp.name
        
        cmd = [
            'ffmpeg', '-i', str(video_path),
            '-vn', '-acodec', 'pcm_s16le',
            '-ar', '44100', '-ac', '1', '-y', audio_path
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            Path(audio_path).unlink(missing_ok=True)
            return None, 0
            
        sample_rate, audio_data = wavfile.read(audio_path)
        Path(audio_path).unlink()
        
        if audio_data.dtype == np.int16:
            audio_normalized = audio_data.astype(np.float32) / 32768.0
        else:
            audio_normalized = audio_data.astype(np.float32)
        return audio_normalized, int(sample_rate)
    except Exception as e:
        logger.error(f"Audio extraction failed: {e}")
        return None, 0

def extract_audio_from_video(video_path: str) -> np.ndarray:
    """Extract audio track as normalized float32 numpy array."""
    audio_data, _sample_rate = extract_audio_track(video_path)
    return audio_data

def detect_gunshot_onset(audio_data: np.ndarray, sample_rate: int = 44100, amplitude_threshold: float = 0.25) -> list[float]:
    """Detect shot times based on audio amplitude thresholding."""
    envelope = np.abs(audio_data)
    smoothed = gaussian_filter1d(envelope, sigma=50)
    
    shot_times = []
    min_samples = int(0.5 * sample_rate) # Minimum half second between shots
    
    i = 0
    while i < len(smoothed):
        if smoothed[i] > amplitude_threshold:
            shot_times.append(i / sample_rate)
            i += min_samples
        else:
            i += 1
    return shot_times

def extract_shot_frames(video_path: str, shot_times: list[float]) -> list:
    """Extract a sequence of 5 frames leading up to the shot for trajectory analysis."""
    results = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return results

    fps = cap.get(cv2.CAP_PROP_FPS) or 120.0
    
    for shot_idx, shot_time in enumerate(shot_times):
        shot_frame_num = int(shot_time * fps)
        
        sequence_offsets = [-25, -20, -15, -10, -5]
        sequence_frames = []
        
        for offset in sequence_offsets:
            target_frame_num = max(0, shot_frame_num + offset)
            cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame_num)
            ret, frame = cap.read()
            if ret:
                sequence_frames.append(frame)
                
        if sequence_frames:
            results.append({
                "shot_index": shot_idx,
                "onset_time": shot_time,
                "sequence_frames": sequence_frames
            })
            
    cap.release()
    return results
