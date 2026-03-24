"use client";

import React from "react";
import { motion } from "framer-motion";
import { 
  Crosshair, 
  Video, 
  LineChart, 
  Clock, 
  Camera, 
  TrendingUp,
  ChevronRight
} from "lucide-react";
import Link from "next/link";

export function UseCasesGrid() {
  return (
    <section className="py-12 relative w-full mt-8">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Built for the podium.</h2>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          Whether you&apos;re diagnosing a missed clay, validating your ShotKam footage, or building a comprehensive performance history, we provide the tools you need.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
        {/* Use Case 1 */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-panel p-8 rounded-2xl flex flex-col items-start text-left group hover:-translate-y-1 transition-all duration-300 border-white/5"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 mb-6 group-hover:scale-110 transition-transform">
            <Crosshair className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white mb-3">Detection Validation</h3>
          <p className="text-slate-400 leading-relaxed text-sm">
            Validate computer vision detection quality instantly. Check reticle overlays on clay videos to ensure your baseline data is 100% accurate.
          </p>
        </motion.div>

        {/* Use Case 2 */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="glass-panel p-8 rounded-2xl flex flex-col items-start text-left group hover:-translate-y-1 transition-all duration-300 border-white/5"
        >
          <div className="w-12 h-12 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400 mb-6 group-hover:scale-110 transition-transform">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white mb-3">Pre-Trigger Timing</h3>
          <p className="text-slate-400 leading-relaxed text-sm">
            Micro-analyze your reaction speed. Review precise pre-trigger timing metrics to shave fractions of a second off your acquisition phase.
          </p>
        </motion.div>

        {/* Use Case 3 */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="glass-panel p-8 rounded-2xl flex flex-col items-start text-left group hover:-translate-y-1 transition-all duration-300 border-white/5"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 mb-6 group-hover:scale-110 transition-transform">
            <Camera className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white mb-3">Screenshot Packages</h3>
          <p className="text-slate-400 leading-relaxed text-sm">
            Automatically generate frame-by-frame screenshot packages of critical moments for coaching reviews or post-competition debriefs.
          </p>
        </motion.div>

        {/* Use Case 4 */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="glass-panel p-8 rounded-2xl flex flex-col items-start text-left group hover:-translate-y-1 transition-all duration-300 border-white/5"
        >
          <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400 mb-6 group-hover:scale-110 transition-transform">
            <Video className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white mb-3">Waveform Overlays</h3>
          <p className="text-slate-400 leading-relaxed text-sm">
            Export complete review videos featuring dynamic waveform overlays. See exactly how audio signatures align with barrel movement.
          </p>
        </motion.div>

        {/* Use Case 5 */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="glass-panel p-8 rounded-2xl flex flex-col items-start text-left group hover:-translate-y-1 transition-all duration-300 border-white/5"
        >
          <div className="w-12 h-12 rounded-xl bg-teal-500/20 flex items-center justify-center text-teal-400 mb-6 group-hover:scale-110 transition-transform">
            <TrendingUp className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white mb-3">Long-Term Analytics</h3>
          <p className="text-slate-400 leading-relaxed text-sm">
            Track hit/miss performance across multiple sessions. Identify trends, plateau periods, and specific weaknesses in your approach.
          </p>
        </motion.div>

        {/* Use Case 6 */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="glass-panel p-8 rounded-2xl flex flex-col items-start text-left group hover:-translate-y-1 transition-all duration-300 border-white/5"
        >
          <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400 mb-6 group-hover:scale-110 transition-transform">
            <LineChart className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white mb-3">Trajectory & Angle</h3>
          <p className="text-slate-400 leading-relaxed text-sm">
            Map shot angles and trajectories with high-fidelity canvas visualizations. Perfect your hold points and break zones mathematically.
          </p>
        </motion.div>
      </div>

      {/* Embedded CTA */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        className="max-w-4xl mx-auto glass-panel p-10 md:p-12 rounded-3xl text-center relative overflow-hidden border-white/10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 to-blue-600/10 pointer-events-none" />
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-4 relative z-10">Stop Guessing. Start Tracking.</h2>
        <p className="text-slate-300 text-base mb-8 max-w-xl mx-auto relative z-10">
          Join the new standard of competitive clay shooting analysis. Upload your ShotKam footage and let our CV pipeline reveal the truth behind every shot.
        </p>
        <Link 
          href="/dashboard/upload"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white text-slate-900 hover:bg-sky-50 font-bold text-base transition-all relative z-10 shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-white/40"
        >
          Upload New Video
          <ChevronRight className="w-5 h-5" />
        </Link>
      </motion.div>
    </section>
  );
}
