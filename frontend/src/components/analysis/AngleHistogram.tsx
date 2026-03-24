"use client";

import React, { useRef, useEffect } from "react";
import { CLASS_COLORS } from "@/lib/trajectory-classifier";

interface AngleHistogramProps {
  angles: number[];
  threshModerate: number;
  threshHard: number;
  width?: number;
  height?: number;
}

export default function AngleHistogram({
  angles,
  threshModerate,
  threshHard,
  width = 500,
  height = 120,
}: AngleHistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    if (angles.length === 0) return;

    const absAngles = angles.map(Math.abs);
    const maxAngle = Math.max(...absAngles, threshHard + 10);
    const binCount = 40;
    const binWidth = maxAngle / binCount;
    const bins = new Array(binCount).fill(0);

    for (const a of absAngles) {
      const bin = Math.min(Math.floor(a / binWidth), binCount - 1);
      bins[bin]++;
    }

    const maxBin = Math.max(...bins, 1);
    const barW = (width - 40) / binCount;
    const plotH = height - 30;

    for (let i = 0; i < binCount; i++) {
      const barH = (bins[i] / maxBin) * plotH;
      const x = 30 + i * barW;
      const y = plotH - barH;
      const angle = (i + 0.5) * binWidth;

      if (angle >= threshHard) ctx.fillStyle = CLASS_COLORS.hard_right;
      else if (angle >= threshModerate) ctx.fillStyle = CLASS_COLORS.moderate_right;
      else ctx.fillStyle = CLASS_COLORS.straight;

      ctx.fillRect(x, y, barW - 1, barH);
    }

    // Threshold lines
    const drawThreshLine = (val: number, color: string, label: string) => {
      const x = 30 + (val / maxAngle) * (width - 40);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "9px sans-serif";
      ctx.fillText(label, x + 3, 10);
    };

    drawThreshLine(threshModerate, "#ff9800", `${threshModerate}°`);
    drawThreshLine(threshHard, "#ef5350", `${threshHard}°`);

    // Axis labels
    ctx.fillStyle = "#666";
    ctx.font = "10px sans-serif";
    ctx.fillText("0°", 30, height - 5);
    ctx.fillText(`${Math.round(maxAngle)}°`, width - 35, height - 5);
    ctx.fillText("|angle|", width / 2 - 15, height - 5);
  }, [angles, threshModerate, threshHard, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full rounded-md"
      style={{ background: "#0f1117" }}
    />
  );
}
