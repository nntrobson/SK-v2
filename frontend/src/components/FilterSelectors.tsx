import React from 'react';
import { motion } from 'framer-motion';

interface TrapLayoutSelectorProps {
  selectedStation: string | null;
  onSelectStation: (station: string | null) => void;
}

export function TrapLayoutSelector({ selectedStation, onSelectStation }: TrapLayoutSelectorProps) {
  const stations = ['post_1', 'post_2', 'post_3', 'post_4', 'post_5'];
  
  return (
    <div className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center gap-2 border border-slate-700/50 shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:border-slate-600/50 transition-colors cursor-pointer group">
      <div className="text-[10px] items-center flex font-semibold text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-300 transition-colors pointer-events-none">
        Station Filter
      </div>
      <div className="relative w-40 h-24">
        <svg viewBox="0 0 100 60" className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
          <path d="M 10,50 A 40,40 0 0,1 90,50" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3 3" />
          <rect x="45" y="5" width="10" height="10" fill="rgba(255,255,255,0.2)" rx="2" />
          {[10, 30, 50, 70, 90].map((x, i) => (
            <path key={`line-${i}`} d={`M 50,15 L ${x},50`} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          ))}
        </svg>
        
        <div className="absolute inset-0 flex justify-between items-end pb-1 px-1">
          {stations.map((station, i) => {
            const isSelected = selectedStation === station;
            return (
              <motion.button
                key={station}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => { e.stopPropagation(); onSelectStation(isSelected ? null : station); }}
                className={`relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 border backdrop-blur-sm ${
                  isSelected 
                    ? 'bg-emerald-500/90 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.5)]' 
                    : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-white border-slate-600'
                }`}
              >
                {i + 1}
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface TrajectorySelectorProps {
  selectedPresentation: string | null;
  onSelectPresentation: (presentation: string | null) => void;
}

export function TrajectorySelector({ selectedPresentation, onSelectPresentation }: TrajectorySelectorProps) {
  const presentations = [
    { id: 'hard_left', label: 'HL', angle: -45, color: 'text-indigo-400', bg: 'bg-indigo-500/80', shadow: 'shadow-[0_0_15px_rgba(99,102,241,0.5)]', border: 'border-indigo-400' },
    { id: 'moderate_left', label: 'ML', angle: -22.5, color: 'text-sky-400', bg: 'bg-sky-500/80', shadow: 'shadow-[0_0_15px_rgba(14,165,233,0.5)]', border: 'border-sky-400' },
    { id: 'straight', label: 'STR', angle: 0, color: 'text-emerald-400', bg: 'bg-emerald-500/80', shadow: 'shadow-[0_0_15px_rgba(16,185,129,0.5)]', border: 'border-emerald-400' },
    { id: 'moderate_right', label: 'MR', angle: 22.5, color: 'text-amber-400', bg: 'bg-amber-500/80', shadow: 'shadow-[0_0_15px_rgba(245,158,11,0.5)]', border: 'border-amber-400' },
    { id: 'hard_right', label: 'HR', angle: 45, color: 'text-rose-400', bg: 'bg-rose-500/80', shadow: 'shadow-[0_0_15px_rgba(244,63,94,0.5)]', border: 'border-rose-400' },
  ];

  return (
    <div className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center gap-2 border border-slate-700/50 shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:border-slate-600/50 transition-colors cursor-pointer group">
      <div className="text-[10px] items-center flex font-semibold text-slate-400 uppercase tracking-widest mb-1 group-hover:text-slate-300 transition-colors pointer-events-none">
        Flight Path Filter
      </div>
      <div className="relative w-40 h-24 flex justify-center items-end pb-3">
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-4 h-3 bg-slate-700 rounded-sm border border-slate-500 z-10 shadow-lg pointer-events-none" />
        
        {presentations.map((pres) => {
          const isSelected = selectedPresentation === pres.id;
          
          return (
            <motion.div 
              key={pres.id}
              className="absolute bottom-4 left-1/2 origin-bottom flex flex-col items-center group/path z-20"
              style={{ transform: `translateX(-50%) rotate(${pres.angle}deg)`, height: '56px', width: '32px' }}
              onClick={(e) => { e.stopPropagation(); onSelectPresentation(isSelected ? null : pres.id); }}
              whileHover={{ scale: 1.05 }}
            >
              <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full transition-all duration-300 pointer-events-none ${isSelected ? `${pres.bg} h-full ${pres.shadow}` : 'bg-slate-700/80 group-hover/path:bg-slate-500 h-[80%]'}`} />
              <motion.div 
                initial={false}
                animate={{ y: isSelected ? -2 : 0, scale: isSelected ? 1.1 : 1 }}
                className={`absolute top-0 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center -mt-2 transition-all duration-300 border backdrop-blur-sm pointer-events-none ${isSelected ? `${pres.bg} ${pres.border} ${pres.shadow}` : 'bg-slate-800/80 border-slate-600 group-hover/path:border-slate-400'}`}
              >
                 {isSelected && <div className="w-2 h-2 bg-white rounded-full animate-pulse" />}
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
