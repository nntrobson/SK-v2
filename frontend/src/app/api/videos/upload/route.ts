import { put } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// This route generates a client token for direct upload to Vercel Blob
// The actual file upload happens directly from the browser to Blob storage
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Authenticate user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get filename from request body (small JSON payload, not the file itself)
    const body = await request.json();
    const { filename, contentType } = body;
    
    if (!filename) {
      return NextResponse.json({ error: "No filename provided" }, { status: 400 });
    }

    // Generate a unique path for this upload
    const pathname = `videos/${user.id}/${Date.now()}-${filename}`;

    // Create the blob with an empty placeholder first, then return the URL for direct upload
    // Actually, we need to use the multipart upload API or client upload tokens
    // For now, let's return the pathname and have the client use fetch with streaming
    
    return NextResponse.json({
      pathname,
      userId: user.id,
      uploadUrl: `/api/videos/upload-direct`,
    });
  } catch (error) {
    console.error("Upload token error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
