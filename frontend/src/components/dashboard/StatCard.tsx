"use client";

import React from "react";
import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";

interface StatCardProps {
  delay?: number;
  average: number;
  trend: number;
}

export function StatCard({ delay = 0.1, average, trend }: StatCardProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="glass-panel rounded-2xl p-6 relative overflow-hidden group">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-transparent" />
      <h3 className="text-slate-400 font-semibold uppercase tracking-wider text-xs mb-2">Current Average</h3>
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-4xl font-extrabold text-white">{average.toFixed(1)}</span>
        <span className="text-slate-500 font-medium">/ 25</span>
      </div>
      <div className="text-sm font-medium text-emerald-400 flex items-center gap-1 bg-emerald-500/10 w-fit px-2 py-1 rounded">
        <TrendingUp className="w-4 h-4" /> +{trend.toFixed(1)} this month
      </div>
    </motion.div>
  );
}
