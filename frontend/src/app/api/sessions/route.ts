import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || "anonymous";

    // Get sessions with processing info (all sessions if anonymous)
    const query = supabase
      .from("sessions")
      .select(`
        id,
        venue,
        date,
        type,
        score,
        total,
        status,
        created_at,
        updated_at
      `)
      .order("date", { ascending: false });
    
    // Only filter by user_id if we have a real user
    if (user) {
      query.eq("user_id", user.id);
    }
    
    const { data: sessions, error: sessionsError } = await query;

    if (sessionsError) {
      console.error("Error fetching sessions:", sessionsError);
      return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
    }

    // For sessions with processing status, get video progress info
    const sessionsWithProcessing = await Promise.all(
      (sessions || []).map(async (session) => {
        if (session.status === "processing") {
          const { data: videos } = await supabase
            .from("videos")
            .select("status, progress_percent, stage, eta_seconds")
            .eq("session_id", session.id)
            .eq("session_id", session.id);

          if (videos && videos.length > 0) {
            // Aggregate progress across all videos
            const totalProgress = videos.reduce((sum, v) => sum + (v.progress_percent || 0), 0);
            const avgProgress = Math.round(totalProgress / videos.length);
            const currentVideo = videos.find(v => v.status === "processing") || videos[0];

            return {
              ...session,
              processing: {
                progress_percent: avgProgress,
                stage: currentVideo?.stage || "Processing",
                eta_seconds: currentVideo?.eta_seconds,
              },
            };
          }
        }
        return session;
      })
    );

    return NextResponse.json(sessionsWithProcessing);
  } catch (error) {
    console.error("Error in sessions GET:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();

    const body = await request.json();
    
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({
        user_id: user?.id || null,
        venue: body.venue || "Silver Dollar Club",
        date: body.date || new Date().toISOString().split("T")[0],
        type: body.type || "Trap Singles",
        score: body.score || 0,
        total: body.total || 25,
        status: body.status || "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating session:", error);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error("Error in sessions POST:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
