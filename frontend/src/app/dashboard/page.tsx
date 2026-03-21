"use client";

import React from "react";
import { motion } from "framer-motion";
import { Target, TrendingUp, Crosshair, ChevronRight } from "lucide-react";
import Link from "next/link";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from 'recharts';

const TREND_DATA = [
  { month: 'Jan', average: 18 },
  { month: 'Feb', average: 19 },
  { month: 'Mar', average: 22 },
];

export default function DashboardOverviewLayout() {
  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto w-full py-6">
      <motion.div 
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="glass-panel overflow-hidden rounded-3xl p-8 md:p-12 relative flex flex-col md:flex-row items-center justify-between gap-8 border-t-white/10"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-sky-400/5 z-0" />
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold uppercase tracking-widest mb-6">
            Neural Analysis Active
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel rounded-2xl p-6 relative overflow-hidden group">
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-transparent" />
           <h3 className="text-slate-400 font-semibold uppercase tracking-wider text-xs mb-2">Current Average</h3>
           <div className="flex items-baseline gap-2 mb-4">
             <span className="text-4xl font-extrabold text-white">22.4</span>
             <span className="text-slate-500 font-medium">/ 25</span>
           </div>
           <div className="text-sm font-medium text-emerald-400 flex items-center gap-1 bg-emerald-500/10 w-fit px-2 py-1 rounded">
              <TrendingUp className="w-4 h-4" /> +1.2 this month
           </div>
        </motion.div>
        
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-2xl p-6 relative overflow-hidden md:col-span-2 flex flex-col justify-between">
           <h3 className="text-slate-400 font-semibold uppercase tracking-wider text-xs mb-4">Performance Velocity</h3>
           <div className="h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={TREND_DATA} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" hide />
                <Tooltip contentStyle={{backgroundColor: '#0f172a', border: 'none', borderRadius: '8px'}} />
                <Area type="monotone" dataKey="average" stroke="#60a5fa" strokeWidth={3} fillOpacity={1} fill="url(#colorAvg)" />
              </AreaChart>
            </ResponsiveContainer>
           </div>
        </motion.div>
      </div>

    </div>
  );
}
