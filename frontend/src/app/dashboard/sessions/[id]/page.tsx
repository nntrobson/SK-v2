"use client";

import React, { useState, useEffect } from "react";
import { 
  ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip as RechartsTooltip, 
  ResponsiveContainer, ReferenceDot, ReferenceArea
} from "recharts";
import { ArrowLeft, Target, Activity, Map, ArrowDownCircle, Video, Crosshair, Sparkles } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

interface ShotData {
  id: number;
  x: number;
  y: number;
  type: string;
  presentation: string;
  trajectory?: Array<{x: number, y: number}>;
  video_path: string;
  clay_x?: number;
  clay_y?: number;
  crosshair_x?: number;
  crosshair_y?: number;
  station?: string;
  tracking_data?: Array<{time: number, clay_x: number, clay_y: number, crosshair_x: number, crosshair_y: number, width?: number, height?: number, confidence?: number, class_name?: string}>;
}

const TrajectoryDot = (props: any) => {
  const { cx, cy, fill, payload, xAxis, yAxis, onClickShot, isSelected, anySelected } = props;
  
  const dots = [];
  if (payload.trajectory && payload.trajectory.length > 0 && xAxis && yAxis) {
    const scaleX = xAxis.scale;
    const scaleY = yAxis.scale;
    
    for (let i = 0; i < payload.trajectory.length; i++) {
      const pt = payload.trajectory[i];
      const px = scaleX(pt.x);
      const py = scaleY(pt.y);
      
      const t = i / (payload.trajectory.length - 1);
      const radius = Math.max(0.5, 4.5 * t);
      const opacity = 0.8 * Math.pow(t, 1.5);
      
      dots.push(<circle key={`tail-${i}`} cx={px} cy={py} r={radius} fill={fill} fillOpacity={opacity} style={{ pointerEvents: 'none' }} />);
    }
  }

  const opacity = anySelected ? (isSelected ? 1 : 0.25) : 1;

  return (
    <g onClick={() => onClickShot && onClickShot(payload)} className="cursor-pointer" style={{ opacity, transition: 'opacity 0.3s' }}>
      {dots}
      <circle cx={cx} cy={cy} r={6} fill={fill} stroke="#ffffff" strokeWidth={1.5} />
      {isSelected && <circle cx={cx} cy={cy} r={20} fill="none" stroke="#ffffff" strokeWidth={2} className="animate-ping" />}
      <circle cx={cx} cy={cy} r={16} fill={fill} fillOpacity={0.2} className="animate-pulse" />
    </g>
  );
};

const TrajectoryMiss = (props: any) => {
  const { cx, cy, fill, payload, xAxis, yAxis, onClickShot, isSelected, anySelected } = props;
  
  const dots = [];
  if (payload.trajectory && payload.trajectory.length > 0 && xAxis && yAxis) {
    const scaleX = xAxis.scale;
    const scaleY = yAxis.scale;
    
    for (let i = 0; i < payload.trajectory.length; i++) {
        const pt = payload.trajectory[i];
        const px = scaleX(pt.x);
        const py = scaleY(pt.y);
        
        const t = i / (payload.trajectory.length - 1);
        const radius = Math.max(0.5, 4.5 * t);
        const opacity = 0.5 * Math.pow(t, 1.5);
        
        dots.push(<circle key={`miss-tail-${i}`} cx={px} cy={py} r={radius} fill="#94a3b8" fillOpacity={opacity} style={{ pointerEvents: 'none' }} />);
    }
  }

  const opacity = anySelected ? (isSelected ? 1 : 0.25) : 1;

  return (
    <g onClick={() => onClickShot && onClickShot(payload)} className="cursor-pointer" style={{ opacity, transition: 'opacity 0.3s' }}>
      {dots}
      {/* 'X' shape for miss */}
      <line x1={cx-5} y1={cy-5} x2={cx+5} y2={cy+5} stroke={fill} strokeWidth={2.5} strokeLinecap="round" />
      <line x1={cx+5} y1={cy-5} x2={cx-5} y2={cy+5} stroke={fill} strokeWidth={2.5} strokeLinecap="round" />
      {isSelected && <circle cx={cx} cy={cy} r={20} fill="none" stroke="#ffffff" strokeWidth={2} className="animate-ping" />}
      <circle cx={cx} cy={cy} r={16} fill={fill} fillOpacity={0.1} />
    </g>
  );
};

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

const TrapFieldSelector = ({ selected, highlighted, onSelect }: { selected: string, highlighted?: string, onSelect: (s: string) => void }) => {
  const stations = [
    { id: 'post_1', cx: 15, cy: 55, label: '1' },
    { id: 'post_2', cx: 30, cy: 35, label: '2' },
    { id: 'post_3', cx: 50, cy: 25, label: '3' },
    { id: 'post_4', cx: 70, cy: 35, label: '4' },
    { id: 'post_5', cx: 85, cy: 55, label: '5' },
  ];

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Station</span>
      <svg width="100" height="70" viewBox="0 0 100 70" className="overflow-visible">
        {/* Arc indicating the 16-yard line */}
        <path d="M 10 60 Q 50 -10 90 60" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="4 2" />
        {/* Trap house */}
        <rect x="42" y="60" width="16" height="10" fill="#475569" rx="2" />
        
        {stations.map((s) => (
          <g 
            key={s.id} 
            onClick={() => onSelect(selected === s.id ? 'all' : s.id)}
            className="cursor-pointer group"
          >
            <circle 
              cx={s.cx} 
              cy={s.cy} 
              r={highlighted === s.id ? "9" : "8"} 
              fill={highlighted === s.id ? '#22d3ee' : (selected === s.id || selected === 'all' ? '#3b82f6' : '#1e293b')} 
              stroke={highlighted === s.id ? '#ffffff' : (selected === s.id ? '#60a5fa' : '#334155')}
              strokeWidth={highlighted === s.id ? "2" : "1.5"}
              className="transition-all duration-200 group-hover:fill-blue-400 group-hover:stroke-blue-300"
            />
            {highlighted === s.id && (
              <circle cx={s.cx} cy={s.cy} r="12" fill="none" stroke="#22d3ee" strokeWidth="1.5" className="animate-ping" />
            )}
            <text 
              x={s.cx} 
              y={s.cy} 
              textAnchor="middle" 
              alignmentBaseline="central" 
              fontSize="9" 
              fill="white" 
              fontWeight="bold"
              className="pointer-events-none"
              dy=".1em"
            >
              {s.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

const TrajectorySelector = ({ selected, highlighted, onSelect }: { selected: string, highlighted?: string, onSelect: (s: string) => void }) => {
  const trajectories = [
    { id: 'hard_left', d: 'M 50 65 Q 35 40 10 20', x: 10, y: 20 },
    { id: 'moderate_left', d: 'M 50 65 Q 45 35 30 5', x: 30, y: 5 },
    { id: 'straight', d: 'M 50 65 L 50 -5', x: 50, y: -5 },
    { id: 'moderate_right', d: 'M 50 65 Q 55 35 70 5', x: 70, y: 5 },
    { id: 'hard_right', d: 'M 50 65 Q 65 40 90 20', x: 90, y: 20 },
  ];

  return (
    <div className="flex flex-col items-center gap-1 border-l border-white/10 pl-6">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Trajectory</span>
      <svg width="100" height="70" viewBox="0 0 100 70" className="overflow-visible">
        {/* Trap house */}
        <rect x="42" y="60" width="16" height="10" fill="#475569" rx="2" />
        
        {trajectories.map((t) => {
          const isHighlighted = highlighted === t.id;
          const isSelected = selected === t.id || selected === 'all';
          const color = isHighlighted ? '#22d3ee' : (isSelected ? '#3b82f6' : '#1e293b');
          const strokeWidth = isHighlighted ? '3.5' : (selected === t.id ? '3' : '2');
          
          return (
            <g 
              key={t.id} 
              onClick={() => onSelect(selected === t.id ? 'all' : t.id)}
              className="cursor-pointer group"
            >
              <path 
                d={t.d} 
                fill="none" 
                stroke={color} 
                strokeWidth={strokeWidth} 
                strokeLinecap="round"
                className="transition-all duration-200 group-hover:stroke-blue-400"
              />
              <circle 
                cx={t.x} 
                cy={t.y} 
                r={isHighlighted ? "4.5" : "3"} 
                fill={color}
                stroke={isHighlighted ? "#ffffff" : "none"}
                strokeWidth="1.5"
                className="transition-all duration-200 group-hover:fill-blue-400"
              />
              {isHighlighted && (
                <circle cx={t.x} cy={t.y} r="8" fill="none" stroke="#22d3ee" strokeWidth="1.5" className="animate-ping" />
              )}
              {/* Invisible wider area for easier clicking */}
              <path 
                d={t.d} 
                fill="none" 
                stroke="transparent" 
                strokeWidth="12" 
                strokeLinecap="round"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default function SessionAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const [filter, setFilter] = useState("all");
  const [stationFilter, setStationFilter] = useState("all");
  const [shotData, setShotData] = useState<ShotData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShot, setSelectedShot] = useState<ShotData | null>(null);
  const [replayMode, setReplayMode] = useState<'photo' | 'video'>('photo');
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const overlayBoxRef = React.useRef<HTMLDivElement>(null);
  const overlayTextRef = React.useRef<HTMLSpanElement>(null);
  const requestRef = React.useRef<number>();

  useEffect(() => {
    const animate = () => {
      if (videoRef.current && replayMode === 'video' && selectedShot) {
        const vTime = videoRef.current.currentTime;
        
        if (selectedShot.tracking_data && selectedShot.tracking_data.length > 0 && overlayBoxRef.current) {
          const trackingData = selectedShot.tracking_data;
          let prevFrame = trackingData[0];
          let nextFrame = trackingData[trackingData.length - 1];
          
          if (vTime < trackingData[0].time) {
            nextFrame = trackingData[0];
          } else if (vTime > trackingData[trackingData.length - 1].time) {
            prevFrame = trackingData[trackingData.length - 1];
          } else {
            for (let i = 0; i < trackingData.length - 1; i++) {
              if (vTime >= trackingData[i].time && vTime <= trackingData[i+1].time) {
                prevFrame = trackingData[i];
                nextFrame = trackingData[i+1];
                break;
              }
            }
          }
          
          if (vTime >= trackingData[0].time && vTime <= trackingData[trackingData.length - 1].time) {
            // LEGACY FIX: Do not interpolate linearly! The camera recoil sweeps in a curve, 
            // causing interpolation to lag. Just snap to the active detected frame.
            let cx = prevFrame.clay_x;
            let cy = prevFrame.clay_y;
            // LEGACY FIX: Scale clay targets 2x for visibility
            let w = (prevFrame.width || 30) * 2.0;
            let h = (prevFrame.height || 20) * 2.0;
            
            overlayBoxRef.current.style.display = 'block';
            overlayBoxRef.current.style.left = `${(Number(cx) / (Number(prevFrame.crosshair_x) * 2)) * 100}%`;
            overlayBoxRef.current.style.top = `${(Number(cy) / (Number(prevFrame.crosshair_y) * 2)) * 100}%`;
            overlayBoxRef.current.style.width = `${(Number(w) / (Number(prevFrame.crosshair_x) * 2)) * 100}%`;
            overlayBoxRef.current.style.height = `${(Number(h) / (Number(prevFrame.crosshair_y) * 2)) * 100}%`;
            
            if (overlayTextRef.current) {
              overlayTextRef.current.innerText = `${prevFrame.class_name || 'Clay-targets'} ${(prevFrame.confidence || 0.9).toFixed(2)}`;
            }
          } else {
            overlayBoxRef.current.style.display = 'none';
          }
        }
      }
      requestRef.current = requestAnimationFrame(animate);
    };
    
    if (replayMode === 'video') {
      requestRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [replayMode, selectedShot]);
  
  const unwrappedParams = React.use(params);

  useEffect(() => {
    if (selectedShot) setReplayMode('photo');
  }, [selectedShot]);

  useEffect(() => {
    fetch(`http://localhost:8000/api/sessions/${unwrappedParams.id}/shots`)
      .then(res => res.json())
      .then(data => {
        setShotData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [unwrappedParams.id]);

  const filteredData = shotData.filter(d => 
    (filter === "all" || d.presentation === filter) &&
    (stationFilter === "all" || d.station === stationFilter)
  );
  const hits = filteredData.filter(d => d.type === "hit");
  const misses = filteredData.filter(d => d.type === "miss");

  const avgHitX = hits.length > 0 ? hits.reduce((acc, curr) => acc + curr.x, 0) / hits.length : 0;
  const avgHitY = hits.length > 0 ? hits.reduce((acc, curr) => acc + curr.y, 0) / hits.length : 0;

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-6 w-full pb-12"
    >
      {/* Top Header Row */}
      <motion.div variants={itemVariants} className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/sessions" className="p-2.5 glass-panel rounded-full hover:bg-white/10 transition-colors group">
            <ArrowLeft className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
          </Link>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30">
                Processed via AI
              </span>
              <span className="text-xs text-slate-500 font-medium tracking-wider uppercase">March 20, 2026</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white mb-1">Silver Dollar Club</h1>
            <p className="text-sm font-medium text-slate-400 flex items-center gap-2">
              <Crosshair className="w-4 h-4" /> 12 Gauge Trap Singles
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-6 mt-4 md:mt-0 flex-1">
          <TrapFieldSelector 
            selected={stationFilter} 
            highlighted={selectedShot?.station}
            onSelect={setStationFilter} 
          />
          <TrajectorySelector 
            selected={filter} 
            highlighted={selectedShot?.presentation}
            onSelect={setFilter} 
          />
        </div>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Left Col: Filters & Summaries */}
        <motion.div variants={itemVariants} className="flex flex-col gap-6">
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Activity className="w-24 h-24 text-blue-500" />
            </div>
            <h3 className="text-slate-400 font-medium text-sm tracking-wider uppercase mb-6 flex items-center gap-2">
               Session Telemetry
            </h3>
            <div className="space-y-6 relative z-10">
              <div>
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Hit Rate</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">{hits.length}</span>
                  <span className="text-xl font-medium text-slate-500">/ {shotData.length}</span>
                </div>
                <div className="mt-2 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: shotData.length > 0 ? `${(hits.length / shotData.length) * 100}%` : "0%" }}
                    transition={{ duration: 1.5, delay: 0.5, type: "spring" }}
                    className="h-full bg-gradient-to-r from-blue-600 to-sky-400"
                  />
                </div>
              </div>

              <div className="pt-6 border-t border-slate-700/50">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Break Centroid Offset</div>
                <div className="text-xl font-bold text-white tracking-tight">
                  <span className={avgHitX > 0 ? "text-amber-400" : "text-sky-400"}>{Math.abs(avgHitX).toFixed(1)}" {avgHitX > 0 ? 'Right' : 'Left'}</span>
                  <span className="text-slate-600 mx-2">×</span>
                  <span className="text-emerald-400">{avgHitY.toFixed(1)}" High</span>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-slate-400 font-medium text-sm tracking-wider uppercase mb-4 flex items-center gap-2">
               Filter Matrix
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">Presentation Angle</label>
                <div className="relative">
                  <select 
                    title="Select Presentation Filter"
                    className="w-full bg-slate-900/50 border border-slate-700/50 text-white rounded-xl p-3 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All Targets</option>
                    <option value="straight">Straightaway</option>
                    <option value="hard_left">Hard Left</option>
                    <option value="hard_right">Hard Right</option>
                    <option value="moderate_left">Moderate Left</option>
                    <option value="moderate_right">Moderate Right</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Center: Main Chart Area */}
        <motion.div variants={itemVariants} className="xl:col-span-3">
          <div className="glass-panel rounded-2xl p-6 h-full flex flex-col min-h-[600px] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-20" />
            
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold flex items-center gap-3 text-white">
                <Target className="w-5 h-5 text-sky-400" /> Shot Placement Matrix
              </h2>
              <div className="flex gap-4 text-xs font-bold uppercase tracking-wider">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" /> Break
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" /> Miss
                </div>
              </div>
            </div>
            
            {/* The Chart Background */}
            <div className="flex-1 w-full bg-[#0a0f1c] rounded-xl p-4 border border-slate-800/80 shadow-[inset_0_0_40px_rgba(0,0,0,0.5)] relative group cursor-crosshair">
              {/* Axis Labels */}
              <p className="absolute text-[10px] font-mono text-slate-500 top-2 left-1/2 -translate-x-1/2 uppercase tracking-widest">+ Vertical Offset (in)</p>
              <p className="absolute text-[10px] font-mono text-slate-500 bottom-2 left-1/2 -translate-x-1/2 uppercase tracking-widest">- Vertical Offset (in)</p>
              <p className="absolute text-[10px] font-mono text-slate-500 top-1/2 left-2 -translate-y-1/2 -rotate-90 uppercase tracking-widest">- Horiz (in)</p>
              <p className="absolute text-[10px] font-mono text-slate-500 top-1/2 right-2 translate-y-1/2 rotate-90 uppercase tracking-widest">+ Horiz (in)</p>
              
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e293b" opacity={0.6} horizontal={true} vertical={true} />
                  <XAxis type="number" dataKey="x" domain={[-10, 10]} stroke="#334155" tick={{fill: '#64748b', fontSize: 12}} axisLine={{stroke: '#334155'}} />
                  <YAxis type="number" dataKey="y" domain={[-6, 6]} stroke="#334155" tick={{fill: '#64748b', fontSize: 12}} axisLine={{stroke: '#334155'}} />
                  <ZAxis type="number" range={[150, 150]} />
                  <RechartsTooltip cursor={{strokeDasharray: '3 3', stroke: '#3b82f6'}} contentStyle={{"backgroundColor": "#0f172a", "borderColor": "#1e293b", "color": "white", "borderRadius": "12px", "boxShadow": "0 10px 25px rgba(0,0,0,0.5)"}} itemStyle={{"color": "#38bdf8"}} />
                  
                  {/* Crosshair Center */}
                  <ReferenceDot x={0} y={0} r={6} fill="#f43f5e" stroke="#fff" strokeWidth={2} label={{ position: 'top', value: 'ShotKam Center', fill: '#f43f5e', fontSize: 11, fontWeight: 700 }} />
                  <ReferenceDot x={0} y={0} r={12} fill="none" stroke="#f43f5e" strokeWidth={1} strokeOpacity={0.5} />
                  
                  {/* Break Zone Density Area */}
                  {hits.length > 0 && (
                    <ReferenceArea 
                      x1={avgHitX - 2.5} x2={avgHitX + 2.5} 
                      y1={avgHitY - 1.5} y2={avgHitY + 1.5} 
                      fill="url(#breakGradient)" stroke="rgba(56, 189, 248, 0.3)" strokeWidth={1} strokeDasharray="3 3"
                    />
                  )}
                  
                  {/* SVG Definitions for Gradients */}
                  <defs>
                    <radialGradient id="breakGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                    </radialGradient>
                  </defs>

                  {/* Scatter Data */}
                  <Scatter 
                    name="Successful Breaks" 
                    data={hits} 
                    fill="#34d399" 
                    shape={(props: any) => <TrajectoryDot {...props} onClickShot={setSelectedShot} anySelected={!!selectedShot} isSelected={selectedShot?.id === props?.payload?.id} />} 
                  />
                  <Scatter 
                    name="Missed Targets" 
                    data={misses} 
                    fill="#f43f5e" 
                    shape={(props: any) => <TrajectoryMiss {...props} onClickShot={setSelectedShot} anySelected={!!selectedShot} isSelected={selectedShot?.id === props?.payload?.id} />} 
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1 }}
              className="mt-6 p-5 glass-panel rounded-xl flex items-start gap-4 border-blue-500/20 bg-blue-900/10"
            >
              <div className="p-2 rounded-full bg-blue-500/20 text-blue-400 mt-0.5">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-white mb-1">AI Pipeline Insight</h4>
                <p className="text-sm text-slate-300 leading-relaxed font-light">
                  Your break centroid is anchored <strong>{Math.abs(avgHitX).toFixed(1)}" to the {avgHitX > 0 ? "Right": "Left"}</strong> and <strong>{avgHitY.toFixed(1)}" High</strong> relative to the crosshair. On misses, your pattern drifts erratically toward the extreme edges of the choke spread. Maintain smoother gun speed on <em>{filter === 'all' ? 'hard angles' : filter}</em>.
                </p>
              </div>
            </motion.div>
            
            {/* Selected Shot Image Video Panel */}
            {selectedShot && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-5 glass-panel rounded-xl flex flex-col gap-4 border-slate-700/50 relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-20" />
                <div className="flex justify-between items-center z-10">
                  <h4 className="font-semibold text-white flex items-center gap-2 tracking-tight">
                    <Video className="w-5 h-5 text-cyan-400" /> Shot Replay - <span className="capitalize">{selectedShot.presentation.replace('_', ' ')}</span>
                  </h4>
                  <div className="flex items-center gap-3">
                    <div className="flex bg-slate-800/80 rounded-full p-1 border border-white/5">
                      <button 
                        onClick={() => setReplayMode('photo')} 
                        className={`text-xs font-semibold uppercase tracking-wider px-4 py-1.5 rounded-full transition ${replayMode === 'photo' ? 'bg-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'text-slate-400 hover:text-white'}`}
                      >
                        Photo
                      </button>
                      <button 
                        onClick={() => setReplayMode('video')} 
                        className={`text-xs font-semibold uppercase tracking-wider px-4 py-1.5 rounded-full transition ${replayMode === 'video' ? 'bg-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'text-slate-400 hover:text-white'}`}
                      >
                        Video
                      </button>
                    </div>
                    <button onClick={() => setSelectedShot(null)} className="text-slate-400 hover:text-white text-xs font-semibold uppercase tracking-wider bg-slate-800/80 hover:bg-slate-700 transition px-3 py-1.5 rounded-full">
                      Close
                    </button>
                  </div>
                </div>
                <div className="w-full bg-slate-900 rounded-lg overflow-hidden flex flex-col items-center justify-center border border-slate-700/50 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] z-10 relative" style={{ height: '450px' }}>
                   <div 
                     className="relative bg-slate-900 rounded-lg overflow-hidden border border-slate-700 shadow-xl max-w-full"
                     style={{ 
                       width: '100%', 
                       // Ensure the container precisely matches the video's native ~1.78 aspect ratio horizontally or vertically
                       aspectRatio: selectedShot.tracking_data && selectedShot.tracking_data.length > 0 
                         ? `${selectedShot.tracking_data[0].crosshair_x * 2} / ${selectedShot.tracking_data[0].crosshair_y * 2}`
                         : '16/9',
                       maxHeight: '70vh'
                     }}
                   >
                     {replayMode === 'video' ? (
                       <video 
                         ref={videoRef}
                         src={`http://localhost:8000/api/videos/serve?path=${encodeURIComponent(selectedShot.video_path)}`} 
                         controls 
                         autoPlay 
                         muted
                         playsInline
                         className="absolute inset-0 w-full h-full object-contain"
                       />
                     ) : (
                       <img 
                         src={`http://localhost:8000/api/videos/frame?path=${encodeURIComponent(selectedShot.video_path)}&time_ms=${selectedShot.tracking_data && selectedShot.tracking_data.length > 0 ? Math.round(selectedShot.tracking_data[selectedShot.tracking_data.length - 1].time * 1000) : 1000}`}
                         alt="Shot Frame"
                         className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                       />
                     )}
                     
                     {/* Bounding Box Overlays */}
                     {(() => {
                       // We ONLY need React DOM rendering for the photo or static fallback!
                       // The hardware acceleration loop handles the 60fps video mapping directly above.
                       let baseCrosshairX = selectedShot.crosshair_x || (selectedShot.tracking_data && selectedShot.tracking_data.length > 0 ? selectedShot.tracking_data[0].crosshair_x : undefined);
                       let baseCrosshairY = selectedShot.crosshair_y || (selectedShot.tracking_data && selectedShot.tracking_data.length > 0 ? selectedShot.tracking_data[0].crosshair_y : undefined);
                       
                       return (
                         <>
                           {/* Global Crosshair Marker (Always Visible) */}
                           {baseCrosshairX !== undefined && baseCrosshairY !== undefined && baseCrosshairX > 0 && (
                             <div 
                               className="absolute rounded-full pointer-events-none z-20 flex items-center justify-center" 
                               style={{ 
                                 left: `${(baseCrosshairX / (baseCrosshairX * 2)) * 100}%`, 
                                 top: `${(baseCrosshairY / (baseCrosshairY * 2)) * 100}%`,
                                 transform: 'translate(-50%, -50%)',
                                 width: '10px', height: '10px'
                               }} 
                             >
                               <div className="w-[6px] h-[6px] bg-red-600 rounded-full" />
                             </div>
                           )}
                           
                           {/* Hardware Accelerated Video Bounding Box */}
                           {replayMode === 'video' && (
                             <div 
                               ref={overlayBoxRef}
                               className="absolute pointer-events-none z-20" 
                               style={{ transform: 'translate(-50%, -50%)', display: 'none' }} 
                             >
                               <div className="w-full h-full border-[1.5px] border-green-500 rounded-[1px] relative">
                                 <span 
                                   ref={overlayTextRef}
                                   className="absolute -top-[14px] left-[-1.5px] whitespace-nowrap text-[8px] text-green-500 font-mono font-bold bg-slate-900/60 px-0.5 rounded-sm"
                                 >
                                    Clay-targets 0.00
                                 </span>
                               </div>
                             </div>
                           )}
                           
                           {/* Static Photo Fallback */}
                           {replayMode === 'photo' && baseCrosshairX !== undefined && baseCrosshairY !== undefined && (
                              <div 
                                className="absolute pointer-events-none z-20" 
                                style={{ 
                                  left: `${(selectedShot.clay_x / (baseCrosshairX * 2)) * 100}%`, 
                                  top: `${(selectedShot.clay_y / (baseCrosshairY * 2)) * 100}%`,
                                  width: '48px',
                                  height: '32px',
                                  transform: 'translate(-50%, -50%)'
                                }} 
                              >
                                <div className="w-full h-full border-[1.5px] border-green-500 rounded-[1px] relative">
                                  <span className="absolute -top-[14px] left-[-1.5px] whitespace-nowrap text-[8px] text-green-500 font-mono font-bold bg-slate-900/60 px-0.5 rounded-sm">
                                    Clay-targets 0.65
                                  </span>
                                </div>
                              </div>
                           )}
                         </>
                       );
                     })()}
                   </div>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
        
        {/* Bottom Drilldown Row */}
        <motion.div variants={itemVariants} className="xl:col-span-4 mt-2">
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 text-white border-b border-white/10 pb-4">
              <Video className="w-5 h-5 text-indigo-400" /> Shot Trace Logs & Manual Override
            </h2>
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider"># Timeline</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Outcome</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Presentation</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Offset Coordinate</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredData.map((shot, idx) => (
                    <tr key={shot.id} className="hover:bg-white/5 transition-colors group">
                      <td className="px-4 py-4 font-mono text-sm text-slate-300">
                        <span className="text-slate-500 mr-2">{String(idx + 1).padStart(2, '0')}</span> 00:0{idx + 1}:24
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border
                          ${shot.type === 'hit' 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                          {shot.type}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300 font-medium capitalize">
                        {shot.presentation.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-400">
                        [X: {shot.x > 0 ? '+' : ''}{shot.x}, Y: {shot.y > 0 ? '+' : ''}{shot.y}]
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button 
                          onClick={() => setSelectedShot(shot)}
                          className="px-4 py-1.5 rounded-full text-xs font-semibold text-white bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all opacity-0 group-hover:opacity-100"
                        >
                          Review Frame
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

      </div>
    </motion.div>
  );
}
