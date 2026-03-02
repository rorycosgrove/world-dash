'use client';

import dynamic from 'next/dynamic';
import EventFeed from '@/components/EventFeed';
import DebugLog from '@/components/DebugLog';
import FilterBar from '@/components/FilterBar';
import AnalysisSummary from '@/components/AnalysisSummary';

// Dynamic import to avoid SSR issues with mapbox-gl
const EventNetworkMap = dynamic(() => import('@/components/EventNetworkMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-secondary">
      <p className="text-gray-400">Loading network map...</p>
    </div>
  ),
});

export default function Home() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Main Layout — no redundant header, nav is in layout.tsx */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Event Feed */}
        <aside className="w-80 xl:w-96 bg-secondary border-r border-gray-700 flex flex-col flex-shrink-0">
          <EventFeed />
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Analysis Summary — shows progress + top insights */}
          <div className="flex-shrink-0 p-3 pb-0">
            <AnalysisSummary />
          </div>

          {/* Filter Bar */}
          <div className="flex-shrink-0 p-3">
            <FilterBar />
          </div>

          {/* Network Map */}
          <div className="flex-1 min-h-0 px-3 pb-3">
            <EventNetworkMap />
          </div>
        </main>

        {/* Right Sidebar - Debug Log */}
        <aside className="w-72 xl:w-80 bg-secondary border-l border-gray-700 overflow-hidden flex flex-col flex-shrink-0">
          <DebugLog />
        </aside>
      </div>
    </div>
  );
}
