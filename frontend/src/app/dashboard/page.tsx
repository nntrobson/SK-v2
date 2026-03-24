import React from "react";
import { HeroBanner } from "@/components/dashboard/HeroBanner";
import { StatCard } from "@/components/dashboard/StatCard";
import PerformanceChart from "@/components/dashboard/PerformanceChart";
import { UseCasesGrid } from "@/components/dashboard/UseCasesGrid";

const TREND_DATA = [
  { month: 'Jan', average: 18 },
  { month: 'Feb', average: 19 },
  { month: 'Mar', average: 22 },
];

export default async function DashboardOverviewLayout() {
  // In a real application, you might fetch data here securely on the server
  
  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto w-full py-6">
      <HeroBanner />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard delay={0.1} average={22.4} trend={1.2} />
        
        <PerformanceChart delay={0.2} data={TREND_DATA} />
      </div>

      {/* Embedded Marketing & Use Cases */}
      <UseCasesGrid />
    </div>
  );
}
