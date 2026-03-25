import { createClient as createServerClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Create a service role client that bypasses RLS
function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServerClient(supabaseUrl, supabaseServiceKey);
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Get all sessions
    const { data: sessions, error: sessionsError } = await supabase
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
    const supabase = createServiceClient();

    const body = await request.json();
    
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({
        user_id: null, // Anonymous
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
