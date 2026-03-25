import { createMultipartUpload, uploadPart, completeMultipartUpload } from "@vercel/blob";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { action } = body;

    // Step 1: Initialize multipart upload
    if (action === "init") {
      const { filename, contentType } = body;
      const pathname = `videos/guest/${Date.now()}-${filename}`;
      
      const multipartUpload = await createMultipartUpload(pathname, {
        access: "private",
        contentType: contentType || "video/mp4",
      });

      return NextResponse.json({
        uploadId: multipartUpload.uploadId,
        key: multipartUpload.key,
        pathname,
      });
    }

    // Step 2: Upload a single part (called for each chunk)
    if (action === "uploadPart") {
      const { key, uploadId, partNumber, chunk } = body;
      
      // chunk is base64 encoded
      const buffer = Buffer.from(chunk, "base64");
      
      const part = await uploadPart(key, uploadId, partNumber, buffer);

      return NextResponse.json({
        partNumber: part.partNumber,
        etag: part.etag,
      });
    }

    // Step 3: Complete multipart upload
    if (action === "complete") {
      const { key, uploadId, parts } = body;
      
      const blob = await completeMultipartUpload(key, uploadId, parts);

      return NextResponse.json({
        pathname: blob.pathname,
        url: blob.url,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
