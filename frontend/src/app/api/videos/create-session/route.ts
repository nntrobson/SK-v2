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

      // Mark video as uploaded
      markVideoUploaded(supabase, video.id, session.id);
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

// Mark video as uploaded and ready for processing
// In production, this would trigger actual AI video analysis
async function markVideoUploaded(
  supabase: Awaited<ReturnType<typeof createClient>>,
  videoId: number,
  sessionId: number
) {
  // Mark video as uploaded (awaiting processing)
  await supabase
    .from("videos")
    .update({
      status: "uploaded",
      progress_percent: 100,
      stage: "Uploaded - Awaiting Analysis",
    })
    .eq("id", videoId);

  // Check if all videos in session are uploaded
  const { data: sessionVideos } = await supabase
    .from("videos")
    .select("status")
    .eq("session_id", sessionId);

  const allUploaded = sessionVideos?.every(v => v.status === "uploaded");

  if (allUploaded) {
    // Mark session as ready for analysis (score/total remain 0 until real analysis)
    await supabase
      .from("sessions")
      .update({
        status: "uploaded",
      })
      .eq("id", sessionId);
  }
}
