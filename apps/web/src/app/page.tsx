'use client';

import dynamic from 'next/dynamic';
import EventFeed from '@/components/EventFeed';
import DebugLog from '@/components/DebugLog';
import FilterBar from '@/components/FilterBar';
import AnalysisSummary from '@/components/AnalysisSummary';
import AlertPanel from '@/components/AlertPanel';
import EventDetailDrawer from '@/components/EventDetailDrawer';
import { useDashboardStore } from '@/store/dashboard';
import clsx from 'clsx';

// Dynamic imports to avoid SSR issues
const EventNetworkMap = dynamic(() => import('@/components/EventNetworkMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-secondary">
      <p className="text-gray-400">Loading network map...</p>
    </div>
  ),
});

const WorldMap = dynamic(() => import('@/components/WorldMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-secondary">
      <p className="text-gray-400">Loading world map...</p>
    </div>
  ),
});

export default function Home() {
  const { viewMode, setViewMode, showDebugPanel, showAlertPanel, drawerOpen } = useDashboardStore();

  return (
    <div className="h-[calc(100vh-41px)] flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Event Feed (hidden on mobile, shown on md+) */}
        <aside className="hidden md:flex w-80 xl:w-96 bg-secondary border-r border-gray-700 flex-col flex-shrink-0">
          <EventFeed />
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Analysis Summary */}
          <div className="flex-shrink-0 p-3 pb-0">
            <AnalysisSummary />
          </div>

          {/* Alert Panel — collapsible */}
          {showAlertPanel && (
            <div className="flex-shrink-0 px-3 pt-2">
              <AlertPanel />
            </div>
          )}

          {/* Filter Bar + View Toggle */}
          <div className="flex-shrink-0 p-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <FilterBar />
            </div>
            {/* Map / Network toggle */}
            <div className="flex items-center gap-1 flex-shrink-0 bg-secondary border border-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('network')}
                className={clsx(
                  'text-[11px] px-2.5 py-1 rounded-md transition-colors',
                  viewMode === 'network'
                    ? 'bg-accent text-white'
                    : 'text-gray-400 hover:text-gray-300'
                )}
                title="Network Graph"
              >
                🕸️ Network
              </button>
              <button
                onClick={() => setViewMode('map')}
                className={clsx(
                  'text-[11px] px-2.5 py-1 rounded-md transition-colors',
                  viewMode === 'map'
                    ? 'bg-accent text-white'
                    : 'text-gray-400 hover:text-gray-300'
                )}
                title="Geographic Map"
              >
                🗺️ Map
              </button>
            </div>
          </div>

          {/* Main Visualization */}
          <div className="flex-1 min-h-0 px-3 pb-3">
            {viewMode === 'network' ? <EventNetworkMap /> : <WorldMap />}
          </div>

          {/* Mobile Event Feed (shown only on small screens) */}
          <div className="md:hidden flex-shrink-0 h-64 border-t border-gray-700">
            <EventFeed />
          </div>
        </main>

        {/* Right Sidebar - Debug Log (collapsible) */}
        {showDebugPanel && (
          <aside className="hidden lg:flex w-72 xl:w-80 bg-secondary border-l border-gray-700 overflow-hidden flex-col flex-shrink-0">
            <DebugLog />
          </aside>
        )}
      </div>

      {/* Event Detail Drawer (slide-over) */}
      {drawerOpen && <EventDetailDrawer />}
    </div>
  );
}
