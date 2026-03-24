import { put } from "@vercel/blob";
import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

// Increase body size limit for video uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Authenticate user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get file from form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/avi", ""];
    if (file.type && !allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    // Upload to Vercel Blob using streaming
    const blob = await put(`videos/${user.id}/${Date.now()}-${file.name}`, file.stream(), {
      access: "private",
      contentType: file.type || "video/mp4",
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
