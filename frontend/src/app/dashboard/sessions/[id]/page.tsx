"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Customized,
} from "recharts";
import { ArrowLeft, Target, Activity, Video, Crosshair, Sparkles, SlidersHorizontal, Trash2, X } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, type Variants, AnimatePresence } from "framer-motion";
import {
  describeHorizontalOffset,
  describeVerticalOffset,
  getHorizontalMeaningForPresentation,
  getShotPatternSummary,
  type AveragePosition,
} from "./shot-placement-insights";
import {
  formatClipOffset,
  getShotTraceDateLabel,
  getShotTraceShotLabel,
  getShotTraceTimeLabel,
} from "./shot-trace-timestamps";

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

interface SessionInfo {
  id: number;
  venue: string | null;
  date: string | null;
  type: string | null;
}

const OUTCOME_STYLES: Record<ShotData["type"], { color: string; label: string; badge: string }> = {
  hit: { color: "#34d399", label: "Break", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  miss: { color: "#f43f5e", label: "Miss", badge: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  unknown: { color: "#f59e0b", label: "Unknown", badge: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
};

const OVERLAY_CLASS_STYLES: Record<string, { border: string; text: string }> = {
  "clay-targets": { border: "border-orange-500", text: "text-orange-400" },
  "broken-clay": { border: "border-orange-500", text: "text-orange-400" },
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

function formatPresentationFilterLabel(filter: string): string {
  if (filter === "all") return "All targets";
  if (filter === "straight") return "Straightaway";
  return filter.replace(/_/g, " ");
}

const PRESENTATION_OPTIONS = [
  { value: "straight", label: "Straightaway" },
  { value: "hard_left", label: "Hard left" },
  { value: "hard_right", label: "Hard right" },
  { value: "moderate_left", label: "Moderate left" },
  { value: "moderate_right", label: "Moderate right" },
] as const;

const STATION_OPTIONS = [
  { value: "trap-house-1-2", label: "Posts 1–2" },
  { value: "trap-house", label: "Post 3 (house)" },
  { value: "trap-house-4-5", label: "Posts 4–5" },
  { value: "unknown", label: "Unknown" },
] as const;

const KNOWN_TRAP_STATIONS = new Set(["trap-house-1-2", "trap-house", "trap-house-4-5"]);

function stationOptionIsActive(station: string | null | undefined, optionValue: string): boolean {
  const s = (station ?? "").trim().toLowerCase();
  if (optionValue === "unknown") {
    return !s || s === "unknown" || !KNOWN_TRAP_STATIONS.has(s);
  }
  return s === optionValue;
}

/**
 * One domain for both axes from max(|x|, |y|) so horizontal and vertical scales match:
 * with a square plot area, one data unit is the same pixel distance on X and Y (“crosshair units”).
 */
function getProportionalSymmetricDomain(
  shots: ShotData[],
  minimumExtent: number = 10,
  padding: number,
): [number, number] {
  if (shots.length === 0) {
    return [-minimumExtent, minimumExtent];
  }

  let maxAbs = shots.reduce(
    (m, shot) => Math.max(m, Math.abs(shot.x), Math.abs(shot.y)),
    0,
  );
  for (const shot of shots) {
    if (shot.trajectory) {
      for (const pt of shot.trajectory) {
        maxAbs = Math.max(maxAbs, Math.abs(pt.x), Math.abs(pt.y));
      }
    }
  }
  const extent = Math.max(minimumExtent, Math.ceil((maxAbs + padding) * 2) / 2);
  
  // Enforce a strict 1:1 scale (X scale = Y scale) by returning exactly symmetric bounds.
  // The scatter plot area must be exactly square (aspect-square) for this to map 1 unit = 1 pixel linearly on both axes
  return [-extent, extent];
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

/** Thin red + at chart origin (0,0) — frame-center reference; pixel coords from ReferenceDot. */
function BeadCenterCrosshairShape(props: { cx?: number; cy?: number }) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  const arm = 12;
  const strokeW = 1.35;
  return (
    <g className="pointer-events-none">
      <line
        x1={cx - arm}
        y1={cy}
        x2={cx + arm}
        y2={cy}
        stroke="#dc2626"
        strokeWidth={strokeW}
        strokeLinecap="square"
      />
      <line
        x1={cx}
        y1={cy - arm}
        x2={cx}
        y2={cy + arm}
        stroke="#dc2626"
        strokeWidth={strokeW}
        strokeLinecap="square"
      />
    </g>
  );
}

function buildTrailElements(
  prefix: string,
  trajectory: Array<{ x: number; y: number }> | undefined,
  xAxis: { scale: (v: number) => number } | undefined,
  yAxis: { scale: (v: number) => number } | undefined,
  fill: string,
  anySelected: boolean | undefined,
  isSelected: boolean | undefined,
): React.ReactNode[] {
  if (!trajectory || trajectory.length < 2 || !xAxis || !yAxis) return [];
  const scaleX = xAxis.scale;
  const scaleY = yAxis.scale;
  const denominator = Math.max(trajectory.length - 1, 1);
  const trailOpacityMul = anySelected && !isSelected ? 0.15 : 1;

  const elements: React.ReactNode[] = [];

  const linePoints = trajectory.map((pt) => `${scaleX(pt.x)},${scaleY(pt.y)}`).join(" ");
  elements.push(
    <polyline
      key={`${prefix}-line`}
      points={linePoints}
      fill="none"
      stroke={fill}
      strokeWidth={1}
      strokeOpacity={0.18 * trailOpacityMul}
      style={{ pointerEvents: "none" }}
    />
  );

  for (let i = 0; i < trajectory.length; i++) {
    const pt = trajectory[i];
    const px = scaleX(pt.x);
    const py = scaleY(pt.y);
    const t = i / denominator;
    const radius = Math.max(1.25, 3.25 * t);
    const opacity = 0.35 * Math.pow(t, 1.3) * trailOpacityMul;
    elements.push(<circle key={`${prefix}-${i}`} cx={px} cy={py} r={radius} fill={fill} fillOpacity={opacity} style={{ pointerEvents: "none" }} />);
  }
  return elements;
}

const TrajectoryDot = React.memo((props: TrajectoryShapeProps) => {
  const { cx, cy, fill, payload, xAxis, yAxis, onClickShot, isSelected, anySelected } = props;

  const dots = buildTrailElements("tail", payload.trajectory, xAxis, yAxis, fill, anySelected, isSelected);

  const opacity = anySelected ? (isSelected ? 1 : 0.25) : 1;

  return (
    <g onClick={() => onClickShot && onClickShot(payload)} className="cursor-pointer" style={{ opacity, transition: "opacity 0.3s" }}>
      {dots}
      <circle cx={cx} cy={cy} r={11} fill={fill} fillOpacity={0.12} />
      <circle
        cx={cx}
        cy={cy}
        r={6.5}
        fill={fill}
        fillOpacity={0.92}
        stroke="rgba(15,23,42,0.65)"
        strokeWidth={1.15}
      />
      <circle cx={cx} cy={cy} r={2.4} fill="#a7f3d0" fillOpacity={0.95} />
    </g>
  );
});
TrajectoryDot.displayName = "TrajectoryDot";

const TrajectoryMiss = React.memo((props: TrajectoryShapeProps) => {
  const { cx, cy, fill, payload, xAxis, yAxis, onClickShot, isSelected, anySelected } = props;

  const dots = buildTrailElements("miss-tail", payload.trajectory, xAxis, yAxis, "#94a3b8", anySelected, isSelected);

  const opacity = anySelected ? (isSelected ? 1 : 0.25) : 1;

  return (
    <g onClick={() => onClickShot && onClickShot(payload)} className="cursor-pointer" style={{ opacity, transition: "opacity 0.3s" }}>
      {dots}
      <circle cx={cx} cy={cy} r={11} fill={fill} fillOpacity={0.08} stroke="rgba(15,23,42,0.55)" strokeWidth={1} />
      <line x1={cx - 5.25} y1={cy - 5.25} x2={cx + 5.25} y2={cy + 5.25} stroke={fill} strokeWidth={2.75} strokeLinecap="round" />
      <line x1={cx + 5.25} y1={cy - 5.25} x2={cx - 5.25} y2={cy + 5.25} stroke={fill} strokeWidth={2.75} strokeLinecap="round" />
    </g>
  );
});
TrajectoryMiss.displayName = "TrajectoryMiss";

const TrajectoryUnknown = React.memo((props: TrajectoryShapeProps) => {
  const { cx, cy, fill, payload, xAxis, yAxis, onClickShot, isSelected, anySelected } = props;

  const dots = buildTrailElements("unknown-tail", payload.trajectory, xAxis, yAxis, fill, anySelected, isSelected);

  const opacity = anySelected ? (isSelected ? 1 : 0.25) : 1;

  return (
    <g onClick={() => onClickShot && onClickShot(payload)} className="cursor-pointer" style={{ opacity, transition: "opacity 0.3s" }}>
      {dots}
      <rect
        x={cx - 6}
        y={cy - 6}
        width={12}
        height={12}
        fill={fill}
        fillOpacity={0.22}
        stroke="rgba(15,23,42,0.6)"
        strokeWidth={1.15}
        rx={2}
        transform={`rotate(45 ${cx} ${cy})`}
      />
      <circle cx={cx} cy={cy} r={2.25} fill="#fde68a" fillOpacity={0.95} />
    </g>
  );
});
TrajectoryUnknown.displayName = "TrajectoryUnknown";

const ShotPlacementTooltip = React.memo(({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ShotData }>;
}) => {
  if (!active || !payload?.length) {
    return null;
  }

  const shot = payload[0].payload;
  const outcome = OUTCOME_STYLES[shot.type];

  return (
    <div className="min-w-[220px] rounded-2xl border border-slate-700/80 bg-slate-950/95 p-4 shadow-[0_20px_45px_rgba(2,6,23,0.75)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${outcome.badge}`}>
          {outcome.label}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {formatPresentationFilterLabel(shot.presentation)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
          <div className="uppercase tracking-[0.16em] text-slate-500">Horizontal</div>
          <div className="mt-1 text-sm font-semibold text-white">{describeHorizontalOffset(shot.x)}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
          <div className="uppercase tracking-[0.16em] text-slate-500">Vertical</div>
          <div className="mt-1 text-sm font-semibold text-white">{describeVerticalOffset(shot.y)}</div>
        </div>
      </div>
      <div className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Target offset from frame center at the shot (same reference as the chart origin).
        {shot.station ? ` Station: ${formatStationLabel(shot.station)}.` : ""}
      </div>
    </div>
  );
});
ShotPlacementTooltip.displayName = "ShotPlacementTooltip";

function computeParabolicProjection(
  trajectory: Array<{ x: number; y: number }>,
  station?: string | null,
): Array<{ x: number; y: number }> | null {
  if (!trajectory || trajectory.length < 3) return null;

  const rawXs = trajectory.map((p) => p.x);
  const rawYs = trajectory.map((p) => p.y);
  const x0 = rawXs[0], y0 = rawYs[0];
  let xsN = rawXs.map((x) => x - x0);
  const ysN = rawYs.map((y) => y - y0);

  if (station === "trap-house-1-2") xsN = xsN.map((x) => x - 3.5);
  else if (station === "trap-house-4-5") xsN = xsN.map((x) => x + 3.5);

  const n = ysN.length;
  let sy = 0, sy2 = 0, sy3 = 0, sy4 = 0, sx = 0, sxy = 0, sxy2 = 0;
  for (let i = 0; i < n; i++) {
    const y = ysN[i], x = xsN[i];
    sy += y; sy2 += y * y; sy3 += y * y * y; sy4 += y * y * y * y;
    sx += x; sxy += x * y; sxy2 += x * y * y;
  }
  const det = n * (sy2 * sy4 - sy3 * sy3) - sy * (sy * sy4 - sy2 * sy3) + sy2 * (sy * sy3 - sy2 * sy2);
  if (Math.abs(det) < 1e-12) return null;

  const a = (sx * (sy2 * sy4 - sy3 * sy3) - sxy * (sy * sy4 - sy2 * sy3) + sxy2 * (sy * sy3 - sy2 * sy2)) / det;
  const b = (n * (sxy * sy4 - sxy2 * sy3) - sy * (sx * sy4 - sxy2 * sy2) + sy2 * (sx * sy3 - sxy * sy2)) / det;
  const c = (n * (sy2 * sxy2 - sy3 * sxy) - sy * (sy * sxy2 - sy3 * sx) + sy2 * (sy * sxy - sy2 * sx)) / det;

  const yMin = Math.min(...ysN) - 2;
  const yMax = Math.max(...ysN) + 2;
  const steps = 60;
  const points: Array<{ x: number; y: number }> = [];
  for (let s = 0; s <= steps; s++) {
    const yy = yMin + (yMax - yMin) * (s / steps);
    let xx = a * yy * yy + b * yy + c;
    if (station === "trap-house-1-2") xx += 3.5;
    else if (station === "trap-house-4-5") xx -= 3.5;
    points.push({ x: xx + x0, y: yy + y0 });
  }
  return points;
}

const ProjectionLine = ({ selectedShot, xAxisMap, yAxisMap }: { selectedShot: ShotData | null; xAxisMap?: Record<string, { scale: (v: number) => number }>; yAxisMap?: Record<string, { scale: (v: number) => number }> }) => {
  if (!selectedShot?.trajectory?.length || !xAxisMap || !yAxisMap) return null;
  const xAxis = Object.values(xAxisMap)[0];
  const yAxis = Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;

  const projPts = computeParabolicProjection(selectedShot.trajectory, selectedShot.station);
  if (!projPts || projPts.length < 2) return null;

  const d = projPts
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAxis.scale(p.x)},${yAxis.scale(p.y)}`)
    .join(" ");

  return (
    <path d={d} fill="none" stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.6} />
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

const TrapHouseSelector = ({
  selected,
  highlighted,
  onSelect,
  compact = false,
  relaxed = false,
  shotCounts,
}: {
  selected: string;
  highlighted?: string | null;
  onSelect: (s: string) => void;
  compact?: boolean;
  relaxed?: boolean;
  /** Session shot totals per station id (e.g. trap-house-1-2). */
  shotCounts?: Record<string, number>;
}) => {
  const stations = [
    { id: "trap-house-1-2", cx: 23, cy: 36, label: "1-2" },
    { id: "trap-house", cx: 50, cy: 25, label: "3" },
    { id: "trap-house-4-5", cx: 77, cy: 36, label: "4-5" },
  ];

  const w = compact ? 88 : relaxed ? 158 : 110;
  const h = compact ? 50 : relaxed ? 102 : 72;
  const countFont = compact ? "4.5" : relaxed ? "6" : "5.5";
  const labelFont = compact ? "5.5" : relaxed ? "7" : "6.5";

  return (
    <div className={`flex flex-col items-center ${compact ? "max-h-[4.75rem] justify-end gap-0" : "gap-2"}`}>
      <span
        className={`font-bold uppercase tracking-widest text-slate-500 ${compact ? "mb-0.5 text-[9px] leading-none" : "mb-0 text-[10px]"}`}
      >
        Trap House
      </span>
      <svg width={w} height={h} viewBox="0 0 100 70" className="shrink-0 overflow-visible">
        <path d="M 5 55 Q 50 -5 95 55" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="4 2" />
        <rect x="42" y="60" width="16" height="8" fill="#475569" rx="2" />

        {stations.map((s) => {
          const n = shotCounts?.[s.id] ?? 0;
          return (
            <g
              key={s.id}
              onClick={() => onSelect(selected === s.id ? "all" : s.id)}
              className="cursor-pointer group"
            >
              <title>{`${s.label}: ${n} shot${n === 1 ? "" : "s"} in this session`}</title>
              <circle
                cx={s.cx}
                cy={s.cy}
                r={highlighted === s.id ? "14" : "12"}
                fill={highlighted === s.id ? "#22d3ee" : (selected === s.id || selected === "all" ? "#3b82f6" : "#1e293b")}
                stroke={highlighted === s.id ? "#ffffff" : (selected === s.id ? "#60a5fa" : "#334155")}
                strokeWidth={highlighted === s.id ? "2" : "1.5"}
                className="transition-all duration-200 group-hover:fill-blue-400 group-hover:stroke-blue-300"
              />
              <text
                x={s.cx}
                y={s.cy}
                textAnchor="middle"
                className="pointer-events-none"
                dominantBaseline="middle"
              >
                <tspan x={s.cx} dy={shotCounts ? "-0.3em" : "0.1em"} fontSize={labelFont} fill="white" fontWeight="bold">
                  {s.label}
                </tspan>
                {shotCounts ? (
                  <tspan x={s.cx} dy="1.1em" fontSize={countFont} fill="#cbd5e1" fontWeight="700">
                    {n}
                  </tspan>
                ) : null}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const TrajectorySelector = ({
  selected,
  highlighted,
  onSelect,
  compact = false,
  relaxed = false,
  shotCounts,
}: {
  selected: string;
  highlighted?: string;
  onSelect: (s: string) => void;
  compact?: boolean;
  relaxed?: boolean;
  /** Session shot totals per presentation id (e.g. hard_left). */
  shotCounts?: Record<string, number>;
}) => {
  const trajectories = [
    { id: 'hard_left', d: 'M 50 75 Q 25 50 10 35', x: 10, y: 35, countY: 23 },
    { id: 'moderate_left', d: 'M 50 75 Q 35 40 30 20', x: 30, y: 20, countY: 8 },
    { id: 'straight', d: 'M 50 75 L 50 15', x: 50, y: 15, countY: 3 },
    { id: 'moderate_right', d: 'M 50 75 Q 65 40 70 20', x: 70, y: 20, countY: 8 },
    { id: 'hard_right', d: 'M 50 75 Q 75 50 90 35', x: 90, y: 35, countY: 23 },
  ] as const;

  const sw = compact ? 76 : 100;
  const sh = compact ? 60 : 85;

  return (
    <div className={`flex flex-col items-center ${compact ? "max-h-[4.75rem] justify-end gap-0" : relaxed ? "w-full gap-2" : "w-full gap-1"}`}>
      {compact ? (
        <span className="mb-0.5 text-[9px] font-bold uppercase tracking-widest leading-none text-slate-500">Trajectory</span>
      ) : null}
      <svg
        viewBox="0 0 100 85"
        width={relaxed && !compact ? undefined : sw}
        height={relaxed && !compact ? undefined : sh}
        className={`mx-auto overflow-visible ${
          compact
            ? "shrink-0"
            : relaxed
              ? "aspect-[100/85] h-auto w-full max-w-[20rem]"
              : "h-[85px] w-[100px] shrink-0"
        }`}
      >
        {/* Trap house */}
        <rect x="42" y="75" width="16" height="8" fill="#475569" rx="2" />
        
        {trajectories.map((t) => {
          const isHighlighted = highlighted === t.id;
          const isSelected = selected === t.id || selected === 'all';
          const color = isHighlighted ? '#22d3ee' : (isSelected ? '#3b82f6' : '#1e293b');
          const strokeWidth = isHighlighted ? '3.5' : (selected === t.id ? '3' : '2');
          const n = shotCounts?.[t.id] ?? 0;
          const countFont = compact ? "5" : relaxed ? "7" : "6";
          
          return (
            <g 
              key={t.id} 
              onClick={() => onSelect(selected === t.id ? 'all' : t.id)}
              className="cursor-pointer group"
            >
              <title>{`${t.id.replace(/_/g, " ")}: ${n} shot${n === 1 ? "" : "s"} in this session`}</title>
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
              {shotCounts ? (
                <text
                  x={t.x}
                  y={t.countY}
                  textAnchor="middle"
                  fontSize={countFont}
                  fill={isSelected ? "#f8fafc" : "#94a3b8"}
                  fontWeight="700"
                  className="pointer-events-none transition-colors duration-200"
                  style={{ textShadow: "0 0 3px rgba(15,23,42,0.9), 0 0 6px rgba(15,23,42,0.7)" }}
                >
                  {n}
                </text>
              ) : null}
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

/** Wide, short telemetry strip — height aligned with venue block; content spread horizontally */
const SessionTelemetryHeaderStrip = ({
  hitsCount,
  missesCount,
  unknownsCount,
  filteredCount,
  summaryPosition,
  summaryPositionLabel,
}: {
  hitsCount: number;
  missesCount: number;
  unknownsCount: number;
  filteredCount: number;
  summaryPosition: AveragePosition | null;
  summaryPositionLabel: string;
}) => {
  const pct = filteredCount > 0 ? (hitsCount / filteredCount) * 100 : 0;
  return (
    <div className="glass-panel group relative flex w-full min-w-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 sm:px-4 xl:max-h-[5.75rem] xl:min-w-0 xl:flex-1">
      <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 p-2 opacity-[0.06]">
        <Activity className="h-14 w-14 text-blue-500" />
      </div>
      <div className="relative z-10 flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 md:gap-4 lg:gap-5">
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">Session Telemetry</span>
          <span className="text-2xl font-extrabold leading-none text-white">{hitsCount}</span>
          <span className="text-sm leading-none text-slate-500">/ {filteredCount}</span>
        </div>
        <div className="h-1 min-w-[4rem] flex-1 rounded-full bg-slate-800 sm:h-1.5 sm:max-w-[11rem] md:max-w-[16rem] lg:max-w-xs">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1.2, delay: 0.2, type: "spring" }}
            className="h-full rounded-full bg-gradient-to-r from-blue-600 to-sky-400"
          />
        </div>
        <div className="flex shrink-0 gap-1">
          <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-center text-[9px] font-bold uppercase tracking-wider text-emerald-300">
            {hitsCount} <span className="font-semibold text-emerald-200/70">Brk</span>
          </div>
          <div className="rounded-md border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-center text-[9px] font-bold uppercase tracking-wider text-rose-300">
            {missesCount} <span className="font-semibold text-rose-200/70">Mis</span>
          </div>
          <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-center text-[9px] font-bold uppercase tracking-wider text-amber-300">
            {unknownsCount} <span className="font-semibold text-amber-200/70">Unk</span>
          </div>
        </div>
        {summaryPosition ? (
          <>
            <div className="hidden h-9 w-px shrink-0 bg-white/10 sm:block" aria-hidden />
            <div className="flex min-w-0 flex-1 gap-2 sm:justify-end">
              <div className="min-w-0 max-w-[40%] rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 sm:max-w-none sm:flex-1">
                <div className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">{summaryPositionLabel} · H</div>
                <div className="truncate text-[11px] font-bold leading-tight text-white">
                  {describeHorizontalOffset(summaryPosition.x)}
                </div>
              </div>
              <div className="min-w-0 max-w-[40%] rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 sm:max-w-none sm:flex-1">
                <div className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">V</div>
                <div className="truncate text-[11px] font-bold leading-tight text-white">
                  {describeVerticalOffset(summaryPosition.y)}
                </div>
              </div>
            </div>
          </>
        ) : (
          <span className="hidden text-[10px] text-slate-500 sm:inline">No breaks in filter</span>
        )}
      </div>
    </div>
  );
};

const OverlayBoxes = React.memo(({
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
        let bbox = normalizeBbox(box);
        if (!bbox) return null;

        const isClay = box.class_name === "clay-targets" || box.class_name === "broken-clay";
        
        // Double size for clays
        if (isClay) {
          const centerX = bbox.x + bbox.width / 2;
          const centerY = bbox.y + bbox.height / 2;
          const newWidth = bbox.width * 2;
          const newHeight = bbox.height * 2;
          bbox = {
            x: centerX - newWidth / 2,
            y: centerY - newHeight / 2,
            width: newWidth,
            height: newHeight,
          };
        }

        const style = OVERLAY_CLASS_STYLES[box.class_name] ?? { border: "border-white/70", text: "text-white" };
        const borderWidth = isClay ? "border-[3px]" : "border-[1.5px]";
        
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
            <div className={`relative h-full w-full rounded-[2px] ${borderWidth} ${style.border}`}>
              <span className={`absolute -top-5 left-0 whitespace-nowrap rounded-sm bg-slate-950/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold ${style.text}`}>
                {formatClassLabel(box.class_name)} {(box.confidence ?? 0).toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
});
OverlayBoxes.displayName = "OverlayBoxes";

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
    <motion.div variants={itemVariants} className="mt-2">
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
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [stationFilter, setStationFilter] = useState("all");
  const [hasSetInitialFilters, setHasSetInitialFilters] = useState(false);
  const [shotData, setShotData] = useState<ShotData[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedShot, setSelectedShot] = useState<ShotData | null>(null);
  const [replayMode, setReplayMode] = useState<"photo" | "video">("photo");
  const [activeOverlayFrame, setActiveOverlayFrame] = useState<TrackingFrame | null>(null);
  const [interpolatedBoxes, setInterpolatedBoxes] = useState<OverlayBox[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  
  // Categorization states
  const [isEditingSession, setIsEditingSession] = useState(false);
  const [editForm, setEditForm] = useState({ venue: "", date: "", type: "" });
  
  const [isCategorizeModalOpen, setIsCategorizeModalOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [categorizeShotId, setCategorizeShotId] = useState<number | null>(null);
  const [newCategorizeName, setNewCategorizeName] = useState("");
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ShotData | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<number | null>(null);
  const [classificationSavingId, setClassificationSavingId] = useState<number | null>(null);

  const unwrappedParams = React.use(params);

  const applyShotUpdateFromApi = useCallback((shotId: number, updated: ShotData) => {
    setShotData((prev) => prev.map((s) => (s.id === shotId ? { ...s, ...updated } : s)));
    setSelectedShot((prev) => (prev?.id === shotId ? { ...prev, ...updated } : prev));
  }, []);

  const patchShotClassification = useCallback(async (
    shotId: number,
    patch: { break_label?: string; station?: string; presentation?: string },
  ) => {
    setClassificationSavingId(shotId);
    try {
      const res = await fetch(`http://localhost:8000/api/shots/${shotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        console.error("Shot classification update failed", res.status);
        return;
      }
      const updated = (await res.json()) as ShotData;
      applyShotUpdateFromApi(shotId, updated);
    } catch (e) {
      console.error(e);
    } finally {
      setClassificationSavingId(null);
    }
  }, [applyShotUpdateFromApi]);

  const removeVideoFromView = useCallback((videoId: number) => {
    setShotData((prev) => {
      const remaining = prev.filter((shot) => shot.video_id !== videoId);
      if (remaining.length === 0) {
        router.push("/dashboard/sessions");
      }
      return remaining;
    });
    setIsCategorizeModalOpen(false);
    setCategorizeShotId(null);
    setDeleteTarget(null);
    setSelectedShot((prev) => {
      if (prev?.video_id === videoId) {
        setReplayMode("photo");
        setActiveOverlayFrame(null);
        setInterpolatedBoxes([]);
        setIsReviewModalOpen(false);
        lastVideoTimeRef.current = -1;
        return null;
      }
      return prev;
    });
  }, [router]);

  useEffect(() => {
    Promise.all([
      fetch(`http://localhost:8000/api/sessions/${unwrappedParams.id}/shots`).then(res => res.json()),
      fetch(`http://localhost:8000/api/sessions/${unwrappedParams.id}`).then(res => res.json())
    ])
      .then(([shots, info]) => {
        const sessionShots = shots as ShotData[];
        const session = info as SessionInfo;
        setShotData(sessionShots);
        setSessionInfo(session);
        setEditForm({ 
          venue: session.venue || "", 
          date: session.date || "", 
          type: session.type || "" 
        });
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [unwrappedParams.id]);

  useEffect(() => {
    if (shotData.length > 0 && !hasSetInitialFilters) {
      const stCounts: Record<string, number> = {};
      shotData.forEach(d => {
        let st = "unknown";
        if (stationOptionIsActive(d.station, "trap-house-1-2")) st = "trap-house-1-2";
        else if (stationOptionIsActive(d.station, "trap-house")) st = "trap-house";
        else if (stationOptionIsActive(d.station, "trap-house-4-5")) st = "trap-house-4-5";
        stCounts[st] = (stCounts[st] || 0) + 1;
      });
      if (Object.keys(stCounts).length > 0) {
        const topStation = Object.entries(stCounts).sort((a, b) => b[1] - a[1])[0][0];

        const pCounts: Record<string, number> = {};
        shotData.forEach(d => {
          if (stationOptionIsActive(d.station, topStation)) {
            const p = d.presentation || "straight";
            pCounts[p] = (pCounts[p] || 0) + 1;
          }
        });
        const topPresentation = Object.keys(pCounts).length > 0 
          ? Object.entries(pCounts).sort((a, b) => b[1] - a[1])[0][0] 
          : "straight";

        setStationFilter(topStation);
        setFilter(topPresentation);
      }
      setHasSetInitialFilters(true);
    } else if (shotData.length === 0 && !loading && !hasSetInitialFilters) {
      setHasSetInitialFilters(true);
    }
  }, [shotData, loading, hasSetInitialFilters]);

  const handleUpdateSession = async () => {
    try {
      const res = await fetch(`http://localhost:8000/api/sessions/${unwrappedParams.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        setSessionInfo((current) => (current ? { ...current, ...editForm } : current));
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
        const data = await res.json() as SessionInfo[];
        setAllSessions(data.filter((session) => session.id !== parseInt(unwrappedParams.id, 10)));
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
        removeVideoFromView(videoId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openDeleteModal = (shot: ShotData) => {
    if (!shot.video_id) return;
    setIsCategorizeModalOpen(false);
    setCategorizeShotId(null);
    setDeleteTarget(shot);
  };

  const handleDeleteVideo = async () => {
    const videoId = deleteTarget?.video_id;
    if (!videoId) return;

    setDeletingVideoId(videoId);
    try {
      const res = await fetch(`http://localhost:8000/api/videos/${videoId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.error("Video delete failed", res.status);
        return;
      }
      removeVideoFromView(videoId);
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingVideoId(null);
    }
  };

  const deselectShot = useCallback(() => {
    setSelectedShot(null);
    setReplayMode("photo");
    setActiveOverlayFrame(null);
    setInterpolatedBoxes([]);
    lastVideoTimeRef.current = -1;
    setIsReviewModalOpen(false);
  }, []);

  const selectedShotIdRef = useRef<number | null>(null);
  selectedShotIdRef.current = selectedShot?.id ?? null;
  const anySelectedRef = useRef(!!selectedShot);
  anySelectedRef.current = !!selectedShot;
  const isReviewModalOpenRef = useRef(isReviewModalOpen);
  isReviewModalOpenRef.current = isReviewModalOpen;

  const handleSelectShot = useCallback((shot: ShotData) => {
    if (selectedShotIdRef.current === shot.id) {
      if (!isReviewModalOpenRef.current) {
        setIsReviewModalOpen(true);
      } else {
        deselectShot();
      }
      return;
    }
    setSelectedShot(shot);
    setReplayMode("photo");
    setActiveOverlayFrame(getPhotoFrame(shot));
    setInterpolatedBoxes([]);
    lastVideoTimeRef.current = -1;
    setIsReviewModalOpen(true);
  }, [deselectShot]);

  const hitShapeRenderer = useCallback((props: unknown) => {
    const p = props as TrajectoryShapeProps;
    return <TrajectoryDot {...p} onClickShot={handleSelectShot} anySelected={anySelectedRef.current} isSelected={selectedShotIdRef.current === p.payload?.id} />;
  }, [handleSelectShot]);

  const missShapeRenderer = useCallback((props: unknown) => {
    const p = props as TrajectoryShapeProps;
    return <TrajectoryMiss {...p} onClickShot={handleSelectShot} anySelected={anySelectedRef.current} isSelected={selectedShotIdRef.current === p.payload?.id} />;
  }, [handleSelectShot]);

  const unknownShapeRenderer = useCallback((props: unknown) => {
    const p = props as TrajectoryShapeProps;
    return <TrajectoryUnknown {...p} onClickShot={handleSelectShot} anySelected={anySelectedRef.current} isSelected={selectedShotIdRef.current === p.payload?.id} />;
  }, [handleSelectShot]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (deleteTarget) {
        setDeleteTarget(null);
        return;
      }
      if (isCategorizeModalOpen) {
        setIsCategorizeModalOpen(false);
        setCategorizeShotId(null);
        return;
      }
      if (isReviewModalOpen) {
        setIsReviewModalOpen(false);
        return;
      }
      if (selectedShot) {
        deselectShot();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedShot, isCategorizeModalOpen, isReviewModalOpen, deleteTarget, deselectShot]);

  useEffect(() => {
    if (replayMode !== "video" || !selectedShot?.tracking_data?.length) {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
      return;
    }

    const animate = () => {
      const video = videoRef.current;
      if (video) {
        const vTime = video.currentTime;
        if (Math.abs(vTime - lastVideoTimeRef.current) > 0.005) {
          lastVideoTimeRef.current = vTime;
          const result = getInterpolatedOverlayForTime(selectedShot.tracking_data, vTime);
          setActiveOverlayFrame(result.frame);
          setInterpolatedBoxes(result.boxes);
        }
      }
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
    };
  }, [replayMode, selectedShot]);

  const presentationShotCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of shotData) {
      if (stationFilter !== "all" && !stationOptionIsActive(d.station, stationFilter)) continue;
      const p = d.presentation || "straight";
      c[p] = (c[p] ?? 0) + 1;
    }
    return c;
  }, [shotData, stationFilter]);

  const stationShotCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of shotData) {
      if (filter !== "all" && d.presentation !== filter) continue;
      let st = "unknown";
      if (stationOptionIsActive(d.station, "trap-house-1-2")) st = "trap-house-1-2";
      else if (stationOptionIsActive(d.station, "trap-house")) st = "trap-house";
      else if (stationOptionIsActive(d.station, "trap-house-4-5")) st = "trap-house-4-5";
      c[st] = (c[st] ?? 0) + 1;
    }
    return c;
  }, [shotData, filter]);

  const filteredData = useMemo(() => shotData.filter(d => 
    (filter === "all" || d.presentation === filter) &&
    (stationFilter === "all" || stationOptionIsActive(d.station, stationFilter))
  ), [shotData, filter, stationFilter]);
  const hits = useMemo(() => filteredData.filter(d => d.type === "hit"), [filteredData]);
  const misses = useMemo(() => filteredData.filter(d => d.type === "miss"), [filteredData]);
  const unknowns = useMemo(() => filteredData.filter(d => d.type === "unknown"), [filteredData]);

  const averageVisiblePosition = useMemo(() => getAveragePosition(filteredData), [filteredData]);
  const averageHitPosition = useMemo(() => getAveragePosition(hits), [hits]);
  const averageMissPosition = useMemo(() => getAveragePosition(misses), [misses]);
  const chartDomain = useMemo(() => getProportionalSymmetricDomain(filteredData, 10, 1.5), [filteredData]);
  const { symmetricDomain, breakWindowHalfWidth, breakWindowHalfHeight } = useMemo(() => {
    const maxAbs = Math.max(Math.abs(chartDomain[0]), Math.abs(chartDomain[1]));
    const breakHalf = Math.max(1.2, maxAbs * 0.155);
    return {
      symmetricDomain: [-maxAbs, maxAbs] as [number, number],
      breakWindowHalfWidth: breakHalf,
      breakWindowHalfHeight: breakHalf,
    };
  }, [chartDomain]);
  const shotPatternSummary = useMemo(() => getShotPatternSummary({
    filter,
    hitsCount: hits.length,
    missesCount: misses.length,
    averageHitPosition,
    averageMissPosition,
    averageVisiblePosition,
  }), [averageHitPosition, averageMissPosition, averageVisiblePosition, filter, hits.length, misses.length]);
  const summaryPosition = averageHitPosition ?? averageVisiblePosition;
  const summaryPositionLabel = averageHitPosition ? "Break window offset" : "Visible pattern offset";
  const positiveSideRead = filter !== "all" ? getHorizontalMeaningForPresentation(filter, 1) : null;
  const photoFrame = selectedShot ? getPhotoFrame(selectedShot) : null;
  const activeFrame = replayMode === "video" ? activeOverlayFrame : photoFrame;
  const overlayBoxes = replayMode === "video"
    ? interpolatedBoxes.length ? interpolatedBoxes : (activeFrame?.overlay_boxes ?? [])
    : selectedShot?.pretrigger_boxes?.length
      ? selectedShot.pretrigger_boxes
      : photoFrame?.overlay_boxes ?? [];
  const baseCrosshairX = activeFrame?.crosshair_x ?? selectedShot?.crosshair_x ?? selectedShot?.tracking_data?.[0]?.crosshair_x;
  const baseCrosshairY = activeFrame?.crosshair_y ?? selectedShot?.crosshair_y ?? selectedShot?.tracking_data?.[0]?.crosshair_y;
  
  const videoWidth = selectedShot?.tracking_data?.[0]?.width || 1920;
  const videoHeight = selectedShot?.tracking_data?.[0]?.height || 1080;
  const overlayAspectRatio = `${videoWidth} / ${videoHeight}`;

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
      {/* Top Header Row — session title + session telemetry */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-4 border-b border-white/5 pb-6 xl:flex-row xl:items-center xl:justify-between xl:gap-6"
      >
        <div className="flex min-w-0 shrink-0 items-start gap-4">
          <Link href="/dashboard/sessions" className="p-2.5 glass-panel rounded-full hover:bg-white/10 transition-colors group">
            <ArrowLeft className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
          </Link>
          <div className="min-w-0 flex-1">
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

        {!isEditingSession && (
          <SessionTelemetryHeaderStrip
            hitsCount={hits.length}
            missesCount={misses.length}
            unknownsCount={unknowns.length}
            filteredCount={filteredData.length}
            summaryPosition={summaryPosition}
            summaryPositionLabel={summaryPositionLabel}
          />
        )}
      </motion.div>

      <div className="flex flex-col gap-6">
        {/* Main: shot placement + downstream panels (full width; trajectory/trap live in header) */}
        <motion.div variants={itemVariants} className="flex flex-col gap-6">
          <div className="glass-panel relative flex min-h-[600px] flex-col overflow-hidden rounded-2xl p-6">
            <div className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-20" />
            
            <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="flex items-center gap-3 text-xl font-bold text-white">
                  <Target className="h-5 w-5 text-sky-400" /> Shot Placement Matrix
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
                  Each mark shows where the target sat relative to <strong className="text-slate-300">frame center</strong> at the shot (the same reference the analysis pipeline uses). The plot is square with matching X/Y scales so distance in data units matches a true crosshair offset. The red + marks <strong className="text-slate-300">(0, 0)</strong>—zero offset from frame center—not where the physical bead or muzzle appears in the photo; the barrel is often along the top edge while math stays centered. Green shows the break window, red shows where misses leak, and the dashed guide tracks the average of what is currently visible.
                  {selectedShot ? (
                    <span className="mt-2 block text-xs text-slate-500">
                      Click the same point again or press <kbd className="rounded border border-white/10 bg-slate-900/80 px-1 py-0.5 font-mono text-[10px] text-slate-400">Esc</kbd> to drop the path and station highlight.
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-3 sm:items-end">
              <div className="flex flex-wrap justify-end gap-3 text-[11px] font-bold uppercase tracking-[0.18em]">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-2 text-slate-300">
                  <span className="relative block h-3.5 w-3.5">
                    <span className="absolute inset-0 rounded-full bg-emerald-400/20" />
                    <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-emerald-400" />
                  </span>
                  Break
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-2 text-slate-300">
                  <span className="relative block h-3.5 w-3.5 rounded-full bg-rose-500/10">
                    <span className="absolute left-1/2 top-1/2 h-[2px] w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-rose-400" />
                    <span className="absolute left-1/2 top-1/2 h-[2px] w-3.5 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-rose-400" />
                  </span>
                  Miss
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-2 text-slate-300">
                  <span className="h-3 w-3 rotate-45 rounded-[2px] border border-white bg-amber-400/50" />
                  Unknown
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-2 text-slate-300">
                  <span className="relative block h-3.5 w-3.5">
                    <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-amber-400" />
                    <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-cyan-400" />
                  </span>
                  Visible Avg
                </div>
              </div>
              </div>
            </div>

            <div className="mb-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">Break Window</div>
                <div className="mt-2 text-sm font-semibold leading-relaxed text-white">{shotPatternSummary.headline}</div>
              </div>
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200/70">Pattern Drift</div>
                <div className="mt-2 text-sm font-semibold leading-relaxed text-white">{shotPatternSummary.detail}</div>
              </div>
              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200/70">How To Read This Angle</div>
                <div className="mt-2 text-sm font-semibold leading-relaxed text-white">
                  {filter === "all"
                    ? "Right of center means the target stayed right of frame center. Above center means the gun finished low."
                    : `For ${formatPresentationFilterLabel(filter).toLowerCase()} birds, right of center usually reads ${positiveSideRead?.toLowerCase()}.`}
                </div>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-12 xl:items-stretch xl:gap-6">
              <div className="flex min-h-0 w-full flex-col xl:col-span-3 xl:h-full">
                <div className="flex h-full min-h-[420px] w-full flex-col gap-8 rounded-2xl border border-white/10 bg-slate-950/30 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:min-h-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
                  <div className="flex w-full flex-col gap-1.5">
                    <label
                      htmlFor="session-presentation-filter"
                      className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500"
                    >
                      Presentation
                    </label>
                    <select
                      id="session-presentation-filter"
                      title="Filter chart by presentation angle"
                      className="w-full cursor-pointer appearance-none rounded-xl border border-slate-700/60 bg-slate-950/80 py-2 pl-3 pr-8 text-sm text-white transition focus:outline-none focus:ring-2 focus:ring-blue-500/50"
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
                  <div>
                    <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Trajectory</h3>
                    <TrajectorySelector
                      relaxed
                      shotCounts={presentationShotCounts}
                      selected={filter}
                      highlighted={selectedShot?.presentation}
                      onSelect={setFilter}
                    />
                  </div>
                  <div className="border-t border-white/10 pt-8">
                    <TrapHouseSelector
                      relaxed
                      shotCounts={stationShotCounts}
                      selected={stationFilter}
                      highlighted={selectedShot?.station}
                      onSelect={setStationFilter}
                    />
                  </div>
                </div>
              </div>
              <div className="flex min-h-0 w-full min-w-0 flex-col xl:col-span-9 xl:h-full">
            {/* The Chart Background */}
            <div className="relative flex min-h-[420px] w-full flex-1 flex-col overflow-hidden rounded-[24px] border border-slate-800/80 bg-[#08111f] p-5 shadow-[inset_0_0_60px_rgba(2,6,23,0.85)] group cursor-crosshair">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.08),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_34%)]" />
              <div className="pointer-events-none absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-cyan-400/15" />
              <div className="pointer-events-none absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-cyan-400/15" />
              {/* Axis Labels */}
              <p className="absolute left-1/2 top-3 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Target Above Frame Center</p>
              <p className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Target Below Frame Center</p>
              <p className="absolute left-3 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Target Left Of Frame Center</p>
              <p className="absolute right-3 top-1/2 translate-y-1/2 rotate-90 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Target Right Of Frame Center</p>
              
              <div className="relative flex min-h-0 flex-1 flex-col justify-center">
              <div className="relative mx-auto aspect-square w-full max-w-[420px] shrink-0 [&_*]:!outline-none [&_*]:focus:!outline-none [&_*]:focus-visible:!outline-none">
                <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 24, right: 24, bottom: 24, left: 24 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="#1e293b" opacity={0.45} horizontal={true} vertical={true} />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={symmetricDomain}
                    allowDataOverflow={false}
                    stroke="#334155"
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    axisLine={{ stroke: "#334155" }}
                    tickLine={{ stroke: "#334155" }}
                    height={46}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    domain={symmetricDomain}
                    allowDataOverflow={false}
                    stroke="#334155"
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    axisLine={{ stroke: "#334155" }}
                    tickLine={{ stroke: "#334155" }}
                    width={46}
                  />
                  <ZAxis type="number" range={[150, 150]} />
                  <RechartsTooltip cursor={false} content={<ShotPlacementTooltip />} />
                  <ReferenceLine x={0} stroke="#38bdf8" strokeOpacity={0.22} />
                  <ReferenceLine y={0} stroke="#38bdf8" strokeOpacity={0.22} />

                  <ReferenceDot
                    x={0}
                    y={0}
                    r={0}
                    fill="none"
                    stroke="none"
                    shape={(dotProps) => <BeadCenterCrosshairShape cx={dotProps.cx} cy={dotProps.cy} />}
                    label={{
                      position: "top",
                      value: "Frame center (0, 0)",
                      fill: "#cbd5e1",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  />

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
                      x1={averageHitPosition.x - breakWindowHalfWidth}
                      x2={averageHitPosition.x + breakWindowHalfWidth}
                      y1={averageHitPosition.y - breakWindowHalfHeight}
                      y2={averageHitPosition.y + breakWindowHalfHeight}
                      fill="url(#breakGradient)"
                      stroke="rgba(52, 211, 153, 0.35)"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                  )}
                  
                  {/* SVG Definitions for Gradients */}
                  <defs>
                    <radialGradient id="breakGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                    </radialGradient>
                  </defs>

                  {/* Scatter Data */}
                  <Scatter 
                    name="Successful Breaks" 
                    data={hits} 
                    fill="#34d399" 
                    shape={hitShapeRenderer} 
                  />
                  <Scatter 
                    name="Missed Targets" 
                    data={misses} 
                    fill="#f43f5e" 
                    shape={missShapeRenderer} 
                  />
                  <Scatter 
                    name="Unknown Outcome" 
                    data={unknowns} 
                    fill="#f59e0b" 
                    shape={unknownShapeRenderer} 
                  />
                  <Customized component={<ProjectionLine selectedShot={selectedShot} />} />
                </ScatterChart>
                </ResponsiveContainer>
              </div>
              </div>
            </div>
              </div>
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
                <h4 className="font-semibold text-white mb-1">Shooter Readout</h4>
                <p className="text-sm font-semibold leading-relaxed text-white">{shotPatternSummary.headline}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">{shotPatternSummary.detail}</p>
                <p className="mt-2 text-sm leading-relaxed text-blue-100/90">{shotPatternSummary.coaching}</p>
              </div>
            </motion.div>
          </div>

        {/* Bottom Drilldown Row */}
        <motion.div variants={itemVariants} className="mt-2">
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 text-white border-b border-white/10 pb-4">
              <Video className="w-5 h-5 text-indigo-400" /> Shot Trace Logs & Manual Override
            </h2>
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider"># Date / Time</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Outcome</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Presentation</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Offset Coordinate</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Verification</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredData.map((shot, idx) => {
                    const traceDate = getShotTraceDateLabel(shot.video_path, sessionInfo?.date);
                    const traceTime = getShotTraceTimeLabel(shot.video_path, shot.pretrigger_time);
                    const traceShot = getShotTraceShotLabel(shot.video_path, idx);

                    return (
                    <tr key={shot.id} className="hover:bg-white/5 transition-colors group">
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <span className="pt-0.5 font-mono text-sm text-slate-500">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-200">{traceDate}</div>
                            <div className="mt-1 font-mono text-xs text-slate-500">{traceTime}</div>
                            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-300/80">
                              {traceShot}
                            </div>
                          </div>
                        </div>
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
                        <div className="flex justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                          <button 
                            onClick={() => openCategorizeModal(shot)}
                            className="px-4 py-1.5 rounded-full text-xs font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all"
                          >
                            Move
                          </button>
                          <button
                            type="button"
                            disabled={!shot.video_id || deletingVideoId === shot.video_id}
                            onClick={() => openDeleteModal(shot)}
                            className="px-4 py-1.5 rounded-full text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition-all disabled:opacity-40"
                          >
                            {deletingVideoId === shot.video_id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

        <ValidationPanel shots={shotData} />
        </motion.div>

      </div>

      <AnimatePresence>
        {isReviewModalOpen && selectedShot && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-black/80 backdrop-blur-sm overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) setIsReviewModalOpen(false); }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-6xl rounded-2xl flex flex-col border border-slate-700/50 shadow-2xl relative overflow-hidden bg-slate-900 my-auto"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-40" />
              <div className="flex justify-between items-center z-10 px-6 pt-5 pb-4 border-b border-white/5">
                <h4 className="text-lg font-bold text-white flex items-center gap-3 tracking-tight">
                  <Video className="w-5 h-5 text-cyan-400" /> Shot Replay - <span className="capitalize">{selectedShot.presentation.replace('_', ' ')}</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-xs font-semibold text-slate-300 ml-2 uppercase tracking-wider">{formatStationLabel(selectedShot.station)}</span>
                </h4>
                <div className="flex items-center gap-3">
                  <div className="flex bg-slate-950/80 rounded-full p-1 border border-white/10 shadow-inner">
                    <button 
                      onClick={() => setReplayMode('photo')} 
                      className={`text-xs font-bold uppercase tracking-wider px-5 py-2 rounded-full transition-all ${replayMode === 'photo' ? 'bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.6)]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                    >
                      Photo
                    </button>
                    <button 
                      onClick={() => setReplayMode('video')} 
                      className={`text-xs font-bold uppercase tracking-wider px-5 py-2 rounded-full transition-all ${replayMode === 'video' ? 'bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.6)]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                    >
                      Video
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedShot.video_id || deletingVideoId === selectedShot.video_id}
                    onClick={() => openDeleteModal(selectedShot)}
                    className="text-rose-200 hover:text-white text-xs font-bold uppercase tracking-wider bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/30 transition-all px-4 py-2 rounded-full disabled:opacity-40"
                    title="Delete this clip"
                  >
                    <Trash2 className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
                    {deletingVideoId === selectedShot.video_id ? "Deleting..." : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsReviewModalOpen(false)}
                    className="text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 transition-all p-2 rounded-full border border-white/10"
                    title="Close (Esc)"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              <div className="flex flex-col lg:flex-row gap-6 px-6 pb-6 pt-4">
                <div className="w-full lg:w-[340px] shrink-0 flex flex-col gap-4">
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/20 px-5 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2 text-white">
                        <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
                        <div className="text-sm font-bold uppercase tracking-[0.16em] text-cyan-200/90">Correct This Shot</div>
                      </div>
                      {classificationSavingId === selectedShot.id && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300 animate-pulse">Saving…</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-5">
                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 flex items-center justify-between">
                          Outcome
                          {selectedShot.confidence !== undefined && selectedShot.confidence !== null && (
                            <span className="text-[9px] text-slate-500">AI Conf: {(selectedShot.confidence * 100).toFixed(0)}%</span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              { typeKey: "hit" as const, api: "break" as const, label: "Break" },
                              { typeKey: "miss" as const, api: "miss" as const, label: "Miss" },
                              { typeKey: "unknown" as const, api: "unknown" as const, label: "Unknown" },
                            ] as const
                          ).map((opt) => {
                            const active = selectedShot.type === opt.typeKey;
                            return (
                              <button
                                key={opt.api}
                                type="button"
                                disabled={classificationSavingId === selectedShot.id || active}
                                onClick={() => patchShotClassification(selectedShot.id, { break_label: opt.api })}
                                className={`rounded-lg border py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
                                  active
                                    ? `${OUTCOME_STYLES[opt.typeKey].badge} cursor-default shadow-md`
                                    : "border-white/10 bg-slate-900/80 text-slate-400 hover:border-white/25 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Station</div>
                        <div className="grid grid-cols-2 gap-2">
                          {STATION_OPTIONS.map((opt) => {
                            const active = stationOptionIsActive(selectedShot.station, opt.value);
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                disabled={classificationSavingId === selectedShot.id || active}
                                onClick={() =>
                                  patchShotClassification(selectedShot.id, {
                                    station: opt.value === "unknown" ? "" : opt.value,
                                  })
                                }
                                className={`rounded-lg border py-2 text-xs font-semibold transition-all ${
                                  active
                                    ? "border-sky-400/50 bg-sky-500/20 text-sky-100 cursor-default shadow-md"
                                    : "border-white/10 bg-slate-900/80 text-slate-400 hover:border-white/25 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label
                          htmlFor={`modal-presentation-${selectedShot.id}`}
                          className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400"
                        >
                          Presentation
                        </label>
                        <select
                          id={`modal-presentation-${selectedShot.id}`}
                          title="Presentation angle"
                          disabled={classificationSavingId === selectedShot.id}
                          value={
                            PRESENTATION_OPTIONS.some((o) => o.value === selectedShot.presentation)
                              ? selectedShot.presentation
                              : selectedShot.presentation || "straight"
                          }
                          onChange={(e) => patchShotClassification(selectedShot.id, { presentation: e.target.value })}
                          className="w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-sm text-white font-medium focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-40"
                        >
                          {!PRESENTATION_OPTIONS.some((o) => o.value === selectedShot.presentation) &&
                            selectedShot.presentation && (
                              <option value={selectedShot.presentation}>
                                {selectedShot.presentation.replace(/_/g, " ")} (current)
                              </option>
                            )}
                          {PRESENTATION_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="rounded-xl border border-white/5 bg-slate-900/60 px-4 py-3 mt-1 flex justify-between items-center">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pre-trigger</div>
                          <div className="mt-1 text-sm font-mono text-slate-300">
                            {selectedShot.pretrigger_time !== null && selectedShot.pretrigger_time !== undefined
                              ? formatClipOffset(selectedShot.pretrigger_time)
                              : "N/A"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Offset</div>
                          <div className="font-mono text-xs text-slate-400 mt-1">[{selectedShot.x > 0 ? '+' : ''}{selectedShot.x}, {selectedShot.y > 0 ? '+' : ''}{selectedShot.y}]</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex-1 bg-black rounded-xl overflow-hidden flex items-center justify-center border border-slate-700/80 shadow-[0_0_30px_rgba(0,0,0,0.8)] relative" style={{ minHeight: "450px", maxHeight: "75vh" }}>
                  <div
                    className="relative w-full h-full flex items-center justify-center"
                  >
                    <div 
                      className="relative"
                      style={{
                        aspectRatio: overlayAspectRatio,
                        width: "100%",
                        maxHeight: "100%",
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
                        <>
                          <Image
                            src={`http://localhost:8000/api/videos/frame?path=${encodeURIComponent(selectedShot.video_path)}&frame_idx=${selectedShot.pretrigger_frame_idx ?? photoFrame?.frame_idx ?? -1}&time_ms=${Math.round((selectedShot.pretrigger_time ?? photoFrame?.time ?? 1) * 1000)}`}
                            alt="Pre-trigger frame"
                            fill
                            unoptimized
                            className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                          />
                          <OverlayBoxes boxes={overlayBoxes} crosshairX={baseCrosshairX} crosshairY={baseCrosshairY} />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-rose-500/20 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full border border-rose-500/20 bg-rose-500/10 p-2">
                <Trash2 className="h-5 w-5 text-rose-300" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Delete clip?</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  This permanently removes the uploaded video, generated replay assets, and extracted shot instance for
                  <span className="text-slate-200"> {deleteTarget.presentation.replace(/_/g, " ")}</span>.
                </p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-rose-300/80">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={deletingVideoId === deleteTarget.video_id}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 transition-colors hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingVideoId === deleteTarget.video_id}
                onClick={handleDeleteVideo}
                className="rounded-lg border border-rose-500/20 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
              >
                {deletingVideoId === deleteTarget.video_id ? "Deleting..." : "Delete clip"}
              </button>
            </div>

            <button 
              onClick={() => setDeleteTarget(null)}
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
