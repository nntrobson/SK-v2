-- DeepSketch Video Backend Database Schema
-- This creates all tables for sessions, rounds, videos, shots, and measurements

-- ==========================================
-- PROFILES TABLE (extends auth.users)
-- ==========================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamp with time zone default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles 
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles 
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles 
  for update using (auth.uid() = id);

-- ==========================================
-- SESSIONS TABLE
-- ==========================================
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date timestamp with time zone default now(),
  metadata_json jsonb,
  created_at timestamp with time zone default now()
);

alter table public.sessions enable row level security;

create policy "sessions_select_own" on public.sessions 
  for select using (auth.uid() = user_id);
create policy "sessions_insert_own" on public.sessions 
  for insert with check (auth.uid() = user_id);
create policy "sessions_update_own" on public.sessions 
  for update using (auth.uid() = user_id);
create policy "sessions_delete_own" on public.sessions 
  for delete using (auth.uid() = user_id);

-- ==========================================
-- ROUNDS TABLE
-- ==========================================
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  type text default 'trap_singles',
  score integer,
  created_at timestamp with time zone default now()
);

alter table public.rounds enable row level security;

-- Allow access through session ownership
create policy "rounds_select_own" on public.rounds 
  for select using (
    exists (
      select 1 from public.sessions 
      where sessions.id = rounds.session_id 
      and sessions.user_id = auth.uid()
    )
  );
create policy "rounds_insert_own" on public.rounds 
  for insert with check (
    exists (
      select 1 from public.sessions 
      where sessions.id = rounds.session_id 
      and sessions.user_id = auth.uid()
    )
  );
create policy "rounds_update_own" on public.rounds 
  for update using (
    exists (
      select 1 from public.sessions 
      where sessions.id = rounds.session_id 
      and sessions.user_id = auth.uid()
    )
  );
create policy "rounds_delete_own" on public.rounds 
  for delete using (
    exists (
      select 1 from public.sessions 
      where sessions.id = rounds.session_id 
      and sessions.user_id = auth.uid()
    )
  );

-- ==========================================
-- VIDEOS TABLE
-- ==========================================
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  round_id uuid references public.rounds(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  blob_pathname text not null,
  original_filename text,
  file_size bigint,
  mime_type text,
  status text default 'uploaded',
  processing_progress real,
  processing_stage text,
  processing_started_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table public.videos enable row level security;

create policy "videos_select_own" on public.videos 
  for select using (auth.uid() = user_id);
create policy "videos_insert_own" on public.videos 
  for insert with check (auth.uid() = user_id);
create policy "videos_update_own" on public.videos 
  for update using (auth.uid() = user_id);
create policy "videos_delete_own" on public.videos 
  for delete using (auth.uid() = user_id);

-- ==========================================
-- SHOTS TABLE
-- ==========================================
create table if not exists public.shots (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  frame_start integer,
  frame_end integer,
  break_label text,
  station text,
  presentation text,
  confidence real,
  created_at timestamp with time zone default now()
);

alter table public.shots enable row level security;

-- Allow access through video ownership
create policy "shots_select_own" on public.shots 
  for select using (
    exists (
      select 1 from public.videos 
      where videos.id = shots.video_id 
      and videos.user_id = auth.uid()
    )
  );
create policy "shots_insert_own" on public.shots 
  for insert with check (
    exists (
      select 1 from public.videos 
      where videos.id = shots.video_id 
      and videos.user_id = auth.uid()
    )
  );
create policy "shots_update_own" on public.shots 
  for update using (
    exists (
      select 1 from public.videos 
      where videos.id = shots.video_id 
      and videos.user_id = auth.uid()
    )
  );
create policy "shots_delete_own" on public.shots 
  for delete using (
    exists (
      select 1 from public.videos 
      where videos.id = shots.video_id 
      and videos.user_id = auth.uid()
    )
  );

-- ==========================================
-- SHOT MEASUREMENTS TABLE
-- ==========================================
create table if not exists public.shot_measurements (
  shot_id uuid primary key references public.shots(id) on delete cascade,
  crosshair_x real,
  crosshair_y real,
  clay_x real,
  clay_y real,
  normalized_x real,
  normalized_y real,
  trajectory jsonb,
  tracking_data jsonb,
  created_at timestamp with time zone default now()
);

alter table public.shot_measurements enable row level security;

-- Allow access through shot->video ownership
create policy "shot_measurements_select_own" on public.shot_measurements 
  for select using (
    exists (
      select 1 from public.shots 
      join public.videos on videos.id = shots.video_id 
      where shots.id = shot_measurements.shot_id 
      and videos.user_id = auth.uid()
    )
  );
create policy "shot_measurements_insert_own" on public.shot_measurements 
  for insert with check (
    exists (
      select 1 from public.shots 
      join public.videos on videos.id = shots.video_id 
      where shots.id = shot_measurements.shot_id 
      and videos.user_id = auth.uid()
    )
  );
create policy "shot_measurements_update_own" on public.shot_measurements 
  for update using (
    exists (
      select 1 from public.shots 
      join public.videos on videos.id = shots.video_id 
      where shots.id = shot_measurements.shot_id 
      and videos.user_id = auth.uid()
    )
  );

-- ==========================================
-- CORRECTIONS TABLE
-- ==========================================
create table if not exists public.corrections (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid references public.shots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  correction_type text not null,
  original_value text,
  corrected_value text,
  created_at timestamp with time zone default now()
);

alter table public.corrections enable row level security;

create policy "corrections_select_own" on public.corrections 
  for select using (auth.uid() = user_id);
create policy "corrections_insert_own" on public.corrections 
  for insert with check (auth.uid() = user_id);
create policy "corrections_update_own" on public.corrections 
  for update using (auth.uid() = user_id);
create policy "corrections_delete_own" on public.corrections 
  for delete using (auth.uid() = user_id);

-- ==========================================
-- TRIGGER: Auto-create profile on signup
-- ==========================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ==========================================
-- INDEXES for performance
-- ==========================================
create index if not exists idx_sessions_user_id on public.sessions(user_id);
create index if not exists idx_rounds_session_id on public.rounds(session_id);
create index if not exists idx_videos_user_id on public.videos(user_id);
create index if not exists idx_videos_round_id on public.videos(round_id);
create index if not exists idx_shots_video_id on public.shots(video_id);
create index if not exists idx_corrections_user_id on public.corrections(user_id);
create index if not exists idx_corrections_shot_id on public.corrections(shot_id);
