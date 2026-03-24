import { handleUpload, type HandleUploadBody } from "@vercel/blob";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Authenticate the user
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Unauthorized");
        }

        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-msvideo", "video/avi"],
          maximumSizeInBytes: 500 * 1024 * 1024, // 500MB max per file
          tokenPayload: JSON.stringify({
            userId: user.id,
            pathname,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // This is called after a successful upload
        console.log("Upload completed:", blob.pathname);
        
        // Token payload contains user info from onBeforeGenerateToken
        if (tokenPayload) {
          const { userId } = JSON.parse(tokenPayload);
          console.log("User ID:", userId);
        }
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
