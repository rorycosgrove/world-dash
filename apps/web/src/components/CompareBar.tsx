'use client';

import { useDashboardStore } from '@/store/dashboard';
import { Event } from '@/lib/api';

export default function CompareBar() {
  const {
    events,
    pinnedEventIds,
    togglePinEvent,
    clearPins,
    compareMode,
    setCompareMode,
    setSelectedEvent,
    viewMode,
    setViewMode,
  } = useDashboardStore();

  if (pinnedEventIds.size === 0) return null;

  const pinnedEvents = events.filter((e: Event) => pinnedEventIds.has(e.id));

  return (
    <div className="flex-shrink-0 mx-3 mb-1">
      <div className="bg-gray-900/80 backdrop-blur-sm border border-amber-500/30 rounded-lg px-3 py-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-amber-400 flex-shrink-0 font-medium">
            📌 {pinnedEventIds.size} pinned
          </span>

          {/* Pinned event chips */}
          <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
            {pinnedEvents.map((e: Event) => (
              <span
                key={e.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-200 text-[10px] max-w-[180px]"
              >
                <span className="truncate">{e.title}</span>
                <button
                  onClick={() => togglePinEvent(e.id)}
                  className="text-gray-500 hover:text-gray-300 flex-shrink-0 ml-0.5"
                  title="Unpin"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {pinnedEventIds.size >= 2 && (
              <button
                onClick={() => {
                  setSelectedEvent(null);
                  setCompareMode(true);
                  setViewMode('compare');
                }}
                className={
                  compareMode
                    ? 'px-2.5 py-1 rounded bg-purple-600 text-white text-xs font-medium'
                    : 'px-2.5 py-1 rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 text-xs transition-colors'
                }
              >
                {compareMode ? '📊 Comparing…' : '📊 Compare'}
              </button>
            )}
            <button
              onClick={clearPins}
              className="px-2 py-1 rounded border border-gray-600 text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
              title="Clear all pins"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
