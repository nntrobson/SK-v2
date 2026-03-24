import { createClient } from "@/lib/supabase/server";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
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

    // Process each file
    for (const file of files) {
      // Upload to Vercel Blob (private storage)
      const blob = await put(`videos/${user.id}/${session.id}/${file.name}`, file, {
        access: "private",
      });

      // Create video record
      const { data: video, error: videoError } = await supabase
        .from("videos")
        .insert({
          session_id: session.id,
          user_id: user.id,
          file_name: file.name,
          file_path: blob.pathname,
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

      // Start simulated processing (in a real app this would trigger an actual processing pipeline)
      simulateVideoProcessing(supabase, video.id, session.id, user.id, blob.pathname);
    }

    return NextResponse.json({ 
      session_id: session.id,
      video_ids: videoIds 
    });
  } catch (error) {
    console.error("Error in video upload:", error);
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
  const numShots = Math.floor(Math.random() * 5) + 3; // 3-7 shots per video
  const shots = [];
  
  for (let i = 0; i < numShots; i++) {
    const isHit = Math.random() > 0.3;
    shots.push({
      video_id: videoId,
      session_id: sessionId,
      user_id: userId,
      x: (Math.random() - 0.5) * 20, // -10 to 10
      y: (Math.random() - 0.5) * 20 + 5, // -5 to 15 (slightly above center)
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

  // Insert shots
  await supabase.from("shots").insert(shots);

  // Mark video as completed
  await supabase
    .from("videos")
    .update({
      status: "completed",
      progress_percent: 100,
      stage: "Complete",
    })
    .eq("id", videoId);

  // Check if all videos in session are complete
  const { data: sessionVideos } = await supabase
    .from("videos")
    .select("status")
    .eq("session_id", sessionId);

  const allComplete = sessionVideos?.every(v => v.status === "completed");

  if (allComplete) {
    // Calculate session score
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
