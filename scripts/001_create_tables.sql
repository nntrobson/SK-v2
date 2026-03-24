-- ShotTracker Database Schema
-- Sessions, Videos, and Shots tables for trap shooting analysis

-- Sessions table (a session is a group of videos from a single outing)
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  venue TEXT DEFAULT 'Silver Dollar Club',
  date DATE DEFAULT CURRENT_DATE,
  type TEXT DEFAULT 'Trap Singles',
  score INTEGER DEFAULT 0,
  total INTEGER DEFAULT 25,
  status TEXT DEFAULT 'pending', -- pending, processing, completed, error
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Videos table (each video file uploaded)
CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size_mb DECIMAL(10, 2),
  status TEXT DEFAULT 'pending', -- pending, processing, completed, error, error_no_shots
  progress_percent INTEGER DEFAULT 0,
  stage TEXT DEFAULT 'Queued',
  eta_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shots table (individual shots extracted from videos)
CREATE TABLE IF NOT EXISTS shots (
  id SERIAL PRIMARY KEY,
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  x DECIMAL(10, 4) DEFAULT 0, -- horizontal offset from center
  y DECIMAL(10, 4) DEFAULT 0, -- vertical offset from center
  type TEXT DEFAULT 'unknown', -- hit, miss, unknown
  break_label TEXT,
  presentation TEXT DEFAULT 'straight', -- straight, hard_left, hard_right, moderate_left, moderate_right
  station TEXT, -- trap-house, trap-house-1-2, trap-house-4-5
  confidence DECIMAL(5, 4),
  video_path TEXT,
  clay_x DECIMAL(10, 4),
  clay_y DECIMAL(10, 4),
  crosshair_x DECIMAL(10, 4),
  crosshair_y DECIMAL(10, 4),
  pretrigger_time DECIMAL(10, 4),
  pretrigger_frame_idx INTEGER,
  trajectory JSONB, -- Array of {x, y} points
  tracking_data JSONB, -- Full tracking frame data
  pretrigger_boxes JSONB, -- Overlay boxes at pretrigger
  overlay_validation_samples JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;

-- RLS Policies for sessions
CREATE POLICY "Users can view their own sessions" ON sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sessions" ON sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions" ON sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions" ON sessions
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for videos
CREATE POLICY "Users can view their own videos" ON videos
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own videos" ON videos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own videos" ON videos
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own videos" ON videos
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for shots
CREATE POLICY "Users can view their own shots" ON shots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own shots" ON shots
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own shots" ON shots
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own shots" ON shots
  FOR DELETE USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_session_id ON videos(session_id);
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_shots_session_id ON shots(session_id);
CREATE INDEX IF NOT EXISTS idx_shots_video_id ON shots(video_id);
CREATE INDEX IF NOT EXISTS idx_shots_user_id ON shots(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions;
CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_videos_updated_at ON videos;
CREATE TRIGGER update_videos_updated_at
    BEFORE UPDATE ON videos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
