"use client";

import React, { useState } from "react";
import { UploadCloud, CheckCircle, Video, ChevronRight } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("http://localhost:8000/api/videos/upload", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) throw new Error("Upload failed.");
      
      setUploading(false);
      setSuccess(true);
    } catch (error) {
      console.error("Transmission failed:", error);
      alert("Error: Upload Failed. Verify the backend is online.");
      setUploading(false);
    }
  }

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
            <p className="text-slate-300 text-lg max-w-md mb-8">
              Your video is actively rendering. The AI is mapping crosshair coordinates against clay presentations.
            </p>
            <Link href="/dashboard/sessions">
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="bg-white text-slate-900 font-bold px-8 py-3 rounded-full hover:bg-slate-100 transition shadow-[0_0_20px_rgba(255,255,255,0.3)] flex items-center gap-2"
              >
                Enter Film Room <ChevronRight className="w-5 h-5" />
              </motion.button>
            </Link>
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
              className={`relative border-2 border-dashed rounded-2xl p-16 flex flex-col items-center justify-center text-center transition-all bg-slate-900/30 overflow-hidden group
                ${file ? 'border-sky-500 bg-sky-900/20' : 'border-slate-700 hover:border-blue-500/50 hover:bg-slate-800/50'}`}
            >
              {file && (
                <div className="absolute inset-0 bg-gradient-to-t from-sky-500/10 to-transparent pointer-events-none" />
              )}
              
              <motion.div 
                animate={uploading ? { y: [0, -10, 0] } : {}} 
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <UploadCloud className={`w-16 h-16 mb-6 transition-colors ${file ? 'text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]' : 'text-slate-500 group-hover:text-blue-400'}`} />
              </motion.div>
              
              <h3 className="font-bold text-xl text-white mb-2 tracking-wide">
                {file ? file.name : 'Upload Video'}
              </h3>
              <p className="text-slate-400 mb-6 font-light">
                {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB Payload Ready` : 'Drag ShotKam .avi/.mp4 or browse files.'}
              </p>
              
              <label className="relative overflow-hidden group cursor-pointer">
                <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-blue-600 to-sky-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative bg-slate-800 border border-slate-600 text-white font-medium px-6 py-2.5 rounded-full shadow-lg transition-transform hover:scale-105 inline-block">
                  Browse Files
                </span>
                <input type="file" accept="video/mp4,video/avi" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              </label>
            </motion.div>

            <button 
              type="submit" 
              disabled={!file || uploading}
              className={`w-full mt-8 font-bold px-6 py-4 rounded-xl transition-all shadow-lg flex justify-center items-center gap-3 text-lg
                ${file && !uploading 
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25 hover:shadow-blue-500/50' 
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
            >
              {uploading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span className="animate-pulse">Transmitting to Server Array...</span>
                </>
              ) : "Commence Scan"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
