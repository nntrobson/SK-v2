"use client";

import React from "react";
import { motion } from "framer-motion";
import { Target, ChevronRight } from "lucide-react";
import Link from "next/link";

export function HeroBanner() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="glass-panel overflow-hidden rounded-3xl p-8 md:p-12 relative flex flex-col md:flex-row items-center justify-between gap-8 border-t-white/10"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-sky-400/5 z-0" />
      <div className="relative z-10 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold uppercase tracking-widest mb-6">
          Video Analysis Active
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-4 leading-tight">
          Analyze your limits.<br />Break more clays.
        </h1>
        <p className="text-lg text-slate-300 font-light mb-8">
          Your recent ShotKam session at the Silver Dollar Club shows a 12% improvement in hard-left presentations. Your swing is smoothing out.
        </p>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/upload">
            <button className="bg-white text-slate-900 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-white/50 transition-shadow px-8 py-3 rounded-full font-bold">
              Process New Video
            </button>
          </Link>
          <Link href="/dashboard/sessions/1">
            <button className="glass-panel border-white/10 hover:bg-slate-800 transition-colors text-white px-8 py-3 rounded-full font-bold flex items-center gap-2">
              Latest Telemetry <ChevronRight className="w-4 h-4" />
            </button>
          </Link>
        </div>
      </div>
      
      {/* Right side graphical element */}
      <div className="relative z-10 w-full md:w-auto flex-1 h-64 border border-slate-700/50 rounded-2xl bg-black/40 overflow-hidden shadow-inner flex flex-col items-center justify-center p-6 mt-8 md:mt-0">
        <Target className="w-24 h-24 text-sky-500/30 absolute z-0 pointer-events-none" />
        <div className="text-center z-10">
           <div className="text-[64px] font-black text-white drop-shadow-[0_0_15px_rgba(56,189,248,0.5)] leading-none mb-2">92%</div>
           <div className="text-sky-400 font-bold tracking-widest uppercase text-xs">Overall Hit Rate (30 Days)</div>
        </div>
      </div>
    </motion.div>
  );
}
