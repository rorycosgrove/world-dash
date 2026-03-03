'use client';

import { useDashboardStore } from '@/store/dashboard';
import { Event, ChartSpec } from '@/lib/api';
import InlineChart from '@/components/InlineChart';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/15 border-red-500/30',
  high: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  medium: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
  low: 'text-green-400 bg-green-500/15 border-green-500/30',
};

/**
 * Build a default multi-metric comparison chart from pinned events
 * when the LLM hasn't provided a chart_spec.
 */
function buildDefaultChartSpec(events: Event[]): ChartSpec {
  return {
    chart_type: 'bar',
    title: 'Event Comparison — Risk Score & Severity',
    x_axis: { field: 'event', label: 'Event' },
    y_axis: { field: 'score', label: 'Score' },
    series: [
      {
        name: 'Risk Score',
        data: events.map((e) => ({
          x: e.title.length > 30 ? e.title.slice(0, 28) + '…' : e.title,
          y: e.risk_score ?? 0,
          label: e.title,
        })),
      },
      {
        name: 'Severity',
        data: events.map((e) => ({
          x: e.title.length > 30 ? e.title.slice(0, 28) + '…' : e.title,
          y: SEVERITY_ORDER[e.severity || 'medium'] || 2,
          label: `${e.severity || 'medium'}`,
        })),
      },
    ],
  };
}

function buildCategoryChart(events: Event[]): ChartSpec {
  const catCounts: Record<string, number> = {};
  for (const e of events) {
    for (const c of e.categories || []) {
      catCounts[c] = (catCounts[c] || 0) + 1;
    }
  }
  const sorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    chart_type: 'pie',
    title: 'Category Distribution (Pinned Events)',
    x_axis: { field: 'category', label: 'Category' },
    y_axis: { field: 'count', label: 'Count' },
    series: [{
      name: 'Categories',
      data: sorted.map(([name, count]) => ({ x: name, y: count })),
    }],
  };
}

function buildTimelineChart(events: Event[]): ChartSpec {
  const sorted = [...events].sort(
    (a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime()
  );
  return {
    chart_type: 'line',
    title: 'Event Timeline — Risk Score Over Time',
    x_axis: { field: 'date', label: 'Date' },
    y_axis: { field: 'risk_score', label: 'Risk Score' },
    series: [{
      name: 'Risk Score',
      data: sorted.map((e) => ({
        x: new Date(e.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        y: e.risk_score ?? 0,
        label: e.title,
      })),
    }],
  };
}

export default function CompareView() {
  const {
    events,
    pinnedEventIds,
    activeChartSpec,
    togglePinEvent,
    setViewMode,
    clearPins,
  } = useDashboardStore();

  const pinnedEvents = events.filter((e: Event) => pinnedEventIds.has(e.id));

  // Determine which chart specs to render
  const charts: ChartSpec[] = [];
  if (activeChartSpec && activeChartSpec.series?.length > 0) {
    charts.push(activeChartSpec);
  }
  if (pinnedEvents.length >= 2) {
    if (!activeChartSpec) {
      charts.push(buildDefaultChartSpec(pinnedEvents));
    }
    charts.push(buildCategoryChart(pinnedEvents));
    charts.push(buildTimelineChart(pinnedEvents));
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800/70 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">⚖️</span>
          <span className="text-sm font-medium text-gray-200">Compare View</span>
          <span className="text-[10px] text-gray-500">
            {pinnedEvents.length} event{pinnedEvents.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('network')}
            className="text-xs px-2.5 py-1 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 border border-gray-700 transition-colors"
          >
            ← Back to Dashboard
          </button>
          <button
            onClick={clearPins}
            className="text-xs px-2.5 py-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700/50 border border-gray-700 transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Pinned event cards */}
      {pinnedEvents.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-700/50 overflow-x-auto">
          <div className="flex gap-2">
            {pinnedEvents.map((e: Event) => (
              <div
                key={e.id}
                className="flex-shrink-0 w-56 bg-gray-800 border border-gray-700 rounded-lg p-2.5"
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <h4 className="text-xs font-medium text-gray-200 line-clamp-2 flex-1">
                    {e.title}
                  </h4>
                  <button
                    onClick={() => togglePinEvent(e.id)}
                    className="text-gray-600 hover:text-red-400 text-[10px] flex-shrink-0"
                    title="Unpin"
                  >
                    ×
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      SEVERITY_COLORS[e.severity || 'medium'] || SEVERITY_COLORS.medium
                    }`}
                  >
                    {e.severity || 'medium'}
                  </span>
                  {e.risk_score != null && (
                    <span className="text-[10px] text-gray-500">
                      Risk: {e.risk_score.toFixed(1)}
                    </span>
                  )}
                </div>
                {(e.categories?.length ?? 0) > 0 && (
                  <div className="mt-1 flex gap-1 flex-wrap">
                    {e.categories!.slice(0, 3).map((c) => (
                      <span key={c} className="text-[9px] px-1 py-0.5 rounded bg-gray-700 text-gray-400">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {charts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-4xl mb-3">📊</span>
            <p className="text-sm text-gray-400 mb-1">No comparison data yet</p>
            <p className="text-xs text-gray-500 max-w-sm">
              Pin at least 2 events and click Compare, or ask the Intelligence Chat
              to compare events for you. Charts will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {charts.map((spec, i) => (
              <div
                key={i}
                className="bg-gray-800/70 border border-gray-700 rounded-lg p-4"
              >
                <InlineChart spec={spec} height={300} expanded />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
