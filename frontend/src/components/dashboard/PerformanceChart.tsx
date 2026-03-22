"use client";

import React from "react";
import { motion } from "framer-motion";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from 'recharts';

export interface TrendDataPoint {
  month: string;
  average: number;
}

interface PerformanceChartProps {
  delay?: number;
  data: TrendDataPoint[];
}

export default function PerformanceChart({ delay = 0.2, data }: PerformanceChartProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="glass-panel rounded-2xl p-6 relative overflow-hidden md:col-span-2 flex flex-col justify-between">
      <h3 className="text-slate-400 font-semibold uppercase tracking-wider text-xs mb-4">Performance Velocity</h3>
      <div className="h-24 w-full min-h-[96px]">
      <ResponsiveContainer width="100%" height={96}>
        <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
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
  );
}
