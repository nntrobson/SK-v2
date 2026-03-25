import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

// Use edge runtime for streaming uploads without body size limits
export const runtime = "edge";

// Disable body parsing - we'll stream directly
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const contentType = request.headers.get("content-type") || "";
    
    // Handle multipart form data
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      // Generate unique pathname
      const timestamp = Date.now();
      const pathname = `videos/${timestamp}-${file.name}`;

      // Upload using multipart for large files
      const blob = await put(pathname, file, {
        access: "private",
        multipart: true,
        contentType: file.type || "video/mp4",
      });

      return NextResponse.json({
        pathname: blob.pathname,
        url: blob.url,
      });
    }
    
    // Handle raw body upload (for XHR with headers)
    const filename = request.headers.get("x-filename") || `video-${Date.now()}.mp4`;
    const videoContentType = request.headers.get("x-content-type") || "video/mp4";
    
    const body = request.body;
    if (!body) {
      return NextResponse.json({ error: "No body provided" }, { status: 400 });
    }

    const timestamp = Date.now();
    const pathname = `videos/${timestamp}-${decodeURIComponent(filename)}`;

    const blob = await put(pathname, body, {
      access: "private",
      multipart: true,
      contentType: videoContentType,
    });

    return NextResponse.json({
      pathname: blob.pathname,
      url: blob.url,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
