"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Download, SlidersHorizontal, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  classifyOld,
  classifyNew,
  autoDetectThresholds,
  CLASS_COLORS,
  DIRECTION_LABELS,
  type NewClassificationResult,
} from "@/lib/trajectory-classifier";
import TrajectoryCanvas, {
  type TrajectoryShot,
} from "@/components/analysis/TrajectoryCanvas";
import AngleHistogram from "@/components/analysis/AngleHistogram";

interface ApiShot {
  id: number;
  video_name: string;
  station: string | null;
  presentation: string;
  break_label: string | null;
  trajectory: Array<{ x: number; y: number }>;
}

interface ProcessedShot {
  idx: number;
  id: number;
  videoName: string;
  station: string;
  trajectory: Array<{ x: number; y: number }>;
  trajX: number[];
  trajY: number[];
  normX: number[];
  oldLabel: string;
  oldDeltaX: number;
  newResult: NewClassificationResult;
  agree: boolean;
}

const BADGE_STYLES: Record<string, string> = {
  hard_left: "bg-red-900/40 text-red-300 border-red-700/40",
  moderate_left: "bg-orange-900/40 text-orange-300 border-orange-700/40",
  straight: "bg-green-900/40 text-green-300 border-green-700/40",
  moderate_right: "bg-blue-900/40 text-blue-300 border-blue-700/40",
  hard_right: "bg-violet-900/40 text-violet-300 border-violet-700/40",
};

function DirectionBadge({ label }: { label: string }) {
  return (
    <span
      className={cn(
        "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border",
        BADGE_STYLES[label] || "bg-slate-800 text-slate-400 border-slate-700"
      )}
    >
      {label.replace("_", " ")}
    </span>
  );
}

export default function AnalysisPage() {
  const [apiShots, setApiShots] = useState<ApiShot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [multiSelected, setMultiSelected] = useState<Set<number>>(new Set());
  const [filterMode, setFilterMode] = useState("all");
  const [stationFilter, setStationFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [showOutliers, setShowOutliers] = useState(true);
  const [showTuning, setShowTuning] = useState(false);
  const [threshModerate, setThreshModerate] = useState(8);
  const [threshHard, setThreshHard] = useState(30);
  const [userLabels, setUserLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem("trajectoryLabels");
      if (saved) setUserLabels(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch("http://localhost:8000/api/shots")
      .then((r) => r.json())
      .then((data: ApiShot[]) => {
        setApiShots(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const shots = useMemo<ProcessedShot[]>(() => {
    return apiShots
      .filter((s) => s.trajectory && s.trajectory.length >= 2)
      .map((s, i) => {
        const trajX = s.trajectory.map((p) => p.x);
        const trajY = s.trajectory.map((p) => p.y);
        const station = s.station || "unknown";

        // Station-corrected normalized X
        const normX = trajX.map((x) => {
          if (station === "trap-house-1-2") return x - 3.5;
          if (station === "trap-house-4-5") return x + 3.5;
          return x;
        });

        const oldResult = classifyOld(normX, station);

        // Origin-normalize for parabolic classification
        const x0 = normX[0] || 0,
          y0 = trajY[0] || 0;
        const normXOrigin = normX.map((x) => x - x0);
        const normYOrigin = trajY.map((y) => y - y0);
        const newResult = classifyNew(
          normXOrigin,
          normYOrigin,
          threshModerate,
          threshHard
        );

        return {
          idx: i,
          id: s.id,
          videoName: s.video_name,
          station,
          trajectory: s.trajectory,
          trajX,
          trajY,
          normX,
          oldLabel: oldResult.label,
          oldDeltaX: oldResult.deltaX,
          newResult,
          agree: oldResult.label === newResult.label,
        };
      });
  }, [apiShots, threshModerate, threshHard]);

  // Auto-detect thresholds on first load
  useEffect(() => {
    if (shots.length > 4) {
      const angles = shots.map((s) => s.newResult.angle);
      const [mod, hard] = autoDetectThresholds(angles);
      setThreshModerate(mod);
      setThreshHard(hard);
    }
  }, [apiShots.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const stations = useMemo(() => {
    const set = new Set(shots.map((s) => s.station));
    return Array.from(set).sort();
  }, [shots]);

  const filteredShots = useMemo(() => {
    return shots.filter((s) => {
      if (stationFilter !== "all" && s.station !== stationFilter) return false;
      if (directionFilter !== "all" && s.newResult.label !== directionFilter)
        return false;
      if (filterMode === "differ") return !s.agree;
      if (filterMode === "unclassified") return !userLabels[s.videoName];
      if (filterMode === "classified") return !!userLabels[s.videoName];
      return true;
    });
  }, [shots, stationFilter, directionFilter, filterMode, userLabels]);

  const agreeCount = useMemo(() => shots.filter((s) => s.agree).length, [shots]);
  const differCount = useMemo(
    () => shots.filter((s) => !s.agree).length,
    [shots]
  );
  const userCount = Object.keys(userLabels).length;

  const allAngles = useMemo(
    () => shots.map((s) => s.newResult.angle),
    [shots]
  );

  const selectedShot =
    selectedIdx >= 0 && selectedIdx < filteredShots.length
      ? filteredShots[selectedIdx]
      : null;

  const handleShotClick = useCallback(
    (idx: number, e: React.MouseEvent) => {
      if (e.shiftKey && (selectedIdx >= 0 || multiSelected.size > 0)) {
        const anchor = selectedIdx >= 0 ? selectedIdx : Math.min(...multiSelected);
        const lo = Math.min(anchor, idx);
        const hi = Math.max(anchor, idx);
        setMultiSelected((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(i);
          return next;
        });
      } else if (e.metaKey || e.ctrlKey) {
        setMultiSelected((prev) => {
          const next = new Set(prev);
          if (next.has(idx)) next.delete(idx);
          else next.add(idx);
          return next;
        });
      } else {
        setSelectedIdx(idx);
        setMultiSelected(new Set());
      }
    },
    [selectedIdx, multiSelected]
  );

  const setUserLabel = useCallback(
    (videoName: string, label: string) => {
      const next = { ...userLabels, [videoName]: label };
      setUserLabels(next);
      localStorage.setItem("trajectoryLabels", JSON.stringify(next));
    },
    [userLabels]
  );

  const clearUserLabel = useCallback(
    (videoName: string) => {
      const next = { ...userLabels };
      delete next[videoName];
      setUserLabels(next);
      localStorage.setItem("trajectoryLabels", JSON.stringify(next));
    },
    [userLabels]
  );

  const navShot = useCallback(
    (delta: number) => {
      const next = selectedIdx + delta;
      if (next >= 0 && next < filteredShots.length) {
        setSelectedIdx(next);
        setMultiSelected(new Set());
      }
    },
    [selectedIdx, filteredShots.length]
  );

  const exportCSV = useCallback(() => {
    const header = "video_name,station,old_label,old_delta_x,new_label,new_angle,r2,user_label\n";
    const rows = shots
      .map(
        (s) =>
          `${s.videoName},${s.station},${s.oldLabel},${s.oldDeltaX.toFixed(2)},${s.newResult.label},${s.newResult.angle.toFixed(2)},${s.newResult.r2.toFixed(4)},${userLabels[s.videoName] || ""}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trajectory_classifications.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [shots, userLabels]);

  const exportUserLabels = useCallback(() => {
    const blob = new Blob([JSON.stringify(userLabels, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "user_trajectory_labels.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [userLabels]);

  // Build overlay TrajectoryShots
  const overlayTrajectoryShots = useMemo<TrajectoryShot[]>(() => {
    if (multiSelected.size === 0) return [];
    return [...multiSelected]
      .map((i) => filteredShots[i])
      .filter(Boolean)
      .map((s) => ({
        videoName: s.videoName,
        trajX: s.trajX,
        trajY: s.trajY,
        normX: s.normX,
        newResult: s.newResult,
        oldDeltaX: s.oldDeltaX,
      }));
  }, [multiSelected, filteredShots]);

  const selectedTrajectoryShot = useMemo<TrajectoryShot | undefined>(() => {
    if (!selectedShot) return undefined;
    return {
      videoName: selectedShot.videoName,
      trajX: selectedShot.trajX,
      trajY: selectedShot.trajY,
      normX: selectedShot.normX,
      newResult: selectedShot.newResult,
      oldDeltaX: selectedShot.oldDeltaX,
    };
  }, [selectedShot]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-slate-400 text-lg">Loading trajectory data...</div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-[calc(100vh-8rem)]"
    >
      {/* Header */}
      <div className="flex items-center gap-5 px-5 py-3 glass-panel rounded-xl mb-3 border border-slate-700/50">
        <Activity className="w-5 h-5 text-cyan-400" />
        <h1 className="text-lg font-bold text-white tracking-tight">
          Trajectory Direction Validator
        </h1>
        <div className="text-xs text-slate-400 flex gap-3">
          <span>
            <span className="text-cyan-400 font-semibold">{shots.length}</span>{" "}
            shots
          </span>
          <span>
            Agree:{" "}
            <span className="text-cyan-400 font-semibold">{agreeCount}</span>
          </span>
          <span>
            Differ:{" "}
            <span className="text-cyan-400 font-semibold">{differCount}</span>
          </span>
          <span>
            Labeled:{" "}
            <span className="text-cyan-400 font-semibold">{userCount}</span>
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 px-5 py-2 glass-panel rounded-xl mb-3 border border-slate-700/50 flex-wrap">
        <label className="text-xs text-slate-400">Filter:</label>
        <select
          value={filterMode}
          onChange={(e) => {
            setFilterMode(e.target.value);
            setSelectedIdx(-1);
            setMultiSelected(new Set());
          }}
          className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1.5 rounded-lg"
        >
          <option value="all">All shots</option>
          <option value="differ">Old != New only</option>
          <option value="unclassified">Not yet labeled</option>
          <option value="classified">User labeled</option>
        </select>

        <label className="text-xs text-slate-400">Station:</label>
        <select
          value={stationFilter}
          onChange={(e) => {
            setStationFilter(e.target.value);
            setSelectedIdx(-1);
            setMultiSelected(new Set());
          }}
          className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1.5 rounded-lg"
        >
          <option value="all">All stations</option>
          {stations.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="text-xs text-slate-400">Direction:</label>
        <select
          value={directionFilter}
          onChange={(e) => {
            setDirectionFilter(e.target.value);
            setSelectedIdx(-1);
            setMultiSelected(new Set());
          }}
          className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1.5 rounded-lg"
        >
          <option value="all">All directions</option>
          {DIRECTION_LABELS.map((d) => (
            <option key={d} value={d}>
              {d.replace("_", " ")}
            </option>
          ))}
        </select>

        {multiSelected.size > 0 && (
          <button
            onClick={() => setMultiSelected(new Set())}
            className="bg-rose-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-rose-500 transition-colors"
          >
            Clear Overlay ({multiSelected.size})
          </button>
        )}

        <button
          onClick={exportCSV}
          className="bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-emerald-500 transition-colors flex items-center gap-1.5"
        >
          <Download className="w-3 h-3" /> Export CSV
        </button>
        <button
          onClick={exportUserLabels}
          className="bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-600 transition-colors"
        >
          Export Labels JSON
        </button>

        <button
          onClick={() => setShowTuning(!showTuning)}
          className={cn(
            "text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5",
            showTuning
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/10"
              : "border-slate-700 text-slate-400 hover:border-cyan-500 hover:text-cyan-400"
          )}
        >
          <SlidersHorizontal className="w-3 h-3" /> Tuning
        </button>

        <label className="text-xs text-slate-400 flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOutliers}
            onChange={(e) => setShowOutliers(e.target.checked)}
            className="accent-cyan-400"
          />
          Show outliers
        </label>

        <span className="text-[10px] text-slate-600 ml-2">
          Cmd/Ctrl+click to overlay, Shift+click to range-select
        </span>
      </div>

      {/* Tuning Panel */}
      {showTuning && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="glass-panel rounded-xl mb-3 border border-slate-700/50 overflow-hidden"
        >
          <div className="p-4 flex gap-8 items-start flex-wrap">
            <div className="min-w-[260px]">
              <div className="text-xs text-slate-400 font-semibold mb-2">
                Angle Thresholds (degrees from vertical)
              </div>
              <div className="flex items-center gap-2 text-xs mb-2">
                <label className="w-24 text-slate-400">Hard (&ge;)</label>
                <input
                  type="range"
                  min={15}
                  max={60}
                  value={threshHard}
                  onChange={(e) => setThreshHard(Number(e.target.value))}
                  className="flex-1 accent-cyan-400"
                />
                <span className="w-8 text-right text-cyan-400 font-mono font-semibold">
                  {threshHard}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs mb-2">
                <label className="w-24 text-slate-400">Moderate (&ge;)</label>
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={threshModerate}
                  onChange={(e) => setThreshModerate(Number(e.target.value))}
                  className="flex-1 accent-cyan-400"
                />
                <span className="w-8 text-right text-cyan-400 font-mono font-semibold">
                  {threshModerate}
                </span>
              </div>
              <div className="text-[10px] text-slate-600 mt-1">
                |angle| &lt; moderate = straight
                <br />
                moderate &le; |angle| &lt; hard = moderate
                <br />
                |angle| &ge; hard = hard
              </div>
            </div>
            <div className="flex-1 min-w-[300px]">
              <div className="text-xs text-slate-400 font-semibold mb-2">
                Angle Distribution (all shots)
              </div>
              <AngleHistogram
                angles={allAngles}
                threshModerate={threshModerate}
                threshHard={threshHard}
              />
            </div>
            <div className="text-[11px] text-slate-500 min-w-[180px]">
              <div>
                Straight:{" "}
                <span className="text-cyan-400 font-semibold">
                  {shots.filter((s) => s.newResult.label === "straight").length}
                </span>
              </div>
              <div>
                Moderate:{" "}
                <span className="text-cyan-400 font-semibold">
                  {
                    shots.filter(
                      (s) =>
                        s.newResult.label === "moderate_left" ||
                        s.newResult.label === "moderate_right"
                    ).length
                  }
                </span>
              </div>
              <div>
                Hard:{" "}
                <span className="text-cyan-400 font-semibold">
                  {
                    shots.filter(
                      (s) =>
                        s.newResult.label === "hard_left" ||
                        s.newResult.label === "hard_right"
                    ).length
                  }
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 gap-3 overflow-hidden">
        {/* Shot List */}
        <div className="w-80 min-w-[320px] glass-panel rounded-xl border border-slate-700/50 overflow-y-auto">
          {filteredShots.length === 0 && (
            <div className="text-slate-500 text-sm text-center py-10">
              No shots match filters
            </div>
          )}
          {filteredShots.map((shot, i) => {
            const isActive = i === selectedIdx;
            const isMulti = multiSelected.has(i);
            const userLabel = userLabels[shot.videoName];
            return (
              <div
                key={shot.id}
                onClick={(e) => handleShotClick(i, e)}
                className={cn(
                  "px-4 py-2.5 border-b border-slate-800/50 cursor-pointer flex items-center gap-2 text-xs transition-colors",
                  isActive && "bg-slate-800/80 border-l-[3px] border-l-cyan-500",
                  isMulti && !isActive && "bg-emerald-950/30 border-l-[3px] border-l-emerald-500",
                  !isActive && !isMulti && "hover:bg-slate-800/40"
                )}
              >
                {isMulti && (
                  <span
                    style={{ color: CLASS_COLORS[shot.newResult.label] || "#888" }}
                    className="text-base leading-none"
                  >
                    ●
                  </span>
                )}
                <span className="text-slate-600 w-6 text-right text-[11px]">
                  {shot.idx + 1}
                </span>
                <span className="flex-1 font-mono text-[11px] text-slate-300 truncate">
                  {shot.videoName.replace(".MP4", "")}
                </span>
                <div className="flex gap-1 flex-shrink-0">
                  {userLabel && <DirectionBadge label={userLabel} />}
                  {!shot.agree && (
                    <span className="px-1 py-0.5 rounded text-[9px] font-bold uppercase bg-red-900/40 text-red-400 border border-red-700/40">
                      DIFF
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="flex-1 overflow-y-auto space-y-3">
          {multiSelected.size > 0 ? (
            /* Overlay View */
            <div className="glass-panel rounded-xl border border-slate-700/50 p-5">
              <h3 className="text-sm text-slate-400 mb-3">
                Overlay: {multiSelected.size} trajectories
              </h3>
              <TrajectoryCanvas overlayShots={overlayTrajectoryShots} />
              <div className="mt-3 flex flex-wrap gap-3">
                {overlayTrajectoryShots.map((s) => (
                  <div
                    key={s.videoName}
                    className="glass-panel rounded-lg p-3 border border-slate-700/50 text-xs"
                    style={{
                      borderColor: CLASS_COLORS[s.newResult.label] || "#888",
                    }}
                  >
                    <div
                      className="font-semibold mb-1"
                      style={{
                        color: CLASS_COLORS[s.newResult.label] || "#888",
                      }}
                    >
                      {s.videoName.replace(".MP4", "")}
                    </div>
                    <div className="text-slate-500">
                      <DirectionBadge label={s.newResult.label} />{" "}
                      {s.newResult.angle.toFixed(1)}° R²=
                      {s.newResult.r2.toFixed(3)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : selectedShot ? (
            /* Single Shot Detail */
            <>
              {/* Classification Cards */}
              <div className="flex gap-3">
                <div className="flex-1 glass-panel rounded-xl border-2 border-slate-600/50 p-4 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                    Old Method (endpoint delta)
                  </div>
                  <DirectionBadge label={selectedShot.oldLabel} />
                  <div className="text-[11px] text-slate-500 mt-2">
                    delta_x = {selectedShot.oldDeltaX.toFixed(1)} in
                  </div>
                </div>
                <div className="flex-1 glass-panel rounded-xl border-2 border-cyan-500/40 p-4 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                    New Method (parabolic fit)
                  </div>
                  <DirectionBadge label={selectedShot.newResult.label} />
                  <div className="text-[11px] text-slate-500 mt-2">
                    angle = {selectedShot.newResult.angle.toFixed(1)}° | R² ={" "}
                    {selectedShot.newResult.r2.toFixed(3)}
                  </div>
                </div>
                <div className="flex-1 glass-panel rounded-xl border-2 border-violet-500/40 p-4 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                    Your Label
                  </div>
                  {userLabels[selectedShot.videoName] ? (
                    <DirectionBadge label={userLabels[selectedShot.videoName]} />
                  ) : (
                    <span className="text-slate-600 text-xs">not set</span>
                  )}
                  <div className="text-[11px] text-slate-500 mt-2">
                    {userLabels[selectedShot.videoName]
                      ? userLabels[selectedShot.videoName] ===
                        selectedShot.newResult.label
                        ? "Matches NEW"
                        : userLabels[selectedShot.videoName] ===
                            selectedShot.oldLabel
                          ? "Matches OLD"
                          : "Matches neither"
                      : "Click below to classify"}
                  </div>
                </div>
              </div>

              {/* Trajectory Plot */}
              <div className="glass-panel rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm text-slate-400 mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4" /> Trajectory Plot
                  (origin-normalized, inches)
                </h3>
                <TrajectoryCanvas
                  shot={selectedTrajectoryShot}
                  showOutliers={showOutliers}
                />
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-panel rounded-xl border border-slate-700/50 p-4">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                    Video
                  </div>
                  <div className="text-sm font-mono text-white">
                    {selectedShot.videoName}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Station: {selectedShot.station} | Points:{" "}
                    {selectedShot.trajectory.length}
                  </div>
                </div>
                <div className="glass-panel rounded-xl border border-slate-700/50 p-4">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                    Metrics
                  </div>
                  <div className="text-xs text-slate-400 space-y-0.5">
                    <div>
                      Endpoint delta (norm): {selectedShot.oldDeltaX.toFixed(1)}{" "}
                      in
                    </div>
                    <div>
                      Quadratic: x ={" "}
                      {selectedShot.newResult.a.toFixed(5)}y² +{" "}
                      {selectedShot.newResult.b.toFixed(3)}y +{" "}
                      {selectedShot.newResult.c.toFixed(2)}
                    </div>
                    <div>
                      Tangent slope at midpoint:{" "}
                      {selectedShot.newResult.slopeAtMid.toFixed(4)}
                    </div>
                    <div>
                      Angle: {selectedShot.newResult.angle.toFixed(1)}° | R²:{" "}
                      {selectedShot.newResult.r2.toFixed(4)}
                    </div>
                    <div>
                      Points used: {selectedShot.newResult.trimmedN} (
                      {selectedShot.newResult.outliers} outliers removed)
                    </div>
                  </div>
                </div>
              </div>

              {/* User Classification */}
              <div className="glass-panel rounded-xl border border-slate-700/50 p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">
                  Your Classification
                </div>
                <div className="flex gap-2 flex-wrap">
                  {DIRECTION_LABELS.map((d) => (
                    <button
                      key={d}
                      onClick={() =>
                        setUserLabel(selectedShot.videoName, d)
                      }
                      className={cn(
                        "px-4 py-2 rounded-lg border-2 text-xs font-semibold transition-all",
                        userLabels[selectedShot.videoName] === d
                          ? "border-violet-500 bg-violet-500/10 text-violet-300"
                          : "border-slate-700 text-slate-400 hover:border-cyan-500 hover:text-cyan-400"
                      )}
                    >
                      {d.replace("_", " ")}
                    </button>
                  ))}
                  <button
                    onClick={() => clearUserLabel(selectedShot.videoName)}
                    className="px-4 py-2 rounded-lg border-2 border-slate-800 text-xs text-slate-600 hover:text-slate-400 hover:border-slate-600 transition-all"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => navShot(-1)}
                    disabled={selectedIdx <= 0}
                    className="flex-1 py-2.5 rounded-lg bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() => navShot(1)}
                    disabled={selectedIdx >= filteredShots.length - 1}
                    className="flex-1 py-2.5 rounded-lg bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>

              {/* Distribution Summary */}
              <div className="glass-panel rounded-xl border border-slate-700/50 p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">
                  Classification Distribution (New Method)
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {DIRECTION_LABELS.map((d) => {
                    const count = shots.filter(
                      (s) => s.newResult.label === d
                    ).length;
                    return (
                      <div
                        key={d}
                        className="text-center py-2 px-1 rounded-lg bg-slate-800/50"
                      >
                        <div className="text-[10px] text-slate-500 uppercase">
                          {d.replace("_", " ")}
                        </div>
                        <div
                          className="text-xl font-bold mt-1"
                          style={{ color: CLASS_COLORS[d] }}
                        >
                          {count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-600">
              Select a shot from the list
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
