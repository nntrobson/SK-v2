"use client";

import React, { useRef, useEffect, useCallback } from "react";
import {
  type TrajectoryClassificationResult,
  CLASS_COLORS,
  CLASS_SHADES,
} from "@/lib/trajectory-classifier";

export interface TrajectoryShot {
  videoName: string;
  trajX: number[];
  trajY: number[];
  result: TrajectoryClassificationResult;
}

interface TrajectoryCanvasProps {
  shot?: TrajectoryShot;
  overlayShots?: TrajectoryShot[];
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

function computePlotLayout(
  xs: number[],
  ys: number[],
  W: number,
  H: number,
  pad: number
) {
  const minX = Math.min(...xs) - 10;
  const maxX = Math.max(...xs) + 10;
  const minY = Math.min(...ys) - 10;
  const maxY = Math.max(...ys) + 10;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const plotW = W - 2 * pad;
  const plotH = H - 2 * pad;
  const scale = Math.min(plotW / rangeX, plotH / rangeY);
  const offX = pad + (plotW - rangeX * scale) / 2;
  const offY = pad + (plotH - rangeY * scale) / 2;
  return { minX, maxX, minY, maxY, rangeX, rangeY, scale, offX, offY };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof computePlotLayout>,
  W: number,
  H: number,
  pad: number
) {
  const { minX, maxX, minY, maxY, rangeX } = layout;
  const tc = (x: number, y: number) =>
    toCanvasCoords(x, y, layout.minX, layout.maxY, layout.scale, layout.offX, layout.offY);

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
}

function drawSingleTrajectory(
  ctx: CanvasRenderingContext2D,
  shot: TrajectoryShot,
  W: number,
  H: number
) {
  const rawXs = shot.trajX;
  const rawYs = shot.trajY;
  if (rawXs.length < 2) return;

  const x0 = rawXs[0], y0 = rawYs[0];
  const xs = rawXs.map((x) => x - x0);
  const ys = rawYs.map((y) => y - y0);

  const pad = 50;
  const layout = computePlotLayout(xs, ys, W, H, pad);
  const tc = (x: number, y: number) =>
    toCanvasCoords(x, y, layout.minX, layout.maxY, layout.scale, layout.offX, layout.offY);

  drawGrid(ctx, layout, W, H, pad);

  // Direction line (head cluster → tail cluster)
  const { headX: hx, headY: hy, tailX: tx, tailY: ty } = shot.result;
  const dhx = hx - rawXs[0], dhy = hy - rawYs[0];
  const dtx = tx - rawXs[0], dty = ty - rawYs[0];
  const [ch0, ch1] = tc(dhx, dhy);
  const [ct0, ct1] = tc(dtx, dty);
  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(ch0, ch1);
  ctx.lineTo(ct0, ct1);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead on direction line
  const arrowLen = 10;
  const angle = Math.atan2(ct1 - ch1, ct0 - ch0);
  ctx.fillStyle = "#4fc3f7";
  ctx.beginPath();
  ctx.moveTo(ct0, ct1);
  ctx.lineTo(
    ct0 - arrowLen * Math.cos(angle - 0.4),
    ct1 - arrowLen * Math.sin(angle - 0.4)
  );
  ctx.lineTo(
    ct0 - arrowLen * Math.cos(angle + 0.4),
    ct1 - arrowLen * Math.sin(angle + 0.4)
  );
  ctx.closePath();
  ctx.fill();

  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#4fc3f7";
  ctx.fillText(`${shot.result.angle.toFixed(1)}°`, ct0 + 8, ct1 + 4);

  // Trajectory path (all points, like the scatter plot trail)
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const [cx, cy] = tc(xs[i], ys[i]);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Points with time-based coloring
  for (let i = 0; i < xs.length; i++) {
    const [cx, cy] = tc(xs[i], ys[i]);
    const t = xs.length > 1 ? i / (xs.length - 1) : 0;
    const r = Math.round(50 + 205 * t);
    const g = Math.round(200 - 150 * t);
    ctx.fillStyle = `rgb(${r},${g},50)`;
    ctx.beginPath();
    ctx.arc(cx, cy, i === 0 || i === xs.length - 1 ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();

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

  // Head/tail cluster markers
  ctx.strokeStyle = "#4fc3f780";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(ch0, ch1, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ct0, ct1, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Legend
  ctx.font = "11px sans-serif";
  const legendY = H - 15;
  ctx.fillStyle = "#e0e0e0";
  ctx.fillText("Legend:", pad, legendY);
  ctx.fillRect(pad + 55, legendY - 6, 16, 2);
  ctx.fillText("Trajectory", pad + 75, legendY);
  ctx.fillStyle = "#4fc3f7";
  ctx.fillRect(pad + 160, legendY - 6, 16, 2);
  ctx.fillText("Direction angle", pad + 180, legendY);
}

function drawOverlayTrajectories(
  ctx: CanvasRenderingContext2D,
  shots: TrajectoryShot[],
  W: number,
  H: number
) {
  const allSeries: { xs: number[]; ys: number[]; shot: TrajectoryShot }[] = [];
  let globalMinX = Infinity, globalMaxX = -Infinity;
  let globalMinY = Infinity, globalMaxY = -Infinity;

  for (const shot of shots) {
    const rawXs = shot.trajX;
    const rawYs = shot.trajY;
    if (rawXs.length < 2) continue;
    const x0 = rawXs[0], y0 = rawYs[0];
    const xs = rawXs.map((x) => x - x0);
    const ys = rawYs.map((y) => y - y0);
    for (const x of xs) { globalMinX = Math.min(globalMinX, x); globalMaxX = Math.max(globalMaxX, x); }
    for (const y of ys) { globalMinY = Math.min(globalMinY, y); globalMaxY = Math.max(globalMaxY, y); }
    allSeries.push({ xs, ys, shot });
  }

  if (allSeries.length === 0) return;

  globalMinX -= 10; globalMaxX += 10;
  globalMinY -= 10; globalMaxY += 10;
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
  ctx.beginPath(); ctx.moveTo(ox, pad); ctx.lineTo(ox, H - pad); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad, oy); ctx.lineTo(W - pad, oy); ctx.stroke();
  ctx.setLineDash([]);

  const classCounters: Record<string, number> = {};

  for (const { xs, ys, shot } of allSeries) {
    const cls = shot.result.label;
    const idx = classCounters[cls] || 0;
    classCounters[cls] = idx + 1;
    const shades = CLASS_SHADES[cls] || ["#888"];
    const color = shades[idx % shades.length];

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const [cx, cy] = tc(xs[i], ys[i]);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

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
    const color = CLASS_COLORS[shot.result.label] || "#888";
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly - 5, 10, 10);
    lx += 14;
    const shortName = shot.videoName.replace(".MP4", "").replace(/^\d{8}/, "");
    const label = `${shortName} (${shot.result.angle.toFixed(1)}°)`;
    ctx.fillText(label, lx, ly + 4);
    lx += ctx.measureText(label).width + 16;
    if (lx > W - 100) break;
  }
}

export default function TrajectoryCanvas({
  shot,
  overlayShots,
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
      drawSingleTrajectory(ctx, shot, width, height);
    }
  }, [shot, overlayShots, width, height]);

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
