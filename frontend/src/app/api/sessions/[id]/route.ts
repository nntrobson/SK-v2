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

    const { data: session, error } = await supabase
      .from("sessions")
      .select("id, venue, date, type, score, total, status")
      .eq("id", parseInt(id))
      .single();

    if (error || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error("Error fetching session:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    const body = await request.json();
    
    const { data: session, error } = await supabase
      .from("sessions")
      .update({
        venue: body.venue,
        date: body.date,
        type: body.type,
        score: body.score,
        total: body.total,
        status: body.status,
      })
      .eq("id", parseInt(id))
      .select()
      .single();

    if (error) {
      console.error("Error updating session:", error);
      return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error("Error in session PUT:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    // Delete session (cascades to videos and shots)
    const { error } = await supabase
      .from("sessions")
      .delete()
      .eq("id", parseInt(id));

    if (error) {
      console.error("Error deleting session:", error);
      return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in session DELETE:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
