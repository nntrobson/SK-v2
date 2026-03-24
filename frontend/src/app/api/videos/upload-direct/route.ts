import { put } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";

// Use Edge runtime for streaming uploads - no body size limit
export const runtime = "edge";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Get user ID and filename from headers (set by the client after getting auth token)
    const userId = request.headers.get("x-user-id");
    const filename = request.headers.get("x-filename");
    const contentType = request.headers.get("content-type") || "video/mp4";

    if (!userId || !filename) {
      return NextResponse.json(
        { error: "Missing user ID or filename" },
        { status: 400 }
      );
    }

    // Get the raw body as a stream
    const body = request.body;
    if (!body) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Generate unique pathname
    const pathname = `videos/${userId}/${Date.now()}-${filename}`;

    // Upload directly to Vercel Blob using the stream
    const blob = await put(pathname, body, {
      access: "private",
      contentType: contentType.split(";")[0], // Remove charset if present
    });

    return NextResponse.json({
      pathname: blob.pathname,
      url: blob.url,
    });
  } catch (error) {
    console.error("Direct upload error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
