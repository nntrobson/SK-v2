import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Calendar, MapPin, ChevronRight, Activity, Plus } from "lucide-react";

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

interface SessionData {
  id: number;
  date: string;
  venue: string;
  type: string;
  score: number;
  total: number;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);

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

      <div className="glass-panel text-white rounded-3xl overflow-hidden relative">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl -z-10" />
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-700/50 bg-slate-900/40">
                <th className="px-8 py-5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-[25%]">Date & Time</th>
                <th className="px-8 py-5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-[35%]">Location Matrix</th>
                <th className="px-8 py-5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-[20%]">Performance</th>
                <th className="px-8 py-5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right w-[20%]">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-8 py-12 text-center text-slate-400">Loading neural telemetry...</td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-8 py-12 text-center text-slate-400">No sessions recorded yet. Upload a video to begin.</td>
                </tr>
              ) : sessions.map((session) => (
                <motion.tr 
                  variants={itemVariants} 
                  key={session.id} 
                  className="hover:bg-slate-800/40 transition-colors group relative cursor-pointer"
                >
                  <td className="px-8 py-6 relative">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-0 bg-blue-500 group-hover:h-8 transition-all rounded-r-md" />
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 group-hover:text-blue-400 transition-colors">
                        <Calendar className="w-5 h-5" />
                      </div>
                      <span className="font-semibold text-slate-200 tracking-wide">{session.date}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex flex-col">
                      <span className="text-white font-medium mb-1 flex items-center gap-2">
                        {session.venue}
                      </span>
                      <span className="text-xs text-slate-400 flex items-center gap-1.5 uppercase tracking-wider font-semibold">
                        <MapPin className="w-3.5 h-3.5" /> {session.type}
                      </span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2">
                      <Activity className={`w-4 h-4 ${session.score >= 23 ? 'text-emerald-400' : 'text-amber-400'}`} />
                      <span className="text-2xl font-black tracking-tighter">
                        <span className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">{session.score}</span>
                        <span className="text-slate-500 text-base">/{session.total}</span>
                      </span>
                    </div>
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
    </motion.div>
  );
}
