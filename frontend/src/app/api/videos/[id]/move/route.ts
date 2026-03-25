import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { session_id } = body;

    if (!session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    // Get the video
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("*")
      .eq("id", parseInt(id))
      .eq("user_id", user.id)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const oldSessionId = video.session_id;

    // Update the video's session
    const { error: updateError } = await supabase
      .from("videos")
      .update({ session_id: parseInt(session_id) })
      .eq("id", parseInt(id))
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Error moving video:", updateError);
      return NextResponse.json({ error: "Failed to move video" }, { status: 500 });
    }

    // Move associated shots to the new session
    await supabase
      .from("shots")
      .update({ session_id: parseInt(session_id) })
      .eq("video_id", parseInt(id))
      .eq("user_id", user.id);

    // Recalculate scores for both sessions
    for (const sessId of [oldSessionId, parseInt(session_id)]) {
      const { data: sessionShots } = await supabase
        .from("shots")
        .select("type")
        .eq("session_id", sessId);

      const hits = sessionShots?.filter(s => s.type === "hit").length || 0;
      const total = sessionShots?.length || 0;

      await supabase
        .from("sessions")
        .update({
          score: hits,
          total: total,
        })
        .eq("id", sessId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in video move:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
