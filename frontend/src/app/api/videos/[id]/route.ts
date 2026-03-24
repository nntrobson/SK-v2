import { createClient } from "@/lib/supabase/server";
import { del } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";

export async function DELETE(
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

    // Get the video to get file path and session
    const { data: video, error: videoError } = await supabase
      .from("videos")
      .select("file_path, session_id")
      .eq("id", parseInt(id))
      .eq("user_id", user.id)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    // Delete from Blob storage if path exists
    if (video.file_path) {
      try {
        await del(video.file_path);
      } catch (blobError) {
        console.error("Error deleting blob:", blobError);
        // Continue with database deletion even if blob deletion fails
      }
    }

    // Delete the video (cascades to shots)
    const { error } = await supabase
      .from("videos")
      .delete()
      .eq("id", parseInt(id))
      .eq("user_id", user.id);

    if (error) {
      console.error("Error deleting video:", error);
      return NextResponse.json({ error: "Failed to delete video" }, { status: 500 });
    }

    // Recalculate session score
    if (video.session_id) {
      const { data: sessionShots } = await supabase
        .from("shots")
        .select("type")
        .eq("session_id", video.session_id);

      const hits = sessionShots?.filter(s => s.type === "hit").length || 0;
      const total = sessionShots?.length || 0;

      await supabase
        .from("sessions")
        .update({
          score: hits,
          total: total,
        })
        .eq("id", video.session_id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in video DELETE:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
