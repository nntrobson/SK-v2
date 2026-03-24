"use client";

import React, { useRef, useEffect, useCallback } from "react";
import {
  computeOutlierMask,
  type NewClassificationResult,
  CLASS_COLORS,
  CLASS_SHADES,
} from "@/lib/trajectory-classifier";

export interface TrajectoryShot {
  videoName: string;
  trajX: number[];
  trajY: number[];
  normX: number[];
  newResult: NewClassificationResult;
  oldDeltaX: number;
}

interface TrajectoryCanvasProps {
  shot?: TrajectoryShot;
  overlayShots?: TrajectoryShot[];
  showOutliers?: boolean;
  width?: number;
  height?: number;
}

function toCanvasCoords(
  x: number,
  y: number,
  minX: number,
  maxY: number,
  scale: number,
  offX: number,
  offY: number
): [number, number] {
  return [offX + (x - minX) * scale, offY + (maxY - y) * scale];
}

function drawSingleTrajectory(
  ctx: CanvasRenderingContext2D,
  shot: TrajectoryShot,
  W: number,
  H: number,
  showOutliers: boolean
) {
  const rawXs = shot.normX.length === shot.trajY.length ? shot.normX : shot.trajX;
  const rawYs = shot.trajY;
  if (rawXs.length < 2) return;

  const x0 = rawXs[0],
    y0 = rawYs[0];
  const xs = rawXs.map((x) => x - x0);
  const ys = rawYs.map((y) => y - y0);

  const minX = Math.min(...xs) - 10;
  const maxX = Math.max(...xs) + 10;
  const minY = Math.min(...ys) - 10;
  const maxY = Math.max(...ys) + 10;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const pad = 50;
  const plotW = W - 2 * pad;
  const plotH = H - 2 * pad;
  const scale = Math.min(plotW / rangeX, plotH / rangeY);
  const offX = pad + (plotW - rangeX * scale) / 2;
  const offY = pad + (plotH - rangeY * scale) / 2;

  const tc = (x: number, y: number) =>
    toCanvasCoords(x, y, minX, maxY, scale, offX, offY);

  // Grid
  ctx.strokeStyle = "#1e2030";
  ctx.lineWidth = 1;
  const gridStep = Math.pow(10, Math.floor(Math.log10(rangeX / 4)));
  for (let gx = Math.ceil(minX / gridStep) * gridStep; gx <= maxX; gx += gridStep) {
    const [cx] = tc(gx, 0);
    ctx.beginPath();
    ctx.moveTo(cx, pad);
    ctx.lineTo(cx, H - pad);
    ctx.stroke();
  }
  for (let gy = Math.ceil(minY / gridStep) * gridStep; gy <= maxY; gy += gridStep) {
    const [, cy] = tc(0, gy);
    ctx.beginPath();
    ctx.moveTo(pad, cy);
    ctx.lineTo(W - pad, cy);
    ctx.stroke();
  }

  // Crosshair at origin
  const [ox, oy] = tc(0, 0);
  if (ox > pad && ox < W - pad && oy > pad && oy < H - pad) {
    ctx.strokeStyle = "#333";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ox, pad);
    ctx.lineTo(ox, H - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pad, oy);
    ctx.lineTo(W - pad, oy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#555";
    ctx.font = "10px monospace";
    ctx.fillText("crosshair", ox + 4, oy - 4);
  }

  const outlierMask = computeOutlierMask(xs, ys);

  // Parabolic fit curve
  if (shot.newResult.r2 > 0) {
    const { a, b, c } = shot.newResult;
    const STEPS = 60;
    const yMin = Math.min(...ys),
      yMax2 = Math.max(...ys);
    ctx.strokeStyle = "#4fc3f7";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let s = 0; s <= STEPS; s++) {
      const yy = yMin + ((yMax2 - yMin) * s) / STEPS;
      const xx = a * yy * yy + b * yy + c;
      const [cx, cy] = tc(xx, yy);
      if (s === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const endX = a * yMax2 * yMax2 + b * yMax2 + c;
    const [lx, ly] = tc(endX, yMax2);
    ctx.fillStyle = "#4fc3f7";
    ctx.font = "11px sans-serif";
    ctx.fillText(`fit: ${shot.newResult.angle.toFixed(1)}°`, lx + 5, ly + 4);
  }

  // Old method endpoint line
  const [ex0, ey0] = tc(xs[0], ys[0]);
  const [ex1, ey1] = tc(xs[xs.length - 1], ys[ys.length - 1]);
  ctx.strokeStyle = "#ff5722";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(ex0, ey0);
  ctx.lineTo(ex1, ey1);
  ctx.stroke();
  ctx.setLineDash([]);

  // Clean trajectory path
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let pathStarted = false;
  for (let i = 0; i < xs.length; i++) {
    if (outlierMask[i]) continue;
    const [cx, cy] = tc(xs[i], ys[i]);
    if (!pathStarted) {
      ctx.moveTo(cx, cy);
      pathStarted = true;
    } else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Points
  for (let i = 0; i < xs.length; i++) {
    const [cx, cy] = tc(xs[i], ys[i]);
    const t = xs.length > 1 ? i / (xs.length - 1) : 0;
    const isStatOutlier = outlierMask[i] && i > 0 && i < xs.length - 1;
    const isTrimmed = outlierMask[i] && (i === 0 || i === xs.length - 1);

    if (isStatOutlier || isTrimmed) {
      if (!showOutliers) continue;
      const sz = 5;
      ctx.strokeStyle = isStatOutlier ? "#ff1744" : "#555";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - sz, cy - sz);
      ctx.lineTo(cx + sz, cy + sz);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + sz, cy - sz);
      ctx.lineTo(cx - sz, cy + sz);
      ctx.stroke();
      if (isStatOutlier) {
        ctx.fillStyle = "#ff1744";
        ctx.font = "9px sans-serif";
        ctx.fillText("outlier", cx + 8, cy + 3);
      }
    } else {
      const r = Math.round(50 + 205 * t);
      const g = Math.round(200 - 150 * t);
      ctx.fillStyle = `rgb(${r},${g},50)`;
      ctx.beginPath();
      ctx.arc(cx, cy, i === 0 || i === xs.length - 1 ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (i === 0) {
      ctx.fillStyle = "#aaa";
      ctx.font = "10px sans-serif";
      ctx.fillText("START", cx + 8, cy - 4);
    }
    if (i === xs.length - 1) {
      ctx.fillStyle = "#aaa";
      ctx.font = "10px sans-serif";
      ctx.fillText("END", cx + 8, cy - 4);
    }
  }

  // Legend
  ctx.font = "11px sans-serif";
  const legendY = H - 15;
  ctx.fillStyle = "#e0e0e0";
  ctx.fillText("Legend:", pad, legendY);
  ctx.fillRect(pad + 55, legendY - 6, 16, 2);
  ctx.fillText("Trajectory", pad + 75, legendY);
  ctx.fillStyle = "#ff5722";
  ctx.fillRect(pad + 155, legendY - 6, 16, 2);
  ctx.fillText("Old (endpoint)", pad + 175, legendY);
  ctx.fillStyle = "#4fc3f7";
  ctx.fillRect(pad + 285, legendY - 6, 16, 2);
  ctx.fillText("New (parabolic)", pad + 305, legendY);
  ctx.fillStyle = "#ff1744";
  ctx.fillText("X", pad + 405, legendY + 1);
  ctx.fillText("Outlier", pad + 415, legendY);
  ctx.fillStyle = "#555";
  ctx.fillText("X", pad + 470, legendY + 1);
  ctx.fillText("Trimmed", pad + 480, legendY);
}

function drawOverlayTrajectories(
  ctx: CanvasRenderingContext2D,
  shots: TrajectoryShot[],
  W: number,
  H: number
) {
  const allSeries: { xs: number[]; ys: number[]; shot: TrajectoryShot }[] = [];
  let globalMinX = Infinity,
    globalMaxX = -Infinity,
    globalMinY = Infinity,
    globalMaxY = -Infinity;

  for (const shot of shots) {
    const rawXs = shot.normX.length === shot.trajY.length ? shot.normX : shot.trajX;
    const rawYs = shot.trajY;
    if (rawXs.length < 2) continue;
    const x0 = rawXs[0],
      y0 = rawYs[0];
    const xs = rawXs.map((x) => x - x0);
    const ys = rawYs.map((y) => y - y0);
    for (const x of xs) {
      if (x < globalMinX) globalMinX = x;
      if (x > globalMaxX) globalMaxX = x;
    }
    for (const y of ys) {
      if (y < globalMinY) globalMinY = y;
      if (y > globalMaxY) globalMaxY = y;
    }
    allSeries.push({ xs, ys, shot });
  }

  if (allSeries.length === 0) return;

  globalMinX -= 10;
  globalMaxX += 10;
  globalMinY -= 10;
  globalMaxY += 10;
  const rangeX = globalMaxX - globalMinX || 1;
  const rangeY = globalMaxY - globalMinY || 1;
  const pad = 50;
  const plotW = W - 2 * pad;
  const plotH = H - 2 * pad;
  const scale = Math.min(plotW / rangeX, plotH / rangeY);
  const offX = pad + (plotW - rangeX * scale) / 2;
  const offY = pad + (plotH - rangeY * scale) / 2;
  const tc = (x: number, y: number): [number, number] =>
    toCanvasCoords(x, y, globalMinX, globalMaxY, scale, offX, offY);

  // Crosshair
  const [ox, oy] = tc(0, 0);
  ctx.strokeStyle = "#333";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, pad);
  ctx.lineTo(ox, H - pad);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pad, oy);
  ctx.lineTo(W - pad, oy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Classification-based color counters
  const classCounters: Record<string, number> = {};

  for (const { xs, ys, shot } of allSeries) {
    const cls = shot.newResult.label;
    const idx = classCounters[cls] || 0;
    classCounters[cls] = idx + 1;
    const shades = CLASS_SHADES[cls] || ["#888"];
    const color = shades[idx % shades.length];

    const mask = computeOutlierMask(xs, ys);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < xs.length; i++) {
      if (mask[i]) continue;
      const [cx, cy] = tc(xs[i], ys[i]);
      if (!started) {
        ctx.moveTo(cx, cy);
        started = true;
      } else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Start dot
    const [sx, sy] = tc(xs[0], ys[0]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend
  ctx.font = "11px sans-serif";
  let lx = pad;
  const ly = H - 15;
  for (const { shot } of allSeries) {
    const color = CLASS_COLORS[shot.newResult.label] || "#888";
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly - 5, 10, 10);
    lx += 14;
    const shortName = shot.videoName.replace(".MP4", "").replace(/^\d{8}/, "");
    ctx.fillText(
      `${shortName} (${shot.newResult.angle.toFixed(1)}°)`,
      lx,
      ly + 4
    );
    lx += ctx.measureText(`${shortName} (${shot.newResult.angle.toFixed(1)}°)`).width + 16;
    if (lx > W - 100) break;
  }
}

export default function TrajectoryCanvas({
  shot,
  overlayShots,
  showOutliers = true,
  width = 800,
  height = 500,
}: TrajectoryCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    if (overlayShots && overlayShots.length > 0) {
      drawOverlayTrajectories(ctx, overlayShots, width, height);
    } else if (shot) {
      drawSingleTrajectory(ctx, shot, width, height, showOutliers);
    }
  }, [shot, overlayShots, showOutliers, width, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full rounded-lg"
      style={{ background: "#0f1117" }}
    />
  );
}
