"use client";

import Link from "next/link";
import React, { useState, useEffect } from "react";
import { motion, type Variants } from "framer-motion";
import { Calendar, MapPin, ChevronRight, Activity, Plus } from "lucide-react";

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
} satisfies Variants;

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
} satisfies Variants;

interface SessionData {
  id: number;
  date: string;
  venue: string;
  type: string;
  score: number;
  total: number;
  status: string;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<"date" | "venue" | "type">("date");

  useEffect(() => {
    fetch('http://localhost:8000/api/sessions')
      .then(res => res.json())
      .then(data => {
        setSessions(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);
  const groupedSessions = sessions.reduce((acc, session) => {
    const key = session[groupBy] || "Unknown";
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(session);
    return acc;
  }, {} as Record<string, SessionData[]>);

  const sortedKeys = Object.keys(groupedSessions).sort((a, b) => {
    if (groupBy === 'date') {
      return new Date(b).getTime() - new Date(a).getTime();
    }
    return a.localeCompare(b);
  });

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-8 max-w-5xl mx-auto w-full py-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">Session Matrix</h1>
          <p className="text-slate-400 font-light">Review historical AI telemetry and processed ShotKam rounds.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-1 flex">
            <button 
              onClick={() => setGroupBy('date')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${groupBy === 'date' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Date
            </button>
            <button 
              onClick={() => setGroupBy('venue')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${groupBy === 'venue' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Event
            </button>
            <button 
              onClick={() => setGroupBy('type')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${groupBy === 'type' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Type
            </button>
          </div>
          <Link href="/dashboard/upload">
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-2 h-11 px-6 rounded-full shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-colors"
            >
              <Plus className="w-5 h-5" /> Import Video
            </motion.button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel text-white rounded-3xl overflow-hidden relative p-12 flex justify-center text-slate-400">
           Loading session data...
        </div>
      ) : sessions.length === 0 ? (
        <div className="glass-panel text-white rounded-3xl overflow-hidden relative p-12 flex justify-center text-slate-400">
           No sessions recorded yet. Upload a video to begin.
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {sortedKeys.map((groupKey) => (
            <div key={groupKey} className="flex flex-col gap-4">
              <h2 className="text-xl font-bold text-white px-2 flex items-center gap-2">
                {groupBy === 'date' && <Calendar className="w-5 h-5 text-blue-400" />}
                {groupBy === 'venue' && <MapPin className="w-5 h-5 text-blue-400" />}
                {groupBy === 'type' && <Activity className="w-5 h-5 text-blue-400" />}
                {groupKey}
              </h2>
              <div className="glass-panel text-white rounded-3xl overflow-hidden relative">
                <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl -z-10" />
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-700/50 bg-slate-900/40">
                        <th className="px-8 py-5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-[50%]">
                          {groupBy === 'venue' ? 'Date & Type' : (groupBy === 'type' ? 'Date & Location' : 'Location Matrix')}
                        </th>
                        <th className="px-8 py-5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-[25%]">Performance</th>
                        <th className="px-8 py-5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right w-[25%]">Access</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {groupedSessions[groupKey].map((session) => (
                        <motion.tr 
                          variants={itemVariants} 
                          key={session.id} 
                          className="hover:bg-slate-800/40 transition-colors group relative cursor-pointer"
                        >
                          <td className="px-8 py-6 relative">
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-0 bg-blue-500 group-hover:h-8 transition-all rounded-r-md" />
                            <div className="flex flex-col">
                              <span className="text-white font-medium mb-1 flex items-center gap-2">
                                {groupBy === 'venue' ? session.date : (groupBy === 'type' ? session.venue : session.venue)}
                              </span>
                              <span className="text-xs text-slate-400 flex items-center gap-1.5 uppercase tracking-wider font-semibold">
                                {groupBy === 'venue' ? (
                                  <><Activity className="w-3.5 h-3.5" /> {session.type}</>
                                ) : groupBy === 'type' ? (
                                  <><Calendar className="w-3.5 h-3.5" /> {session.date}</>
                                ) : (
                                  <><MapPin className="w-3.5 h-3.5" /> {session.type}</>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            {session.status === 'processing' ? (
                              <div className="flex items-center gap-3">
                                <div className="w-5 h-5 border-2 border-slate-600 border-t-sky-400 rounded-full animate-spin" />
                                <span className="text-sky-400 font-medium italic animate-pulse tracking-wide text-sm">Processing Video...</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Activity className={`w-4 h-4 ${session.score >= 23 ? 'text-emerald-400' : 'text-amber-400'}`} />
                                <span className="text-2xl font-black tracking-tighter">
                                  <span className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">{session.score}</span>
                                  <span className="text-slate-500 text-base">/{session.total}</span>
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6 text-right">
                            <Link href={`/dashboard/sessions/${session.id}`} className="inline-flex items-center justify-center p-3 rounded-full bg-slate-800 text-slate-300 border border-slate-700 hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-all shadow-md group-hover:shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                              <ChevronRight className="w-5 h-5" />
                            </Link>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
