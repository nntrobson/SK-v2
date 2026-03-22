"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { ArrowLeft, Target, Activity, Video, Crosshair, Sparkles } from "lucide-react";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";

interface OverlayBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OverlayBox {
  class_name: string;
  confidence?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  bbox?: OverlayBbox | null;
}

interface TrackingFrame {
  time: number;
  frame_idx: number;
  clay_x: number;
  clay_y: number;
  crosshair_x: number;
  crosshair_y: number;
  width?: number;
  height?: number;
  confidence?: number;
  class_name?: string | null;
  bbox?: OverlayBbox | null;
  overlay_boxes?: OverlayBox[];
  is_pretrigger_frame?: boolean;
}

interface ShotData {
  id: number;
  x: number;
  y: number;
  type: "hit" | "miss" | "unknown";
  break_label?: string | null;
  presentation: string;
  trajectory?: Array<{ x: number; y: number }>;
  video_id?: number;
  video_path: string;
  clay_x?: number;
  clay_y?: number;
  crosshair_x?: number;
  crosshair_y?: number;
  station?: string | null;
  confidence?: number | null;
  pretrigger_time?: number | null;
  pretrigger_frame_idx?: number | null;
  pretrigger_boxes?: OverlayBox[];
  overlay_validation_samples?: TrackingFrame[];
  tracking_data?: TrackingFrame[];
}

interface AveragePosition {
  x: number;
  y: number;
}

const OUTCOME_STYLES: Record<ShotData["type"], { color: string; label: string; badge: string }> = {
  hit: { color: "#34d399", label: "Break", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  miss: { color: "#f43f5e", label: "Miss", badge: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  unknown: { color: "#f59e0b", label: "Unknown", badge: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
};

const OVERLAY_CLASS_STYLES: Record<string, { border: string; text: string }> = {
  "clay-targets": { border: "border-emerald-400", text: "text-emerald-300" },
  "broken-clay": { border: "border-amber-400", text: "text-amber-300" },
  "trap-house": { border: "border-sky-400", text: "text-sky-300" },
  "trap-house-1-2": { border: "border-blue-400", text: "text-blue-300" },
  "trap-house-4-5": { border: "border-violet-400", text: "text-violet-300" },
};

function getAveragePosition(shots: ShotData[]): AveragePosition | null {
  if (shots.length === 0) {
    return null;
  }

  const totals = shots.reduce(
    (acc, shot) => ({
      x: acc.x + shot.x,
      y: acc.y + shot.y,
    }),
    { x: 0, y: 0 }
  );

  return {
    x: totals.x / shots.length,
    y: totals.y / shots.length,
  };
}

function normalizeBbox(box: OverlayBox): OverlayBbox | null {
  if (box.bbox) return box.bbox;
  if (
    typeof box.x !== "number" ||
    typeof box.y !== "number" ||
    typeof box.width !== "number" ||
    typeof box.height !== "number"
  ) {
    return null;
  }

  return {
    x: box.x - box.width / 2,
    y: box.y - box.height / 2,
    width: box.width,
    height: box.height,
  };
}

function formatClassLabel(className: string): string {
  return className.replace(/-/g, " ");
}

function formatStationLabel(station: string | null | undefined): string {
  if (!station) return "Unknown";
  if (station === "trap-house") return "Trap House 3";
  return formatClassLabel(station);
}

function getPhotoFrame(shot: ShotData | null): TrackingFrame | null {
  if (!shot?.tracking_data?.length) return null;
  return (
    shot.tracking_data.find((frame) => frame.is_pretrigger_frame) ??
    shot.tracking_data.find((frame) => frame.time === shot.pretrigger_time) ??
    shot.tracking_data[shot.tracking_data.length - 1]
  );
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateBbox(a: OverlayBbox, b: OverlayBbox, t: number): OverlayBbox {
  return {
    x: lerpNum(a.x, b.x, t),
    y: lerpNum(a.y, b.y, t),
    width: lerpNum(a.width, b.width, t),
    height: lerpNum(a.height, b.height, t),
  };
}

function interpolateOverlayBoxes(prevBoxes: OverlayBox[], nextBoxes: OverlayBox[], t: number): OverlayBox[] {
  if (!prevBoxes.length) return prevBoxes;
  if (!nextBoxes.length) return prevBoxes;

  const nextByClass = new Map<string, OverlayBox>();
  for (const box of nextBoxes) {
    const cn = (box.class_name ?? "").toLowerCase();
    if (!nextByClass.has(cn)) nextByClass.set(cn, box);
  }

  return prevBoxes.map((boxA) => {
    const cn = (boxA.class_name ?? "").toLowerCase();
    const boxB = nextByClass.get(cn);
    if (!boxB) return boxA;

    const bboxA = normalizeBbox(boxA);
    const bboxB = normalizeBbox(boxB);
    if (!bboxA || !bboxB) return boxA;

    return {
      ...boxA,
      confidence: lerpNum(boxA.confidence ?? 0, boxB.confidence ?? 0, t),
      bbox: interpolateBbox(bboxA, bboxB, t),
    };
  });
}

function getInterpolatedOverlayForTime(
  trackingData: TrackingFrame[] | undefined,
  currentTime: number,
): { frame: TrackingFrame | null; boxes: OverlayBox[] } {
  if (!trackingData?.length) return { frame: null, boxes: [] };

  let prevIdx = 0;
  for (let i = 0; i < trackingData.length; i++) {
    if (trackingData[i].time > currentTime) break;
    prevIdx = i;
  }

  const prev = trackingData[prevIdx];
  const prevBoxes = prev.overlay_boxes ?? [];

  if (prevIdx + 1 >= trackingData.length) {
    return { frame: prev, boxes: prevBoxes };
  }

  const next = trackingData[prevIdx + 1];
  const span = Math.max(next.time - prev.time, 0.001);
  const t = Math.min(1, Math.max(0, (currentTime - prev.time) / span));

  return {
    frame: prev,
    boxes: interpolateOverlayBoxes(prevBoxes, next.overlay_boxes ?? [], t),
  };
}

type AxisScale = { scale: (value: number) => number };
type TrajectoryShapeProps = {
  cx: number;
  cy: number;
  fill: string;
  payload: ShotData;
  xAxis?: AxisScale;
  yAxis?: AxisScale;
  onClickShot?: (shot: ShotData) => void;
  isSelected?: boolean;
  anySelected?: boolean;
};

const TrajectoryDot = (props: TrajectoryShapeProps) => {
  const { cx, cy, fill, payload, xAxis, yAxis, onClickShot, isSelected, anySelected } = props;
  
  const dots = [];
  if (payload.trajectory && payload.trajectory.length > 0 && xAxis && yAxis) {
    const scaleX = xAxis.scale;
    const scaleY = yAxis.scale;
    const denominator = Math.max(payload.trajectory.length - 1, 1);
    
    for (let i = 0; i < payload.trajectory.length; i++) {
      const pt = payload.trajectory[i];
      const px = scaleX(pt.x);
      const py = scaleY(pt.y);
      
      const t = i / denominator;
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

const TrajectoryMiss = (props: TrajectoryShapeProps) => {
  const { cx, cy, fill, payload, xAxis, yAxis, onClickShot, isSelected, anySelected } = props;
  
  const dots = [];
  if (payload.trajectory && payload.trajectory.length > 0 && xAxis && yAxis) {
    const scaleX = xAxis.scale;
    const scaleY = yAxis.scale;
    const denominator = Math.max(payload.trajectory.length - 1, 1);
    
    for (let i = 0; i < payload.trajectory.length; i++) {
        const pt = payload.trajectory[i];
        const px = scaleX(pt.x);
        const py = scaleY(pt.y);
        
        const t = i / denominator;
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

const TrajectoryUnknown = (props: TrajectoryShapeProps) => {
  const { cx, cy, fill, payload, xAxis, yAxis, onClickShot, isSelected, anySelected } = props;

  const dots = [];
  if (payload.trajectory && payload.trajectory.length > 0 && xAxis && yAxis) {
    const scaleX = xAxis.scale;
    const scaleY = yAxis.scale;
    const denominator = Math.max(payload.trajectory.length - 1, 1);

    for (let i = 0; i < payload.trajectory.length; i++) {
      const pt = payload.trajectory[i];
      const px = scaleX(pt.x);
      const py = scaleY(pt.y);

      const t = i / denominator;
      const radius = Math.max(0.5, 4 * t);
      const opacity = 0.45 * Math.pow(t, 1.25);

      dots.push(<circle key={`unknown-tail-${i}`} cx={px} cy={py} r={radius} fill={fill} fillOpacity={opacity} style={{ pointerEvents: "none" }} />);
    }
  }

  const opacity = anySelected ? (isSelected ? 1 : 0.25) : 1;

  return (
    <g onClick={() => onClickShot && onClickShot(payload)} className="cursor-pointer" style={{ opacity, transition: "opacity 0.3s" }}>
      {dots}
      <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={fill} stroke="#ffffff" strokeWidth={1.5} rx={2} />
      {isSelected && <circle cx={cx} cy={cy} r={20} fill="none" stroke="#ffffff" strokeWidth={2} className="animate-ping" />}
    </g>
  );
};

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
} satisfies Variants;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
} satisfies Variants;

const TrapHouseSelector = ({ selected, highlighted, onSelect }: { selected: string, highlighted?: string | null, onSelect: (s: string) => void }) => {
  const stations = [
    { id: "trap-house-1-2", cx: 22, cy: 34, label: "1-2" },
    { id: "trap-house", cx: 50, cy: 24, label: "3" },
    { id: "trap-house-4-5", cx: 78, cy: 34, label: "4-5" },
  ];

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Trap House</span>
      <svg width="110" height="72" viewBox="0 0 110 72" className="overflow-visible">
        <path d="M 16 56 Q 55 4 94 56" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="4 2" />
        <rect x="46" y="54" width="18" height="12" fill="#475569" rx="3" />

        {stations.map((s) => (
          <g
            key={s.id}
            onClick={() => onSelect(selected === s.id ? "all" : s.id)}
            className="cursor-pointer group"
          >
            <circle
              cx={s.cx}
              cy={s.cy}
              r={highlighted === s.id ? "10" : "9"}
              fill={highlighted === s.id ? "#22d3ee" : (selected === s.id || selected === "all" ? "#3b82f6" : "#1e293b")}
              stroke={highlighted === s.id ? "#ffffff" : (selected === s.id ? "#60a5fa" : "#334155")}
              strokeWidth={highlighted === s.id ? "2" : "1.5"}
              className="transition-all duration-200 group-hover:fill-blue-400 group-hover:stroke-blue-300"
            />
            {highlighted === s.id && (
              <circle cx={s.cx} cy={s.cy} r="14" fill="none" stroke="#22d3ee" strokeWidth="1.5" className="animate-ping" />
            )}
            <text
              x={s.cx}
              y={s.cy}
              textAnchor="middle"
              alignmentBaseline="central"
              fontSize="8"
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

const OverlayBoxes = ({
  boxes,
  crosshairX,
  crosshairY,
}: {
  boxes: OverlayBox[];
  crosshairX?: number;
  crosshairY?: number;
}) => {
  if (!crosshairX || !crosshairY) return null;

  return (
    <>
      {boxes.map((box, index) => {
        const bbox = normalizeBbox(box);
        if (!bbox) return null;
        const style = OVERLAY_CLASS_STYLES[box.class_name] ?? { border: "border-white/70", text: "text-white" };
        return (
          <div
            key={`${box.class_name}-${index}-${bbox.x}-${bbox.y}`}
            className="absolute pointer-events-none z-20"
            style={{
              left: `${(bbox.x / (crosshairX * 2)) * 100}%`,
              top: `${(bbox.y / (crosshairY * 2)) * 100}%`,
              width: `${(bbox.width / (crosshairX * 2)) * 100}%`,
              height: `${(bbox.height / (crosshairY * 2)) * 100}%`,
            }}
          >
            <div className={`relative h-full w-full rounded-[2px] border-[1.5px] ${style.border}`}>
              <span className={`absolute -top-5 left-0 whitespace-nowrap rounded-sm bg-slate-950/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold ${style.text}`}>
                {formatClassLabel(box.class_name)} {(box.confidence ?? 0).toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
};

interface ValidationCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

interface ValidationPackageInfo {
  spec_version?: string;
  video_filename?: string;
  validation_status?: string;
  validation_checks?: ValidationCheck[];
  review_video?: string;
  screenshots?: string[];
  station_prediction?: string;
  break_prediction?: string;
  trigger_time_ms?: number;
}

interface ValidationRun {
  run_dir?: string;
  packages?: ValidationPackageInfo[];
}

const CHECK_STATUS_STYLES: Record<string, string> = {
  pass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  fail: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  warn: "bg-amber-500/10 text-amber-300 border-amber-500/20",
};

const ValidationPanel = ({ shots }: { shots: ShotData[] }) => {
  const [runs, setRuns] = useState<ValidationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchRuns = () => {
    setLoading(true);
    fetch("http://localhost:8000/api/validation/packages")
      .then((res) => res.json())
      .then((data: ValidationRun[]) => setRuns(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetch("http://localhost:8000/api/validation/packages")
      .then((res) => res.json())
      .then((data: ValidationRun[]) => setRuns(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleGenerate = (videoId: number) => {
    setGenerating(videoId);
    fetch(`http://localhost:8000/api/validation/generate?video_id=${videoId}`, { method: "POST" })
      .then((res) => res.json())
      .then(() => {
        setTimeout(fetchRuns, 3000);
      })
      .catch(() => {})
      .finally(() => setGenerating(null));
  };

  const videoIds = [...new Set(shots.map((s) => s.video_id).filter(Boolean))] as number[];

  return (
    <motion.div variants={itemVariants} className="xl:col-span-4 mt-2">
      <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
        <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
          <h2 className="text-lg font-bold flex items-center gap-2 text-white">
            <Target className="w-5 h-5 text-cyan-400" /> Validation Packages
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchRuns}
              className="px-4 py-1.5 rounded-full text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
            >
              Refresh
            </button>
            {videoIds.map((vid) => (
              <button
                key={vid}
                onClick={() => handleGenerate(vid)}
                disabled={generating !== null}
                className="px-4 py-1.5 rounded-full text-xs font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all disabled:opacity-50"
              >
                {generating === vid ? "Generating..." : `Generate for Video ${vid}`}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="text-sm text-slate-400">Loading validation packages...</p>}

        {!loading && runs.length === 0 && (
          <p className="text-sm text-slate-500">No validation packages generated yet. Click Generate to create one.</p>
        )}

        {runs.map((run, runIdx) => {
          const runName = (run.run_dir ?? "").split("/").pop() ?? `run_${runIdx}`;
          return (
            <div key={runIdx} className="mb-4">
              <button
                onClick={() => setExpanded(expanded === runName ? null : runName)}
                className="w-full text-left px-4 py-3 rounded-xl bg-slate-800/50 hover:bg-slate-800/80 transition-colors flex items-center justify-between"
              >
                <span className="text-sm font-semibold text-white">{runName}</span>
                <span className="text-xs text-slate-400">{(run.packages ?? []).length} package(s)</span>
              </button>
              {expanded === runName && (
                <div className="mt-2 space-y-3 pl-4">
                  {(run.packages ?? []).map((pkg, pkgIdx) => {
                    const status = pkg.validation_status ?? "unknown";
                    const statusStyle = CHECK_STATUS_STYLES[status] ?? CHECK_STATUS_STYLES.warn;
                    return (
                      <div key={pkgIdx} className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold text-white">{pkg.video_filename ?? "Unknown clip"}</span>
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusStyle}`}>
                            {status}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mb-3">
                          <div>Station: <span className="text-white">{pkg.station_prediction ?? "-"}</span></div>
                          <div>Break: <span className="text-white">{pkg.break_prediction ?? "-"}</span></div>
                          <div>Trigger: <span className="text-white">{pkg.trigger_time_ms ? `${pkg.trigger_time_ms}ms` : "-"}</span></div>
                        </div>
                        {pkg.validation_checks && (
                          <div className="space-y-1">
                            {pkg.validation_checks.map((check, checkIdx) => (
                              <div key={checkIdx} className="flex items-center gap-2 text-xs">
                                <span className={`inline-block w-2 h-2 rounded-full ${check.status === "pass" ? "bg-emerald-400" : check.status === "fail" ? "bg-rose-400" : "bg-amber-400"}`} />
                                <span className="text-slate-300 font-mono">{check.name}</span>
                                <span className="text-slate-500 truncate flex-1">{check.detail}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default function SessionAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const [filter, setFilter] = useState("all");
  const [stationFilter, setStationFilter] = useState("all");
  const [shotData, setShotData] = useState<ShotData[]>([]);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedShot, setSelectedShot] = useState<ShotData | null>(null);
  const [replayMode, setReplayMode] = useState<"photo" | "video">("photo");
  const [activeOverlayFrame, setActiveOverlayFrame] = useState<TrackingFrame | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const videoOverlayContainerRef = useRef<HTMLDivElement>(null);
  
  // Categorization states
  const [isEditingSession, setIsEditingSession] = useState(false);
  const [editForm, setEditForm] = useState({ venue: "", date: "", type: "" });
  
  const [isCategorizeModalOpen, setIsCategorizeModalOpen] = useState(false);
  const [categorizeShotId, setCategorizeShotId] = useState<number | null>(null);
  const [newCategorizeName, setNewCategorizeName] = useState("");
  const [allSessions, setAllSessions] = useState<any[]>([]);
  
  const unwrappedParams = React.use(params);

  useEffect(() => {
    Promise.all([
      fetch(`http://localhost:8000/api/sessions/${unwrappedParams.id}/shots`).then(res => res.json()),
      fetch(`http://localhost:8000/api/sessions/${unwrappedParams.id}`).then(res => res.json())
    ])
      .then(([shots, info]) => {
        setShotData(shots);
        setSessionInfo(info);
        setEditForm({ 
          venue: info.venue || "", 
          date: info.date || "", 
          type: info.type || "" 
        });
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [unwrappedParams.id]);

  const handleUpdateSession = async () => {
    try {
      const res = await fetch(`http://localhost:8000/api/sessions/${unwrappedParams.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        setSessionInfo({ ...sessionInfo, ...editForm });
      }
    } catch (e) {
      console.error(e);
    }
    setIsEditingSession(false);
  };

  const openCategorizeModal = async (shot: ShotData) => {
    setCategorizeShotId(shot.id);
    setIsCategorizeModalOpen(true);
    setNewCategorizeName("");
    try {
      const res = await fetch("http://localhost:8000/api/sessions");
      if (res.ok) {
        const data = await res.json();
        setAllSessions(data.filter((s: any) => s.id !== parseInt(unwrappedParams.id)));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleMoveShot = async (targetSessionId: number | null, newName: string | null) => {
    if (!categorizeShotId) return;
    const shot = shotData.find(s => s.id === categorizeShotId);
    if (!shot) return;
    
    // In our backend, video_id is passed as part of the shot data
    const videoId = shot.video_id;
    if (!videoId) return;

    try {
      const payload = targetSessionId ? { session_id: targetSessionId } : { new_event_name: newName };
      const res = await fetch(`http://localhost:8000/api/videos/${videoId}/move`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        // Remove shot from current view
        setShotData(prev => prev.filter(s => s.id !== categorizeShotId));
        setIsCategorizeModalOpen(false);
        setCategorizeShotId(null);
        if (selectedShot?.id === categorizeShotId) {
          setSelectedShot(null);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectShot = (shot: ShotData) => {
    setSelectedShot(shot);
    setReplayMode("photo");
    setActiveOverlayFrame(getPhotoFrame(shot));
    lastVideoTimeRef.current = -1;
  };

  useEffect(() => {
    if (replayMode !== "video" || !selectedShot?.tracking_data?.length) {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
      return;
    }

    const overlayClassColors: Record<string, string> = {
      "clay-targets": "#34d399",
      "broken-clay": "#fbbf24",
      "trap-house": "#38bdf8",
      "trap-house-1-2": "#60a5fa",
      "trap-house-4-5": "#a78bfa",
    };

    const animate = () => {
      const video = videoRef.current;
      const container = videoOverlayContainerRef.current;
      if (!video || !container) {
        requestRef.current = requestAnimationFrame(animate);
        return;
      }

      const vTime = video.currentTime;
      if (Math.abs(vTime - lastVideoTimeRef.current) < 0.005) {
        requestRef.current = requestAnimationFrame(animate);
        return;
      }
      lastVideoTimeRef.current = vTime;

      const result = getInterpolatedOverlayForTime(selectedShot.tracking_data, vTime);
      const boxes = result.boxes;
      const cxHalf = selectedShot.tracking_data?.[0]?.crosshair_x;
      const cyHalf = selectedShot.tracking_data?.[0]?.crosshair_y;
      const fullW = cxHalf ? cxHalf * 2 : 1;
      const fullH = cyHalf ? cyHalf * 2 : 1;

      while (container.children.length > boxes.length) {
        container.removeChild(container.lastChild!);
      }
      while (container.children.length < boxes.length) {
        const wrapper = document.createElement("div");
        wrapper.style.position = "absolute";
        wrapper.style.pointerEvents = "none";
        wrapper.style.zIndex = "20";
        const inner = document.createElement("div");
        inner.style.width = "100%";
        inner.style.height = "100%";
        inner.style.borderWidth = "1.5px";
        inner.style.borderStyle = "solid";
        inner.style.borderRadius = "2px";
        inner.style.position = "relative";
        const label = document.createElement("span");
        label.style.position = "absolute";
        label.style.top = "-18px";
        label.style.left = "0";
        label.style.whiteSpace = "nowrap";
        label.style.fontSize = "9px";
        label.style.fontFamily = "monospace";
        label.style.fontWeight = "600";
        label.style.background = "rgba(2,6,23,0.8)";
        label.style.padding = "1px 4px";
        label.style.borderRadius = "2px";
        inner.appendChild(label);
        wrapper.appendChild(inner);
        container.appendChild(wrapper);
      }

      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        const bbox = normalizeBbox(box);
        const el = container.children[i] as HTMLDivElement;
        if (!bbox) {
          el.style.display = "none";
          continue;
        }
        const color = overlayClassColors[(box.class_name ?? "").toLowerCase()] ?? "#ffffff";
        el.style.display = "block";
        el.style.left = `${(bbox.x / fullW) * 100}%`;
        el.style.top = `${(bbox.y / fullH) * 100}%`;
        el.style.width = `${(bbox.width / fullW) * 100}%`;
        el.style.height = `${(bbox.height / fullH) * 100}%`;
        const inner = el.firstChild as HTMLDivElement;
        inner.style.borderColor = color;
        const label = inner.firstChild as HTMLSpanElement;
        label.style.color = color;
        label.textContent = `${(box.class_name ?? "").replace(/-/g, " ")} ${(box.confidence ?? 0).toFixed(2)}`;
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
      if (videoOverlayContainerRef.current) {
        videoOverlayContainerRef.current.innerHTML = "";
      }
    };
  }, [replayMode, selectedShot]);

  const filteredData = shotData.filter(d => 
    (filter === "all" || d.presentation === filter) &&
    (stationFilter === "all" || d.station === stationFilter)
  );
  const hits = filteredData.filter(d => d.type === "hit");
  const misses = filteredData.filter(d => d.type === "miss");
  const unknowns = filteredData.filter(d => d.type === "unknown");

  const averageVisiblePosition = getAveragePosition(filteredData);
  const averageHitPosition = getAveragePosition(hits);
  const photoFrame = selectedShot ? getPhotoFrame(selectedShot) : null;
  const activeFrame = replayMode === "video" ? activeOverlayFrame : photoFrame;
  const overlayBoxes = replayMode === "photo"
    ? (selectedShot?.pretrigger_boxes?.length
        ? selectedShot.pretrigger_boxes
        : photoFrame?.overlay_boxes ?? [])
    : [];
  const baseCrosshairX = activeFrame?.crosshair_x ?? selectedShot?.crosshair_x ?? selectedShot?.tracking_data?.[0]?.crosshair_x;
  const baseCrosshairY = activeFrame?.crosshair_y ?? selectedShot?.crosshair_y ?? selectedShot?.tracking_data?.[0]?.crosshair_y;
  const overlayAspectRatio = selectedShot?.tracking_data?.length
    ? `${selectedShot.tracking_data[0].crosshair_x * 2} / ${selectedShot.tracking_data[0].crosshair_y * 2}`
    : "16/9";

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-8 text-sm text-slate-300">
        Loading session telemetry...
      </div>
    );
  }

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
            {isEditingSession ? (
              <div className="flex flex-col gap-3 glass-panel p-4 rounded-xl mb-4 border-blue-500/30 w-full max-w-lg">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Event / Location</label>
                  <input 
                    type="text" 
                    value={editForm.venue}
                    onChange={(e) => setEditForm({...editForm, venue: e.target.value})}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    placeholder="e.g. Silver Dollar Club"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Date</label>
                  <input 
                    type="text" 
                    value={editForm.date}
                    onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    placeholder="e.g. Mar 21, 2026 or 2026-03-21"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Discipline / Type</label>
                  <input 
                    type="text" 
                    value={editForm.type}
                    onChange={(e) => setEditForm({...editForm, type: e.target.value})}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    placeholder="e.g. Trap Singles"
                  />
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <button onClick={() => setIsEditingSession(false)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
                  <button onClick={handleUpdateSession} className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors">Save Details</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-1">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    Processed via AI
                  </span>
                  <span className="text-xs text-slate-500 font-medium tracking-wider uppercase">{sessionInfo?.date || "Loading..."}</span>
                </div>
                <h1 
                  className="text-3xl font-extrabold tracking-tight text-white mb-1 cursor-pointer hover:text-blue-400 transition-colors flex items-center gap-2 group w-fit"
                  onClick={() => setIsEditingSession(true)}
                  title="Click to edit session details"
                >
                  {sessionInfo?.venue || "Loading Event..."}
                  <span className="opacity-0 group-hover:opacity-100 text-sm text-blue-500 transition-opacity">(edit)</span>
                </h1>
                <p className="text-sm font-medium text-slate-400 flex items-center gap-2">
                  <Crosshair className="w-4 h-4" /> {sessionInfo?.type || "Loading Type..."}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-6 mt-4 md:mt-0 flex-1">
          <TrapHouseSelector 
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
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Break Rate</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">{hits.length}</span>
                  <span className="text-xl font-medium text-slate-500">/ {filteredData.length}</span>
                </div>
                <div className="mt-2 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: filteredData.length > 0 ? `${(hits.length / filteredData.length) * 100}%` : "0%" }}
                    transition={{ duration: 1.5, delay: 0.5, type: "spring" }}
                    className="h-full bg-gradient-to-r from-blue-600 to-sky-400"
                  />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs uppercase tracking-wider">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-emerald-300">
                    <div className="font-bold">{hits.length}</div>
                    <div className="text-[10px] text-emerald-200/80">Break</div>
                  </div>
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-rose-300">
                    <div className="font-bold">{misses.length}</div>
                    <div className="text-[10px] text-rose-200/80">Miss</div>
                  </div>
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-300">
                    <div className="font-bold">{unknowns.length}</div>
                    <div className="text-[10px] text-amber-200/80">Unknown</div>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-700/50">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Break Centroid Offset</div>
                {averageHitPosition ? (
                  <div className="text-xl font-bold text-white tracking-tight">
                    <span className={averageHitPosition.x > 0 ? "text-amber-400" : "text-sky-400"}>{Math.abs(averageHitPosition.x).toFixed(1)}&quot; {averageHitPosition.x > 0 ? 'Right' : 'Left'}</span>
                    <span className="text-slate-600 mx-2">×</span>
                    <span className="text-emerald-400">{averageHitPosition.y.toFixed(1)}&quot; High</span>
                  </div>
                ) : (
                  <div className="text-sm font-medium text-slate-400">No successful breaks in the current filter.</div>
                )}
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
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" /> Unknown
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="relative block h-3 w-3">
                    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                    <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
                  </span>
                  Avg Visible
                </div>
              </div>
            </div>
            
            {/* The Chart Background */}
            <div className="flex-1 min-h-[400px] w-full bg-[#0a0f1c] rounded-xl p-4 border border-slate-800/80 shadow-[inset_0_0_40px_rgba(0,0,0,0.5)] relative group cursor-crosshair">
              {/* Axis Labels */}
              <p className="absolute text-[10px] font-mono text-slate-500 top-2 left-1/2 -translate-x-1/2 uppercase tracking-widest">+ Vertical Offset (in)</p>
              <p className="absolute text-[10px] font-mono text-slate-500 bottom-2 left-1/2 -translate-x-1/2 uppercase tracking-widest">- Vertical Offset (in)</p>
              <p className="absolute text-[10px] font-mono text-slate-500 top-1/2 left-2 -translate-y-1/2 -rotate-90 uppercase tracking-widest">- Horiz (in)</p>
              <p className="absolute text-[10px] font-mono text-slate-500 top-1/2 right-2 translate-y-1/2 rotate-90 uppercase tracking-widest">+ Horiz (in)</p>
              
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e293b" opacity={0.6} horizontal={true} vertical={true} />
                  <XAxis type="number" dataKey="x" domain={[-10, 10]} stroke="#334155" tick={{fill: '#64748b', fontSize: 12}} axisLine={{stroke: '#334155'}} />
                  <YAxis type="number" dataKey="y" domain={[-6, 6]} stroke="#334155" tick={{fill: '#64748b', fontSize: 12}} axisLine={{stroke: '#334155'}} />
                  <ZAxis type="number" range={[150, 150]} />
                  <RechartsTooltip cursor={{strokeDasharray: '3 3', stroke: '#3b82f6'}} contentStyle={{"backgroundColor": "#0f172a", "borderColor": "#1e293b", "color": "white", "borderRadius": "12px", "boxShadow": "0 10px 25px rgba(0,0,0,0.5)"}} itemStyle={{"color": "#38bdf8"}} />
                  
                  {/* Crosshair Center */}
                  <ReferenceDot x={0} y={0} r={6} fill="#f43f5e" stroke="#fff" strokeWidth={2} label={{ position: 'top', value: 'ShotKam Center', fill: '#f43f5e', fontSize: 11, fontWeight: 700 }} />
                  <ReferenceDot x={0} y={0} r={12} fill="none" stroke="#f43f5e" strokeWidth={1} strokeOpacity={0.5} />

                  {/* Average guides for all currently visible shots */}
                  {averageVisiblePosition && (
                    <>
                      <ReferenceLine
                        x={averageVisiblePosition.x}
                        stroke="#fbbf24"
                        strokeWidth={1.5}
                        strokeDasharray="6 6"
                        strokeOpacity={0.8}
                      />
                      <ReferenceLine
                        y={averageVisiblePosition.y}
                        stroke="#22d3ee"
                        strokeWidth={1.5}
                        strokeDasharray="6 6"
                        strokeOpacity={0.8}
                      />
                      <ReferenceDot
                        x={averageVisiblePosition.x}
                        y={averageVisiblePosition.y}
                        r={5}
                        fill="#e2e8f0"
                        stroke="#0f172a"
                        strokeWidth={2}
                      />
                    </>
                  )}
                  
                  {/* Break Zone Density Area */}
                  {averageHitPosition && (
                    <ReferenceArea 
                      x1={averageHitPosition.x - 2.5} x2={averageHitPosition.x + 2.5} 
                      y1={averageHitPosition.y - 1.5} y2={averageHitPosition.y + 1.5} 
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
                    shape={(props: unknown) => <TrajectoryDot {...(props as TrajectoryShapeProps)} onClickShot={handleSelectShot} anySelected={!!selectedShot} isSelected={selectedShot?.id === (props as TrajectoryShapeProps).payload?.id} />} 
                  />
                  <Scatter 
                    name="Missed Targets" 
                    data={misses} 
                    fill="#f43f5e" 
                    shape={(props: unknown) => <TrajectoryMiss {...(props as TrajectoryShapeProps)} onClickShot={handleSelectShot} anySelected={!!selectedShot} isSelected={selectedShot?.id === (props as TrajectoryShapeProps).payload?.id} />} 
                  />
                  <Scatter 
                    name="Unknown Outcome" 
                    data={unknowns} 
                    fill="#f59e0b" 
                    shape={(props: unknown) => <TrajectoryUnknown {...(props as TrajectoryShapeProps)} onClickShot={handleSelectShot} anySelected={!!selectedShot} isSelected={selectedShot?.id === (props as TrajectoryShapeProps).payload?.id} />} 
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            
            
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
                <div className="grid gap-3 text-xs uppercase tracking-wider text-slate-300 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
                    <div className="text-slate-500">Outcome</div>
                    <div className="mt-1 font-semibold text-white">{OUTCOME_STYLES[selectedShot.type].label}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
                    <div className="text-slate-500">Location</div>
                    <div className="mt-1 font-semibold text-white">{formatStationLabel(selectedShot.station)}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
                    <div className="text-slate-500">Pre-trigger</div>
                    <div className="mt-1 font-semibold text-white">
                      {selectedShot.pretrigger_time !== null && selectedShot.pretrigger_time !== undefined
                        ? `${selectedShot.pretrigger_time.toFixed(3)}s`
                        : "Unavailable"}
                    </div>
                  </div>
                </div>
                <div className="w-full bg-slate-900 rounded-lg overflow-hidden flex flex-col items-center justify-center border border-slate-700/50 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] z-10 relative" style={{ height: "450px" }}>
                  <div
                    className="relative bg-slate-900 rounded-lg overflow-hidden border border-slate-700 shadow-xl max-w-full"
                    style={{
                      width: "100%",
                      aspectRatio: overlayAspectRatio,
                      maxHeight: "70vh",
                    }}
                  >
                    {replayMode === "video" ? (
                      <video
                        ref={videoRef}
                        src={`http://localhost:8000/api/videos/serve?path=${encodeURIComponent(selectedShot.video_path)}`}
                        controls
                        autoPlay
                        muted
                        playsInline
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                    ) : (
                      <img
                        src={`http://localhost:8000/api/videos/frame?path=${encodeURIComponent(selectedShot.video_path)}&time_ms=${Math.round((selectedShot.pretrigger_time ?? photoFrame?.time ?? 1) * 1000)}`}
                        alt="Pre-trigger frame"
                        className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                      />
                    )}

                    {replayMode === "video" ? (
                      <div ref={videoOverlayContainerRef} className="absolute inset-0 pointer-events-none z-20" />
                    ) : (
                      <OverlayBoxes boxes={overlayBoxes} crosshairX={baseCrosshairX} crosshairY={baseCrosshairY} />
                    )}
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
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right w-20">Organize</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredData.map((shot, idx) => (
                    <tr key={shot.id} className="hover:bg-white/5 transition-colors group">
                      <td className="px-4 py-4 font-mono text-sm text-slate-300">
                        <span className="text-slate-500 mr-2">{String(idx + 1).padStart(2, '0')}</span> 00:0{idx + 1}:24
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${OUTCOME_STYLES[shot.type].badge}`}>
                          {OUTCOME_STYLES[shot.type].label}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-300 font-medium capitalize">
                        <div>{shot.presentation.replace('_', ' ')}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{formatStationLabel(shot.station)}</div>
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-400">
                        [X: {shot.x > 0 ? '+' : ''}{shot.x}, Y: {shot.y > 0 ? '+' : ''}{shot.y}]
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button 
                          onClick={() => handleSelectShot(shot)}
                          className="px-4 py-1.5 rounded-full text-xs font-semibold text-white bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all opacity-0 group-hover:opacity-100"
                        >
                          Review Overlay
                        </button>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button 
                          onClick={() => openCategorizeModal(shot)}
                          className="px-4 py-1.5 rounded-full text-xs font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all opacity-0 group-hover:opacity-100"
                        >
                          Move
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

        <ValidationPanel shots={shotData} />

      </div>

      {isCategorizeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl relative">
            <h3 className="text-xl font-bold text-white mb-4">Move Video to Event</h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Create New Event</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Event Name (e.g. State Championship)"
                    value={newCategorizeName}
                    onChange={(e) => setNewCategorizeName(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button 
                    onClick={() => handleMoveShot(null, newCategorizeName)}
                    disabled={!newCategorizeName.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-sm transition-colors"
                  >
                    Move
                  </button>
                </div>
              </div>

              {allSessions.length > 0 && (
                <>
                  <div className="relative flex items-center py-2">
                    <div className="flex-grow border-t border-slate-800"></div>
                    <span className="flex-shrink-0 mx-4 text-xs font-semibold text-slate-500 uppercase">Or existing event</span>
                    <div className="flex-grow border-t border-slate-800"></div>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                    {allSessions.map(session => (
                      <button
                        key={session.id}
                        onClick={() => handleMoveShot(session.id, null)}
                        className="w-full text-left px-4 py-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-transparent hover:border-slate-600 transition-colors flex items-center justify-between group"
                      >
                        <div>
                          <div className="text-white font-medium">{session.venue}</div>
                          <div className="text-xs text-slate-400">{session.date} • {session.type}</div>
                        </div>
                        <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">Select &rarr;</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button 
              onClick={() => setIsCategorizeModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
