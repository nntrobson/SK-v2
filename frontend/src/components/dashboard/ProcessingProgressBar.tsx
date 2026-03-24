"use client";

import React from "react";

export type ProcessingPayload = {
  progress_percent: number | null;
  stage: string | null;
  eta_seconds: number | null;
};

function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `Est. ${h}h ${mm}m remaining`;
  }
  if (m > 0) return `Est. ${m}m ${rem}s remaining`;
  return `Est. ${rem}s remaining`;
}

export function ProcessingProgressBar({
  processing,
  compact = false,
}: {
  processing: ProcessingPayload;
  compact?: boolean;
}) {
  const pct =
    processing.progress_percent != null
      ? Math.min(100, Math.max(0, processing.progress_percent))
      : null;
  const eta = formatEta(processing.eta_seconds);
  const stage = processing.stage?.trim() || "Processing video";
  const sl = stage.toLowerCase();
  const isComplete = sl === "complete";
  const isFailed =
    sl.includes("failed") || sl.includes("no shot detected");

  return (
    <div className={compact ? "flex flex-col gap-1.5 min-w-[10rem] max-w-[16rem]" : "flex flex-col gap-2 w-full max-w-xs"}>
      <div className="flex items-center gap-2">
        {isComplete ? (
          <div className="w-4 h-4 rounded-full bg-emerald-500/80 shrink-0 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
        ) : isFailed ? (
          <div className="w-4 h-4 rounded-full bg-rose-500/90 shrink-0 shadow-[0_0_8px_rgba(244,63,94,0.45)]" />
        ) : (
          <div className="w-4 h-4 border-2 border-slate-600 border-t-sky-400 rounded-full animate-spin shrink-0" />
        )}
        <span
          className={`font-medium tracking-wide text-sm ${
            isComplete ? "text-emerald-400" : isFailed ? "text-rose-400" : "text-sky-400"
          }`}
        >
          {stage}
        </span>
      </div>
      <div className="h-2 bg-slate-800/80 rounded-full overflow-hidden border border-slate-700/50">
        <div
          className={`h-full transition-[width] duration-500 ease-out rounded-full ${
            isComplete
              ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
              : isFailed
                ? "bg-gradient-to-r from-rose-700 to-rose-500"
                : "bg-gradient-to-r from-sky-600 to-sky-400"
          }`}
          style={{ width: isFailed ? "100%" : pct != null ? `${pct}%` : "8%" }}
        />
      </div>
      <div className="flex justify-between items-baseline gap-2 text-xs text-slate-500">
        <span className="truncate">
          {isFailed ? "—" : isComplete ? "100% complete" : pct != null ? `${Math.round(pct)}% complete` : "Starting…"}
        </span>
        {eta && !isFailed && !isComplete ? <span className="shrink-0 text-slate-400">{eta}</span> : null}
      </div>
    </div>
  );
}
