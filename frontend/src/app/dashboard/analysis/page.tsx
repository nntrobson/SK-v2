"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Download, SlidersHorizontal, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  classifyTrajectory,
  autoDetectThresholds,
  CLASS_COLORS,
  DIRECTION_LABELS,
  type TrajectoryClassificationResult,
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
  trajectory: Array<{ x: number; y: number; gx?: number; gy?: number }>;
}

interface ProcessedShot {
  idx: number;
  id: number;
  videoName: string;
  station: string;
  storedPresentation: string;
  trajX: number[];
  trajY: number[];
  result: TrajectoryClassificationResult;
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
  const [stationFilter, setStationFilter] = useState("trap-house");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [showTuning, setShowTuning] = useState(false);
  const defaultThresholds: Record<string, { moderate: number; hard: number }> = {
    "trap-house-1-2": { moderate: 8, hard: 30 },
    "trap-house": { moderate: 8, hard: 30 },
    "trap-house-4-5": { moderate: 8, hard: 30 },
    "unknown": { moderate: 8, hard: 30 },
  };

  const [thresholds, setThresholds] = useState(() => {
    if (typeof window === "undefined") return defaultThresholds;
    try {
      const v = localStorage.getItem("trajThresholdsPerStation");
      if (v) return { ...defaultThresholds, ...JSON.parse(v) };
    } catch {}
    const oldMod = localStorage.getItem("trajThreshModerate");
    const oldHard = localStorage.getItem("trajThreshHard");
    if (oldMod || oldHard) {
      const mod = oldMod ? Number(oldMod) : 8;
      const hard = oldHard ? Number(oldHard) : 30;
      return {
        "trap-house-1-2": { moderate: mod, hard: hard },
        "trap-house": { moderate: mod, hard: hard },
        "trap-house-4-5": { moderate: mod, hard: hard },
        "unknown": { moderate: mod, hard: hard },
      };
    }
    return defaultThresholds;
  });
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [userLabels, setUserLabels] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("trajectoryLabels");
      return saved ? (JSON.parse(saved) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });

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
        const hasGlobal = s.trajectory.every(
          (p) => p.gx != null && p.gy != null
        );

        let trajX: number[];
        let trajY: number[];
        if (hasGlobal) {
          trajX = s.trajectory.map((p) => p.gx!);
          trajY = s.trajectory.map((p) => -p.gy!);
        } else {
          trajX = s.trajectory.map((p) => p.x);
          trajY = s.trajectory.map((p) => p.y);
        }

        const station = s.station || "unknown";
        const storedPresentation = (s.presentation || "straight").toLowerCase();

        const stationThresh = thresholds[station] || { moderate: 8, hard: 30 };
        const result = classifyTrajectory(
          trajX,
          trajY,
          stationThresh.moderate,
          stationThresh.hard
        );

        return {
          idx: i,
          id: s.id,
          videoName: s.video_name,
          station,
          storedPresentation,
          trajX,
          trajY,
          result,
          agree: storedPresentation === result.label,
        };
      });
  }, [apiShots, thresholds]);

  useEffect(() => {
    if (shots.length <= 4) return;
    const hasSaved =
      typeof window !== "undefined" &&
      localStorage.getItem("trajThresholdsPerStation") !== null;
    if (hasSaved) return;
    const angles = shots.map((s) => s.result.angle);
    const [mod, hard] = autoDetectThresholds(angles);
    queueMicrotask(() => {
      setThresholds((prev: Record<string, { moderate: number; hard: number }>) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          next[k] = { moderate: mod, hard: hard };
        }
        return next;
      });
    });
  }, [apiShots.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-sync: whenever computed classifications differ from DB, push to DB.
  // Debounced so slider drags don't spam the endpoint.
  useEffect(() => {
    if (shots.length === 0) return;
    const hasDiffs = shots.some((s) => !s.agree);
    if (!hasDiffs) return;

    const timer = setTimeout(() => {
      setSaving(true);
      fetch("http://localhost:8000/api/shots/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thresholds: Object.fromEntries(
            Object.entries(thresholds).map(([st, t]) => [st, { thresh_moderate: t.moderate, thresh_hard: t.hard }])
          )
        }),
      })
        .then(() => fetch("http://localhost:8000/api/shots"))
        .then((r) => r.json())
        .then((data: ApiShot[]) => setApiShots(data))
        .finally(() => setSaving(false));
    }, 600);

    return () => clearTimeout(timer);
  }, [thresholds, shots]); // eslint-disable-line react-hooks/exhaustive-deps

  const stations = useMemo(() => {
    const set = new Set(shots.map((s) => s.station));
    return Array.from(set).sort();
  }, [shots]);

  const filteredShots = useMemo(() => {
    return shots.filter((s) => {
      if (stationFilter !== "all" && s.station !== stationFilter) return false;
      if (directionFilter !== "all" && s.result.label !== directionFilter)
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
    () => shots.map((s) => s.result.angle),
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
    const header = "video_name,station,stored_presentation,computed_label,angle,points,user_label\n";
    const rows = shots
      .map(
        (s) =>
          `${s.videoName},${s.station},${s.storedPresentation},${s.result.label},${s.result.angle.toFixed(2)},${s.result.pointsUsed},${userLabels[s.videoName] || ""}`
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

  const updateThreshModerate = useCallback((v: number) => {
    setThresholds((prev: Record<string, { moderate: number; hard: number }>) => {
      const current = prev[stationFilter] || { moderate: 8, hard: 30 };
      const next = { ...prev, [stationFilter]: { ...current, moderate: v } };
      localStorage.setItem("trajThresholdsPerStation", JSON.stringify(next));
      return next;
    });
  }, [stationFilter]);

  const updateThreshHard = useCallback((v: number) => {
    setThresholds((prev: Record<string, { moderate: number; hard: number }>) => {
      const current = prev[stationFilter] || { moderate: 8, hard: 30 };
      const next = { ...prev, [stationFilter]: { ...current, hard: v } };
      localStorage.setItem("trajThresholdsPerStation", JSON.stringify(next));
      return next;
    });
  }, [stationFilter]);

  const saveClassifications = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("http://localhost:8000/api/shots/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thresholds: Object.fromEntries(
            Object.entries(thresholds).map(([st, t]) => [st, { thresh_moderate: t.moderate, thresh_hard: t.hard }])
          )
        }),
      });
      const data = await res.json();
      setSaveResult(`Updated ${data.updated} of ${data.total} shots`);

      const refreshRes = await fetch("http://localhost:8000/api/shots");
      const refreshData: ApiShot[] = await refreshRes.json();
      setApiShots(refreshData);
    } catch {
      setSaveResult("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [thresholds]);

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

  const overlayTrajectoryShots = useMemo<TrajectoryShot[]>(() => {
    if (multiSelected.size === 0) return [];
    return [...multiSelected]
      .map((i) => filteredShots[i])
      .filter(Boolean)
      .map((s) => ({
        videoName: s.videoName,
        trajX: s.trajX,
        trajY: s.trajY,
        result: s.result,
      }));
  }, [multiSelected, filteredShots]);

  const selectedTrajectoryShot = useMemo<TrajectoryShot | undefined>(() => {
    if (!selectedShot) return undefined;
    return {
      videoName: selectedShot.videoName,
      trajX: selectedShot.trajX,
      trajY: selectedShot.trajY,
      result: selectedShot.result,
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
          Trajectory Direction Classifier
        </h1>
        <div className="text-xs text-slate-400 flex gap-3">
          <span>
            <span className="text-cyan-400 font-semibold">{shots.length}</span>{" "}
            shots
          </span>
          <span>
            Match DB:{" "}
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
          {saving && (
            <span className="text-[10px] text-cyan-400 animate-pulse">
              Syncing to DB...
            </span>
          )}
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
          <option value="differ">Differs from DB</option>
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
                Angle Thresholds (degrees from vertical) for {stationFilter}
              </div>
              <div className="flex items-center gap-2 text-xs mb-2">
                <label className="w-24 text-slate-400">Hard (&ge;)</label>
                <input
                  type="range"
                  min={15}
                  max={60}
                  value={currentThreshHard}
                  onChange={(e) => updateThreshHard(Number(e.target.value))}
                  className="flex-1 accent-cyan-400"
                />
                <span className="w-8 text-right text-cyan-400 font-mono font-semibold">
                  {currentThreshHard}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs mb-2">
                <label className="w-24 text-slate-400">Moderate (&ge;)</label>
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={currentThreshModerate}
                  onChange={(e) => updateThreshModerate(Number(e.target.value))}
                  className="flex-1 accent-cyan-400"
                />
                <span className="w-8 text-right text-cyan-400 font-mono font-semibold">
                  {currentThreshModerate}
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
                threshModerate={currentThreshModerate}
                threshHard={currentThreshHard}
              />
            </div>
            <div className="text-[11px] text-slate-500 min-w-[180px]">
              <div>
                Straight:{" "}
                <span className="text-cyan-400 font-semibold">
                  {shots.filter((s) => s.result.label === "straight").length}
                </span>
              </div>
              <div>
                Moderate:{" "}
                <span className="text-cyan-400 font-semibold">
                  {
                    shots.filter(
                      (s) =>
                        s.result.label === "moderate_left" ||
                        s.result.label === "moderate_right"
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
                        s.result.label === "hard_left" ||
                        s.result.label === "hard_right"
                    ).length
                  }
                </span>
              </div>
            </div>
            <div className="min-w-[200px] flex flex-col gap-2 items-start">
              <button
                onClick={saveClassifications}
                disabled={saving}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2",
                  saving
                    ? "bg-slate-700 text-slate-400 cursor-wait"
                    : "bg-cyan-600 text-white hover:bg-cyan-500"
                )}
              >
                {saving ? "Saving..." : "Save to All Sessions"}
              </button>
              <p className="text-[10px] text-slate-600">
                Reclassifies every shot with current thresholds and saves to the database.
              </p>
              {saveResult && (
                <span className="text-[11px] text-emerald-400 font-semibold">
                  {saveResult}
                </span>
              )}
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
                    style={{ color: CLASS_COLORS[shot.result.label] || "#888" }}
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
                      borderColor: CLASS_COLORS[s.result.label] || "#888",
                    }}
                  >
                    <div
                      className="font-semibold mb-1"
                      style={{
                        color: CLASS_COLORS[s.result.label] || "#888",
                      }}
                    >
                      {s.videoName.replace(".MP4", "")}
                    </div>
                    <div className="text-slate-500">
                      <DirectionBadge label={s.result.label} />{" "}
                      {s.result.angle.toFixed(1)}°
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
                <div className="flex-1 glass-panel rounded-xl border-2 border-cyan-500/40 p-4 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                    Trajectory Direction
                  </div>
                  <DirectionBadge label={selectedShot.result.label} />
                  <div className="text-[11px] text-slate-500 mt-2">
                    {selectedShot.result.angle.toFixed(1)}° from vertical
                  </div>
                </div>
                <div className="flex-1 glass-panel rounded-xl border-2 border-slate-600/50 p-4 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                    Stored in DB
                  </div>
                  <DirectionBadge label={selectedShot.storedPresentation} />
                  <div className="text-[11px] text-slate-500 mt-2">
                    {selectedShot.agree ? (
                      <span className="text-emerald-400">Matches</span>
                    ) : (
                      <span className="text-amber-400">Different</span>
                    )}
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
                        selectedShot.result.label
                        ? "Matches trajectory"
                        : "Differs from trajectory"
                      : "Click below to classify"}
                  </div>
                </div>
              </div>

              {/* Trajectory Plot */}
              <div className="glass-panel rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm text-slate-400 mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4" /> Trajectory Plot
                  (origin-normalized)
                </h3>
                <TrajectoryCanvas shot={selectedTrajectoryShot} />
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
                    {selectedShot.result.pointsUsed}
                  </div>
                </div>
                <div className="glass-panel rounded-xl border border-slate-700/50 p-4">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                    Metrics
                  </div>
                  <div className="text-xs text-slate-400 space-y-0.5">
                    <div>
                      Direction angle: {selectedShot.result.angle.toFixed(1)}°
                    </div>
                    <div>
                      Horizontal delta: {selectedShot.result.dx.toFixed(1)} px
                    </div>
                    <div>
                      Vertical delta: {selectedShot.result.dy.toFixed(1)} px
                    </div>
                    <div>
                      Points used: {selectedShot.result.pointsUsed}
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
                  Classification Distribution
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {DIRECTION_LABELS.map((d) => {
                    const count = shots.filter(
                      (s) => s.result.label === d
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
