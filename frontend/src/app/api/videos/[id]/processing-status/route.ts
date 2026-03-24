import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
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

    const { data: video, error } = await supabase
      .from("videos")
      .select("status, progress_percent, stage, eta_seconds")
      .eq("id", parseInt(id))
      .eq("user_id", user.id)
      .single();

    if (error || !video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: video.status,
      progress_percent: video.progress_percent,
      stage: video.stage,
      eta_seconds: video.eta_seconds,
    });
  } catch (error) {
    console.error("Error fetching video status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
