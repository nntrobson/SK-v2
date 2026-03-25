"use client";

import Link from "next/link";
import React from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Target, LayoutDashboard, ListVideo, UploadCloud, Activity, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/auth/login');
  };

  const navItems = [
    { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { name: "Sessions", href: "/dashboard/sessions", icon: ListVideo },
    { name: "Upload", href: "/dashboard/upload", icon: UploadCloud },
    { name: "Analysis", href: "/dashboard/analysis", icon: Activity },
  ];

  return (
    <div className="flex min-h-screen w-full flex-col relative overflow-hidden">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-blue-900/20 to-transparent pointer-events-none -z-10" />
      <div className="absolute top-1/4 -right-64 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute bottom-1/4 -left-64 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

      <header className="sticky top-0 h-16 glass-header z-50 w-full">
        <div className="flex w-full items-center justify-between h-full px-6 max-w-7xl mx-auto">
          <Link href="/dashboard" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-sky-400 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-shadow">
              <Target className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">Shot<span className="text-blue-400">Vision</span></span>
          </Link>
          
          <nav className="flex items-center gap-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link key={item.name} href={item.href} className="relative px-4 py-2 rounded-full text-sm font-medium transition-colors">
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute inset-0 bg-white/10 rounded-full"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <div className={cn("relative flex items-center gap-2", isActive ? "text-white" : "text-slate-400 hover:text-slate-200")}>
                    <Icon className="w-4 h-4" />
                    {item.name}
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-4">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 flex items-center justify-center text-slate-300 font-semibold cursor-pointer hover:border-slate-400 transition-colors shadow-inner">
              U
            </div>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col p-4 md:p-8 max-w-7xl mx-auto w-full z-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full h-full"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
