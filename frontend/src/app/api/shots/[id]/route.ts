import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

export async function PUT(
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
    
    const { data: shot, error } = await supabase
      .from("shots")
      .update({
        type: body.type,
        break_label: body.break_label,
        presentation: body.presentation,
        station: body.station,
      })
      .eq("id", parseInt(id))
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating shot:", error);
      return NextResponse.json({ error: "Failed to update shot" }, { status: 500 });
    }

    // Recalculate session score
    if (shot) {
      const { data: sessionShots } = await supabase
        .from("shots")
        .select("type")
        .eq("session_id", shot.session_id);

      const hits = sessionShots?.filter(s => s.type === "hit").length || 0;
      const total = sessionShots?.length || 0;

      await supabase
        .from("sessions")
        .update({
          score: hits,
          total: total,
        })
        .eq("id", shot.session_id);
    }

    return NextResponse.json(shot);
  } catch (error) {
    console.error("Error in shot PUT:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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

    // Get the shot first to know the session
    const { data: shot } = await supabase
      .from("shots")
      .select("session_id")
      .eq("id", parseInt(id))
      .eq("user_id", user.id)
      .single();

    const { error } = await supabase
      .from("shots")
      .delete()
      .eq("id", parseInt(id))
      .eq("user_id", user.id);

    if (error) {
      console.error("Error deleting shot:", error);
      return NextResponse.json({ error: "Failed to delete shot" }, { status: 500 });
    }

    // Recalculate session score
    if (shot) {
      const { data: sessionShots } = await supabase
        .from("shots")
        .select("type")
        .eq("session_id", shot.session_id);

      const hits = sessionShots?.filter(s => s.type === "hit").length || 0;
      const total = sessionShots?.length || 0;

      await supabase
        .from("sessions")
        .update({
          score: hits,
          total: total,
        })
        .eq("id", shot.session_id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in shot DELETE:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
