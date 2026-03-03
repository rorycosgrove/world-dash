'use client';

import dynamic from 'next/dynamic';
import InsightFeed from '@/components/InsightFeed';
import CommandBar from '@/components/CommandBar';
import TimelineScrubber from '@/components/TimelineScrubber';
import CompareBar from '@/components/CompareBar';
import CompareView from '@/components/CompareView';
import EventDetailDrawer from '@/components/EventDetailDrawer';
import ChatPanel from '@/components/ChatPanel';
import { useDashboardStore } from '@/store/dashboard';
import { useKeyboardShortcuts } from '@/lib/useKeyboardShortcuts';
import { useEventLoader } from '@/lib/useEventLoader';
import clsx from 'clsx';

// Dynamic imports to avoid SSR issues
const EventNetworkMap = dynamic(() => import('@/components/EventNetworkMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-900/40">
      <div className="flex flex-col items-center gap-2">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-xs">Loading network map…</p>
      </div>
    </div>
  ),
});

const WorldMap = dynamic(() => import('@/components/WorldMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-900/40">
      <div className="flex flex-col items-center gap-2">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-xs">Loading world map…</p>
      </div>
    </div>
  ),
});

export default function Home() {
  const {
    viewMode,
    leftPanelOpen,
    rightPanelOpen,
    rightPanelMode,
    drawerOpen,
    pinnedEventIds,
    toggleLeftPanel,
    closeRightPanel,
  } = useDashboardStore();

  useKeyboardShortcuts();
  useEventLoader();

  const hasPins = pinnedEventIds.size > 0;

  return (
    <div className="h-[calc(100vh-36px)] flex flex-col overflow-hidden">
      {/* ── Command Bar ── */}
      <CommandBar />

      {/* ── Main Content Area ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ── Left Panel: Insight Feed ── */}
        <aside
          className={clsx(
            'hidden md:flex flex-col flex-shrink-0 border-r border-gray-800/60 transition-all duration-300 ease-panel overflow-hidden',
            leftPanelOpen ? 'w-64 xl:w-72' : 'w-0'
          )}
        >
          {leftPanelOpen && <InsightFeed />}
        </aside>

        {/* Left panel toggle (visible when collapsed) */}
        {!leftPanelOpen && (
          <button
            onClick={toggleLeftPanel}
            className="hidden md:flex items-center justify-center w-6 flex-shrink-0 border-r border-gray-800/40 hover:bg-gray-800/30 transition-colors text-gray-600 hover:text-gray-400"
            title="Show insight panel"
          >
            ▸
          </button>
        )}

        {/* ── Center: Visualizations ── */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Compare bar when pins exist */}
          {hasPins && <CompareBar />}

          {/* Main visualization */}
          <div className="flex-1 min-h-0">
            {viewMode === 'compare' ? (
              <CompareView />
            ) : viewMode === 'network' ? (
              <EventNetworkMap />
            ) : (
              <WorldMap />
            )}
          </div>
        </main>

        {/* ── Right Panel: Event Detail / Chat ── */}
        <aside
          className={clsx(
            'flex flex-col flex-shrink-0 border-l border-gray-800/60 transition-all duration-300 ease-panel overflow-hidden bg-gray-900/50',
            rightPanelOpen ? 'w-96 xl:w-[420px]' : 'w-0'
          )}
        >
          {rightPanelOpen && (
            <>
              {/* Panel header with mode tabs */}
              <div className="flex items-center border-b border-gray-800/60 flex-shrink-0">
                <button
                  onClick={() => useDashboardStore.getState().setRightPanelMode('detail')}
                  className={clsx(
                    'flex-1 text-xs py-2 text-center transition-colors border-b-2',
                    rightPanelMode === 'detail'
                      ? 'border-purple-500 text-purple-300'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  )}
                >
                  Event Detail
                </button>
                <button
                  onClick={() => useDashboardStore.getState().setRightPanelMode('chat')}
                  className={clsx(
                    'flex-1 text-xs py-2 text-center transition-colors border-b-2',
                    rightPanelMode === 'chat'
                      ? 'border-blue-500 text-blue-300'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  )}
                >
                  💬 Chat
                </button>
                <button
                  onClick={closeRightPanel}
                  className="px-3 py-2 text-gray-500 hover:text-gray-300 transition-colors"
                  title="Close panel"
                >
                  ✕
                </button>
              </div>

              {/* Panel content */}
              <div className="flex-1 overflow-hidden">
                {rightPanelMode === 'detail' ? (
                  <EventDetailDrawer inline />
                ) : (
                  <ChatPanel inline />
                )}
              </div>
            </>
          )}
        </aside>

        {/* Right panel toggle (visible when collapsed) */}
        {!rightPanelOpen && (
          <button
            onClick={() => useDashboardStore.getState().openRightPanel('chat')}
            className="hidden md:flex items-center justify-center w-6 flex-shrink-0 border-l border-gray-800/40 hover:bg-gray-800/30 transition-colors text-gray-600 hover:text-gray-400"
            title="Open chat panel"
          >
            ◂
          </button>
        )}
      </div>

      {/* ── Timeline Scrubber (persistent bottom) ── */}
      <TimelineScrubber />

      {/* ── Mobile: Event Feed below main content ── */}
      <div className="md:hidden flex-shrink-0 h-48 border-t border-gray-700 bg-gray-900/50">
        <InsightFeed />
      </div>
    </div>
  );
}
