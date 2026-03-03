'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Brush,
  ReferenceArea,
  BarChart,
  Bar,
  CartesianGrid,
} from 'recharts';
import { useDashboardStore } from '@/store/dashboard';
import type { Event } from '@/lib/api';
import type { SwimlaneDimension } from '@/store/dashboard';
import clsx from 'clsx';

// ────────────────────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────────────────────
const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#22c55e',
};

const SWIMLANE_COLORS = [
  '#8b5cf6', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e',
  '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#6366f1',
];

const DIM_OPTIONS: { value: SwimlaneDimension; label: string; icon: string }[] = [
  { value: 'severity', label: 'Severity', icon: '⚡' },
  { value: 'category', label: 'Category', icon: '🔴' },
  { value: 'actor', label: 'Actor', icon: '🔵' },
  { value: 'theme', label: 'Theme', icon: '🟠' },
  { value: 'location', label: 'Location', icon: '📍' },
];

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────

function getEventDimValues(event: Event, dim: SwimlaneDimension): string[] {
  switch (dim) {
    case 'severity': return [event.llm_significance || event.severity || 'medium'];
    case 'category': return event.categories?.length ? event.categories : ['Uncategorized'];
    case 'actor': return event.actors?.length ? event.actors : ['Unknown'];
    case 'theme': return event.themes?.length ? event.themes : ['Unclassified'];
    case 'location': return event.location?.country ? [event.location.country] : ['Unknown'];
  }
}

/** Choose bucket interval based on total time span */
function getBucketMs(spanMs: number): number {
  if (spanMs <= 2 * 3600_000)   return 10 * 60_000;  // ≤2h → 10min
  if (spanMs <= 12 * 3600_000)  return 30 * 60_000;  // ≤12h → 30min
  if (spanMs <= 48 * 3600_000)  return 3600_000;      // ≤48h → 1h
  if (spanMs <= 7 * 86400_000)  return 6 * 3600_000;  // ≤7d → 6h
  return 86400_000;                                    // >7d → 1 day
}

function formatBucketTime(ts: number, spanMs: number): string {
  const d = new Date(ts);
  if (spanMs <= 48 * 3600_000) {
    return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleString('en', { month: 'short', day: 'numeric' });
}

function formatTickTime(ts: number, spanMs: number): string {
  const d = new Date(ts);
  if (spanMs <= 48 * 3600_000) {
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

// ────────────────────────────────────────────────────────────────
//  Density chart data
// ────────────────────────────────────────────────────────────────
interface DensityBucket {
  time: number;
  timeLabel: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

function buildDensityData(events: Event[], spanMs: number): DensityBucket[] {
  if (events.length === 0) return [];

  const times = events.map(e => new Date(e.published_at).getTime()).filter(t => !isNaN(t));
  if (times.length === 0) return [];

  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const actualSpan = maxT - minT || spanMs;
  const bucketMs = getBucketMs(actualSpan);

  const buckets = new Map<number, DensityBucket>();
  const start = Math.floor(minT / bucketMs) * bucketMs;
  const end = Math.ceil(maxT / bucketMs) * bucketMs;

  for (let t = start; t <= end; t += bucketMs) {
    buckets.set(t, { time: t, timeLabel: formatBucketTime(t, actualSpan), total: 0, critical: 0, high: 0, medium: 0, low: 0 });
  }

  events.forEach(ev => {
    const t = new Date(ev.published_at).getTime();
    if (isNaN(t)) return;
    const bk = Math.floor(t / bucketMs) * bucketMs;
    const bucket = buckets.get(bk);
    if (!bucket) return;
    bucket.total++;
    const sev = (ev.llm_significance || ev.severity || 'medium').toLowerCase();
    if (sev === 'critical') bucket.critical++;
    else if (sev === 'high') bucket.high++;
    else if (sev === 'medium') bucket.medium++;
    else bucket.low++;
  });

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

// ────────────────────────────────────────────────────────────────
//  Swimlane chart data
// ────────────────────────────────────────────────────────────────
interface SwimlaneBucket {
  time: number;
  timeLabel: string;
  [key: string]: number | string;
}

function buildSwimlaneData(events: Event[], dim: SwimlaneDimension, spanMs: number): { data: SwimlaneBucket[]; lanes: string[] } {
  if (events.length === 0) return { data: [], lanes: [] };

  const times = events.map(e => new Date(e.published_at).getTime()).filter(t => !isNaN(t));
  if (times.length === 0) return { data: [], lanes: [] };

  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const actualSpan = maxT - minT || spanMs;
  const bucketMs = getBucketMs(actualSpan);

  // Count per lane for top-N
  const laneCounts = new Map<string, number>();
  events.forEach(ev => {
    getEventDimValues(ev, dim).forEach(v => laneCounts.set(v, (laneCounts.get(v) || 0) + 1));
  });
  const topLanes = [...laneCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);

  const buckets = new Map<number, SwimlaneBucket>();
  const start = Math.floor(minT / bucketMs) * bucketMs;
  const end = Math.ceil(maxT / bucketMs) * bucketMs;

  for (let t = start; t <= end; t += bucketMs) {
    const bucket: SwimlaneBucket = { time: t, timeLabel: formatBucketTime(t, actualSpan) };
    topLanes.forEach(l => { bucket[l] = 0; });
    buckets.set(t, bucket);
  }

  events.forEach(ev => {
    const t = new Date(ev.published_at).getTime();
    if (isNaN(t)) return;
    const bk = Math.floor(t / bucketMs) * bucketMs;
    const bucket = buckets.get(bk);
    if (!bucket) return;
    getEventDimValues(ev, dim).forEach(v => {
      if (topLanes.includes(v)) {
        (bucket[v] as number)++;
      }
    });
  });

  return { data: [...buckets.values()].sort((a, b) => a.time - b.time), lanes: topLanes };
}

// ────────────────────────────────────────────────────────────────
//  Custom tooltip
// ────────────────────────────────────────────────────────────────
function TimelineTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="glass-panel-solid px-3 py-2 text-xs shadow-xl">
      <div className="text-gray-300 font-medium mb-1">{typeof label === 'number' ? formatBucketTime(label, 86400_000) : label}</div>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
          <span className="text-gray-400">{entry.name}:</span>
          <span className="text-gray-100 font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Main Component
// ────────────────────────────────────────────────────────────────
export default function TimelineScrubber() {
  const {
    events,
    timelineRange,
    setTimelineRange,
    swimlaneDimension,
    setSwimlaneDimension,
    timelineViewMode,
    setTimelineViewMode,
    timelineCollapsed,
    toggleTimelineCollapsed,
    dateRange,
  } = useDashboardStore();

  const [brushIndices, setBrushIndices] = useState<{ startIndex: number; endIndex: number } | null>(null);

  // Compute span from dateRange for bucketing
  const spanMs = useMemo(() => {
    const map: Record<string, number> = { '1h': 3600_000, '6h': 6*3600_000, '24h': 24*3600_000, '7d': 7*86400_000, '30d': 30*86400_000 };
    return map[dateRange] || 24 * 3600_000;
  }, [dateRange]);

  // Density data
  const densityData = useMemo(() => buildDensityData(events, spanMs), [events, spanMs]);

  // Swimlane data
  const { data: swimlaneData, lanes } = useMemo(
    () => buildSwimlaneData(events, swimlaneDimension, spanMs),
    [events, swimlaneDimension, spanMs]
  );

  const activeData = timelineViewMode === 'density' ? densityData : swimlaneData;

  // Brush change handler — updates store timelineRange
  const handleBrushChange = useCallback(
    (brush: { startIndex?: number; endIndex?: number }) => {
      if (brush.startIndex == null || brush.endIndex == null) return;
      setBrushIndices({ startIndex: brush.startIndex, endIndex: brush.endIndex });
      const data = activeData;
      if (!data.length) return;
      const startBucket = data[Math.max(0, brush.startIndex)];
      const endBucket = data[Math.min(data.length - 1, brush.endIndex)];
      if (!startBucket || !endBucket) return;
      setTimelineRange({
        start: new Date(startBucket.time as number).toISOString(),
        end: new Date(endBucket.time as number).toISOString(),
      });
    },
    [activeData, setTimelineRange]
  );

  const clearBrush = useCallback(() => {
    setTimelineRange(null);
    setBrushIndices(null);
  }, [setTimelineRange]);

  // Stats for header
  const eventCount = events.length;
  const rangeCount = useMemo(() => {
    if (!timelineRange) return eventCount;
    const s = new Date(timelineRange.start).getTime();
    const e = new Date(timelineRange.end).getTime();
    return events.filter(ev => {
      const t = new Date(ev.published_at).getTime();
      return t >= s && t <= e;
    }).length;
  }, [events, timelineRange, eventCount]);

  if (events.length === 0) {
    return (
      <div className="timeline-track px-4 py-3 text-center text-gray-500 text-xs">
        No events to display on timeline
      </div>
    );
  }

  // ─── Collapsed state ───
  if (timelineCollapsed) {
    return (
      <div
        className="timeline-track h-9 flex items-center justify-between px-4 cursor-pointer hover:bg-gray-800/40 transition-colors"
        onClick={toggleTimelineCollapsed}
      >
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-500">▲</span>
          <span className="text-gray-400">Timeline</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-300 font-medium">{rangeCount}</span>
          <span className="text-gray-500">events{timelineRange ? ' in selection' : ''}</span>
          {timelineRange && (
            <button
              onClick={(e) => { e.stopPropagation(); clearBrush(); }}
              className="text-purple-400 hover:text-purple-300 ml-1"
            >
              Clear selection
            </button>
          )}
        </div>
        <span className="text-[10px] text-gray-600">Click to expand</span>
      </div>
    );
  }

  const chartHeight = timelineViewMode === 'density' ? 120 : 140;

  return (
    <div className="timeline-track flex flex-col">
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800/50">
        <div className="flex items-center gap-3">
          {/* Collapse toggle */}
          <button
            onClick={toggleTimelineCollapsed}
            className="text-gray-500 hover:text-gray-300 transition-colors text-xs"
            title="Collapse timeline"
          >
            ▼
          </button>

          <span className="text-[11px] font-medium text-gray-300">Timeline</span>

          {/* Event counts */}
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-gray-400">{eventCount} total</span>
            {timelineRange && (
              <>
                <span className="text-gray-600">→</span>
                <span className="text-purple-300 font-medium">{rangeCount} selected</span>
                <button
                  onClick={clearBrush}
                  className="text-gray-500 hover:text-gray-300 ml-0.5"
                  title="Clear selection"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-gray-800/60 rounded p-0.5 gap-0.5">
            <button
              onClick={() => setTimelineViewMode('density')}
              className={clsx(
                'text-[10px] px-2 py-0.5 rounded transition-colors',
                timelineViewMode === 'density' ? 'bg-purple-600/80 text-white' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              Density
            </button>
            <button
              onClick={() => setTimelineViewMode('swimlane')}
              className={clsx(
                'text-[10px] px-2 py-0.5 rounded transition-colors',
                timelineViewMode === 'swimlane' ? 'bg-purple-600/80 text-white' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              Swimlanes
            </button>
          </div>

          {/* Dimension selector (swimlane mode only) */}
          {timelineViewMode === 'swimlane' && (
            <div className="flex items-center gap-0.5">
              {DIM_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSwimlaneDimension(opt.value)}
                  className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded transition-colors',
                    swimlaneDimension === opt.value
                      ? 'bg-accent text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  )}
                  title={opt.label}
                >
                  {opt.icon}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Chart area ── */}
      <div className="px-2 pt-1 pb-0.5" style={{ height: chartHeight }}>
        {timelineViewMode === 'density' && densityData.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={densityData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradCritical" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gradHigh" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#f97316" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gradMedium" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gradLow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v) => formatTickTime(v, spanMs)}
                tick={{ fontSize: 9, fill: '#6b7280' }}
                axisLine={{ stroke: '#374151' }}
                tickLine={false}
                minTickGap={60}
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                width={30}
                allowDecimals={false}
              />
              <Tooltip content={<TimelineTooltip />} />
              <Area type="monotone" dataKey="critical" stackId="1" stroke="#ef4444" fill="url(#gradCritical)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="high" stackId="1" stroke="#f97316" fill="url(#gradHigh)" strokeWidth={1} />
              <Area type="monotone" dataKey="medium" stackId="1" stroke="#f59e0b" fill="url(#gradMedium)" strokeWidth={1} />
              <Area type="monotone" dataKey="low" stackId="1" stroke="#22c55e" fill="url(#gradLow)" strokeWidth={1} />

              {/* Brush for time selection */}
              <Brush
                dataKey="time"
                height={20}
                stroke="#8b5cf6"
                fill="#0f172a"
                travellerWidth={8}
                onChange={handleBrushChange}
                startIndex={brushIndices?.startIndex}
                endIndex={brushIndices?.endIndex}
              >
                <AreaChart data={densityData}>
                  <Area type="monotone" dataKey="total" stroke="#8b5cf680" fill="#8b5cf620" />
                </AreaChart>
              </Brush>
            </AreaChart>
          </ResponsiveContainer>
        )}

        {timelineViewMode === 'swimlane' && swimlaneData.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={swimlaneData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v) => formatTickTime(v, spanMs)}
                tick={{ fontSize: 9, fill: '#6b7280' }}
                axisLine={{ stroke: '#374151' }}
                tickLine={false}
                minTickGap={60}
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                width={30}
                allowDecimals={false}
              />
              <Tooltip content={<TimelineTooltip />} />
              {lanes.map((lane, i) => (
                <Bar
                  key={lane}
                  dataKey={lane}
                  stackId="1"
                  fill={swimlaneDimension === 'severity' ? (SEV_COLORS[lane.toLowerCase()] || SWIMLANE_COLORS[i % SWIMLANE_COLORS.length]) : SWIMLANE_COLORS[i % SWIMLANE_COLORS.length]}
                  opacity={0.8}
                  radius={i === lanes.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
              <Brush
                dataKey="time"
                height={20}
                stroke="#8b5cf6"
                fill="#0f172a"
                travellerWidth={8}
                onChange={handleBrushChange}
                startIndex={brushIndices?.startIndex}
                endIndex={brushIndices?.endIndex}
              />
            </BarChart>
          </ResponsiveContainer>
        )}

        {activeData.length === 0 && (
          <div className="h-full flex items-center justify-center text-xs text-gray-600">
            No timeline data available
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-3 px-4 pb-1.5 text-[9px] text-gray-500">
        {timelineViewMode === 'density' ? (
          <>
            {Object.entries(SEV_COLORS).map(([name, color]) => (
              <div key={name} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
                <span className="capitalize">{name}</span>
              </div>
            ))}
          </>
        ) : (
          <>
            {lanes.map((lane, i) => (
              <div key={lane} className="flex items-center gap-1 max-w-[100px] truncate">
                <span
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ background: swimlaneDimension === 'severity' ? (SEV_COLORS[lane.toLowerCase()] || SWIMLANE_COLORS[i % SWIMLANE_COLORS.length]) : SWIMLANE_COLORS[i % SWIMLANE_COLORS.length] }}
                />
                <span className="truncate">{lane.length > 15 ? lane.slice(0, 13) + '…' : lane}</span>
              </div>
            ))}
          </>
        )}
        <span className="ml-auto text-gray-600">Drag handles to select time range</span>
      </div>
    </div>
  );
}
