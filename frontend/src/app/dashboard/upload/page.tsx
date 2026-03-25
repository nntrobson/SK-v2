"use client";

import React, { useState, useEffect } from "react";
import { UploadCloud, CheckCircle, Video, ChevronRight, Film, X } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ProcessingProgressBar,
  type ProcessingPayload,
} from "@/components/dashboard/ProcessingProgressBar";

// Chunk size for multipart upload (4MB each - avoids 413 errors)
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

// Upload file using chunked multipart upload to avoid body size limits
async function uploadFileWithProgress(
  file: File,
  onProgress: (percent: number) => void
): Promise<{ pathname: string; url: string }> {
  // Step 1: Initialize multipart upload
  const initRes = await fetch("/api/videos/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "init",
      filename: file.name,
      contentType: file.type || "video/mp4",
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.json();
    throw new Error(err.error || "Failed to initialize upload");
  }

  const { uploadId, key } = await initRes.json();

  // Step 2: Upload file in chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const parts: { partNumber: number; etag: string }[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    
    // Convert chunk to base64
    const buffer = await chunk.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    const partRes = await fetch("/api/videos/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "uploadPart",
        key,
        uploadId,
        partNumber: i + 1,
        chunk: base64,
      }),
    });

    if (!partRes.ok) {
      const err = await partRes.json();
      throw new Error(err.error || `Failed to upload part ${i + 1}`);
    }

    const part = await partRes.json();
    parts.push({ partNumber: part.partNumber, etag: part.etag });

    // Update progress
    const percent = Math.round(((i + 1) / totalChunks) * 100);
    onProgress(percent);
  }

  // Step 3: Complete multipart upload
  const completeRes = await fetch("/api/videos/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "complete",
      key,
      uploadId,
      parts,
    }),
  });

  if (!completeRes.ok) {
    const err = await completeRes.json();
    throw new Error(err.error || "Failed to complete upload");
  }

  return completeRes.json();
}

const VIDEO_ACCEPT =
  "video/mp4,video/avi,video/quicktime,video/x-msvideo,.mp4,.avi,.mov,.MOV";

type UploadedVideoStatus = {
  clientKey: string;
  fileName: string;
  fileSizeMb: string;
  videoId: number;
  status: string;
  processing: ProcessingPayload;
};

type UploadingFile = {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "complete" | "error";
  pathname?: string;
};

const TERMINAL_UPLOAD_STATUSES = new Set(["completed", "error", "error_no_shots"]);

export default function UploadPage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [uploadedVideos, setUploadedVideos] = useState<UploadedVideoStatus[]>([]);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!success || uploadedVideos.length === 0) return;
    if (uploadedVideos.every((video) => TERMINAL_UPLOAD_STATUSES.has(video.status))) return;

    const idRef: { current: ReturnType<typeof setInterval> | undefined } = {
      current: undefined,
    };

    const poll = () => {
      Promise.all(
        uploadedVideos.map(async (video) => {
          if (TERMINAL_UPLOAD_STATUSES.has(video.status)) return video;

          try {
            const response = await fetch(`/api/videos/${video.videoId}/processing-status`);
            if (!response.ok) return video;
            const payload = await response.json();
            return {
              ...video,
              status: typeof payload.status === "string" ? payload.status : video.status,
              processing: {
                progress_percent: payload.progress_percent,
                stage: payload.stage,
                eta_seconds: payload.eta_seconds,
              },
            };
          } catch {
            return video;
          }
        })
      )
        .then((nextVideos) => {
          setUploadedVideos(nextVideos);
          if (nextVideos.every((video) => TERMINAL_UPLOAD_STATUSES.has(video.status)) && idRef.current) {
            clearInterval(idRef.current);
          }
        })
        .catch(() => {});
    };

    poll();
    idRef.current = setInterval(poll, 2000);
    return () => {
      if (idRef.current) clearInterval(idRef.current);
    };
  }, [success, uploadedVideos]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;
    
    setUploading(true);
    
    // Initialize uploading files state
    const initialUploadingFiles: UploadingFile[] = selectedFiles.map(file => ({
      file,
      progress: 0,
      status: "pending",
    }));
    setUploadingFiles(initialUploadingFiles);

    try {
      // Upload each file directly to Blob storage
      const uploadedFileInfo: { name: string; pathname: string; size: number }[] = [];

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        
        // Update status to uploading
        setUploadingFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: "uploading" } : f
        ));

        try {
          const result = await uploadFileWithProgress(file, (percent) => {
            setUploadingFiles(prev => prev.map((f, idx) => 
              idx === i ? { ...f, progress: percent } : f
            ));
          });

          uploadedFileInfo.push({
            name: file.name,
            pathname: result.pathname,
            size: file.size,
          });

          // Update status to complete
          setUploadingFiles(prev => prev.map((f, idx) => 
            idx === i ? { ...f, status: "complete", progress: 100, pathname: result.pathname } : f
          ));
        } catch (uploadError) {
          console.error(`Failed to upload ${file.name}:`, uploadError);
          setUploadingFiles(prev => prev.map((f, idx) => 
            idx === i ? { ...f, status: "error" } : f
          ));
        }
      }

      if (uploadedFileInfo.length === 0) {
        throw new Error("No files were uploaded successfully");
      }

      // Now create the session with all uploaded files
      const sessionResponse = await fetch("/api/videos/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: uploadedFileInfo }),
      });

      if (!sessionResponse.ok) {
        const errorData = await sessionResponse.json();
        throw new Error(errorData.error || "Failed to create session");
      }

      const { video_ids } = await sessionResponse.json();

      setUploadedVideos(
        uploadedFileInfo.map((file, index) => ({
          clientKey: `${file.name}-${file.size}-${index}`,
          fileName: file.name,
          fileSizeMb: (file.size / 1024 / 1024).toFixed(2),
          videoId: video_ids[index],
          status: "pending",
          processing: {
            progress_percent: null,
            stage: "Connecting…",
            eta_seconds: null,
          },
        }))
      );
      setUploading(false);
      setSuccess(true);
    } catch (error) {
      console.error("Upload failed:", error);
      const msg = error instanceof Error ? error.message : "Upload failed.";
      alert(`Upload failed: ${msg}`);
      setUploading(false);
    }
  };

  const pickFiles = (files: FileList | File[] | undefined | null) => {
    if (!files) return;
    const nextFiles = Array.from(files);
    if (nextFiles.length > 0) {
      setSelectedFiles(nextFiles);
      setUploadingFiles([]);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    pickFiles(e.dataTransfer.files);
  };

  const resetUploader = () => {
    setSelectedFiles([]);
    setUploadedVideos([]);
    setUploadingFiles([]);
    setSuccess(false);
    setUploading(false);
  };

  const totalSelectedSizeMb = (
    selectedFiles.reduce((sum, file) => sum + file.size, 0) /
    1024 /
    1024
  ).toFixed(2);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-8 max-w-4xl mx-auto w-full py-8"
    >
      <div className="text-center space-y-4">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: "spring" }}
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-sky-400 text-white shadow-xl shadow-blue-500/20 mb-2"
        >
          <Video className="w-8 h-8" />
        </motion.div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">
          Upload Session
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light">
          Drop your raw ShotKam footage here. Our proprietary CV pipeline will extract shots, categorize performance, and render your personalized film room mapping.
        </p>
      </div>

      <AnimatePresence mode="wait">
        {success ? (
          <motion.div 
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel rounded-3xl p-12 flex flex-col items-center justify-center text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-green-500/10 to-transparent pointer-events-none" />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
            >
              <CheckCircle className="w-24 h-24 text-green-400 mb-6 drop-shadow-[0_0_15px_rgba(74,222,128,0.5)]" />
            </motion.div>
            <h2 className="text-3xl font-bold text-white mb-4">Pipeline Engaged</h2>
            <p className="text-slate-300 text-lg max-w-md mb-6">
              {uploadedVideos.length === 1
                ? "Your video is actively rendering. The AI is mapping crosshair coordinates against clay presentations."
                : `Your ${uploadedVideos.length} videos are actively rendering. The AI is mapping crosshair coordinates against clay presentations.`}
            </p>
            <div className="mb-8 grid w-full max-w-3xl gap-3">
              {uploadedVideos.map((video) => (
                <div
                  key={video.clientKey}
                  className="rounded-2xl border border-white/10 bg-slate-950/50 px-5 py-4 text-left"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{video.fileName}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                        {video.fileSizeMb} MB · Video #{video.videoId}
                      </div>
                    </div>
                    <div className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-sky-200">
                      {video.status}
                    </div>
                  </div>
                  <ProcessingProgressBar processing={video.processing} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={resetUploader}
                className="border border-white/10 bg-slate-900/80 px-6 py-3 rounded-full text-white font-semibold hover:bg-slate-800 transition flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Upload Another Batch
              </button>
              <Link href="/dashboard/sessions">
                <motion.button 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="bg-white text-slate-900 font-bold px-8 py-3 rounded-full hover:bg-slate-100 transition shadow-[0_0_20px_rgba(255,255,255,0.3)] flex items-center gap-2"
                >
                  Enter Film Room <ChevronRight className="w-5 h-5" />
                </motion.button>
              </Link>
            </div>
          </motion.div>
        ) : (
          <motion.form 
            key="upload-form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            onSubmit={handleUpload} 
            className="glass-panel rounded-3xl p-8 md:p-12 shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -z-10" />
            
            <div className="mb-8 relative z-10">
              <label className="block text-sm font-medium text-slate-300 mb-3 uppercase tracking-wider">Session Context</label>
              <div className="relative">
                <select className="w-full bg-slate-900/50 border border-slate-700/50 text-white rounded-xl p-4 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition shadow-inner">
                  <option value="1">Silver Dollar Club - Trap Singles</option>
                  <option value="2">New Custom Venue</option>
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                  <ChevronRight className="w-5 h-5 text-slate-400 rotate-90" />
                </div>
              </div>
            </div>

            <motion.div 
              whileHover={{ scale: 1.01 }}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`relative border-2 border-dashed rounded-2xl p-16 flex flex-col items-center justify-center text-center transition-all bg-slate-900/30 overflow-hidden group
                ${selectedFiles.length > 0 ? 'border-sky-500 bg-sky-900/20' : 'border-slate-700 hover:border-blue-500/50 hover:bg-slate-800/50'}
                ${dragActive ? 'border-sky-400 bg-sky-900/30 ring-2 ring-sky-500/40' : ''}`}
            >
              {selectedFiles.length > 0 && (
                <div className="absolute inset-0 bg-gradient-to-t from-sky-500/10 to-transparent pointer-events-none" />
              )}
              
              <motion.div 
                animate={uploading ? { y: [0, -10, 0] } : {}} 
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <UploadCloud className={`w-16 h-16 mb-6 transition-colors ${selectedFiles.length > 0 ? 'text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]' : 'text-slate-500 group-hover:text-blue-400'}`} />
              </motion.div>
              
              <h3 className="font-bold text-xl text-white mb-2 tracking-wide">
                {selectedFiles.length === 0
                  ? "Upload Videos"
                  : selectedFiles.length === 1
                    ? selectedFiles[0].name
                    : `${selectedFiles.length} videos selected`}
              </h3>
              <p className="text-slate-400 mb-6 font-light">
                {selectedFiles.length > 0
                  ? `${totalSelectedSizeMb} MB queued across ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}`
                  : "Drag ShotKam .mp4 / .avi / .mov files here or browse multiple videos at once."}
              </p>

              {selectedFiles.length > 0 ? (
                <div className="mb-6 grid w-full max-w-xl gap-2 text-left">
                  {selectedFiles.slice(0, 5).map((file, index) => {
                    const uploadingFile = uploadingFiles[index];
                    return (
                      <div
                        key={`${file.name}-${file.size}-${index}`}
                        className="rounded-xl border border-white/10 bg-slate-950/50 px-4 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <Film className="h-4 w-4 shrink-0 text-sky-300" />
                            <span className="truncate text-sm text-white">{file.name}</span>
                          </div>
                          <span className="ml-4 shrink-0 text-xs uppercase tracking-[0.14em] text-slate-500">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        </div>
                        {uploadingFile && uploadingFile.status === "uploading" && (
                          <div className="mt-2">
                            <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-sky-500 transition-all duration-300"
                                style={{ width: `${uploadingFile.progress}%` }}
                              />
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{uploadingFile.progress}% uploaded</div>
                          </div>
                        )}
                        {uploadingFile && uploadingFile.status === "complete" && (
                          <div className="mt-1 text-xs text-green-400">Uploaded</div>
                        )}
                        {uploadingFile && uploadingFile.status === "error" && (
                          <div className="mt-1 text-xs text-red-400">Failed</div>
                        )}
                      </div>
                    );
                  })}
                  {selectedFiles.length > 5 ? (
                    <div className="text-center text-xs uppercase tracking-[0.14em] text-slate-500">
                      + {selectedFiles.length - 5} more files selected
                    </div>
                  ) : null}
                </div>
              ) : null}
              
              <label className="relative overflow-hidden group cursor-pointer">
                <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-blue-600 to-sky-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative bg-slate-800 border border-slate-600 text-white font-medium px-6 py-2.5 rounded-full shadow-lg transition-transform hover:scale-105 inline-block">
                  Browse Files
                </span>
                <input
                  type="file"
                  accept={VIDEO_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => pickFiles(e.target.files)}
                />
              </label>
            </motion.div>

            <button 
              type="submit" 
              disabled={selectedFiles.length === 0 || uploading}
              className={`w-full mt-8 font-bold px-6 py-4 rounded-xl transition-all shadow-lg flex justify-center items-center gap-3 text-lg
                ${selectedFiles.length > 0 && !uploading 
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25 hover:shadow-blue-500/50' 
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
            >
              {uploading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span className="animate-pulse">Uploading to Cloud Storage...</span>
                </>
              ) : selectedFiles.length > 1 ? `Commence Scan for ${selectedFiles.length} Videos` : "Commence Scan"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
