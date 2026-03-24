import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { files } = await request.json();

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Create a new session for this batch
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        user_id: user.id,
        venue: "Silver Dollar Club",
        date: new Date().toISOString().split("T")[0],
        type: "Trap Singles",
        score: 0,
        total: files.length,
        status: "processing",
      })
      .select()
      .single();

    if (sessionError || !session) {
      console.error("Error creating session:", sessionError);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    const videoIds: number[] = [];

    // Create video records for each file
    for (const file of files) {
      const { data: video, error: videoError } = await supabase
        .from("videos")
        .insert({
          session_id: session.id,
          user_id: user.id,
          file_name: file.name,
          file_path: file.pathname,
          file_size_mb: parseFloat((file.size / 1024 / 1024).toFixed(2)),
          status: "processing",
          progress_percent: 0,
          stage: "Queued",
        })
        .select()
        .single();

      if (videoError || !video) {
        console.error("Error creating video record:", videoError);
        continue;
      }

      videoIds.push(video.id);

      // Start simulated processing
      simulateVideoProcessing(supabase, video.id, session.id, user.id, file.pathname);
    }

    return NextResponse.json({
      session_id: session.id,
      video_ids: videoIds,
    });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Simulated video processing - in production this would be a separate job/worker
async function simulateVideoProcessing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  videoId: number,
  sessionId: number,
  userId: string,
  filePath: string
) {
  const stages = [
    { stage: "Extracting frames", duration: 2000 },
    { stage: "Detecting shots", duration: 3000 },
    { stage: "Analyzing trajectories", duration: 2000 },
    { stage: "Computing coordinates", duration: 2000 },
    { stage: "Generating insights", duration: 1000 },
  ];

  let progress = 0;
  const progressPerStage = 100 / stages.length;

  for (const { stage, duration } of stages) {
    await supabase
      .from("videos")
      .update({
        stage,
        progress_percent: Math.round(progress),
        eta_seconds: Math.round((stages.length * 2) - (progress / 10)),
      })
      .eq("id", videoId);

    await new Promise(resolve => setTimeout(resolve, duration));
    progress += progressPerStage;
  }

  // Generate sample shots for the video
  const numShots = Math.floor(Math.random() * 5) + 3;
  const shots = [];

  for (let i = 0; i < numShots; i++) {
    const isHit = Math.random() > 0.3;
    shots.push({
      video_id: videoId,
      session_id: sessionId,
      user_id: userId,
      x: (Math.random() - 0.5) * 20,
      y: (Math.random() - 0.5) * 20 + 5,
      type: isHit ? "hit" : "miss",
      break_label: isHit ? ["dust", "chip", "solid"][Math.floor(Math.random() * 3)] : null,
      presentation: ["straight", "hard_left", "hard_right", "moderate_left", "moderate_right"][Math.floor(Math.random() * 5)],
      station: ["trap-house-1-2", "trap-house", "trap-house-4-5"][Math.floor(Math.random() * 3)],
      confidence: 0.85 + Math.random() * 0.15,
      video_path: filePath,
      clay_x: Math.random() * 100,
      clay_y: Math.random() * 100,
      crosshair_x: Math.random() * 100,
      crosshair_y: Math.random() * 100,
    });
  }

  await supabase.from("shots").insert(shots);

  await supabase
    .from("videos")
    .update({
      status: "completed",
      progress_percent: 100,
      stage: "Complete",
    })
    .eq("id", videoId);

  const { data: sessionVideos } = await supabase
    .from("videos")
    .select("status")
    .eq("session_id", sessionId);

  const allComplete = sessionVideos?.every(v => v.status === "completed");

  if (allComplete) {
    const { data: sessionShots } = await supabase
      .from("shots")
      .select("type")
      .eq("session_id", sessionId);

    const hits = sessionShots?.filter(s => s.type === "hit").length || 0;
    const total = sessionShots?.length || 0;

    await supabase
      .from("sessions")
      .update({
        status: "complete",
        score: hits,
        total: total,
      })
      .eq("id", sessionId);
  }
}
