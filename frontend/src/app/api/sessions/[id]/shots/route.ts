import { createClient as createServerClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

// Create a service role client that bypasses RLS
function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServerClient(supabaseUrl, supabaseServiceKey);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    const { data: shots, error } = await supabase
      .from("shots")
      .select(`
        id,
        x,
        y,
        type,
        break_label,
        presentation,
        station,
        confidence,
        video_path,
        clay_x,
        clay_y,
        crosshair_x,
        crosshair_y,
        pretrigger_time,
        pretrigger_frame_idx,
        trajectory,
        tracking_data,
        pretrigger_boxes,
        overlay_validation_samples,
        video_id
      `)
      .eq("session_id", parseInt(id))
      .order("id", { ascending: true });

    if (error) {
      console.error("Error fetching shots:", error);
      return NextResponse.json({ error: "Failed to fetch shots" }, { status: 500 });
    }

    return NextResponse.json(shots || []);
  } catch (error) {
    console.error("Error in shots GET:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
