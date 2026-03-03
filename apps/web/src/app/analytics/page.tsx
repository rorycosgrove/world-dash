'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, Event, Source, AnalysisSummary, EventStats } from '@/lib/api';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Treemap,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import { format, parseISO, startOfHour, subHours } from 'date-fns';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#10b981',
};

const STATUS_COLORS: Record<string, string> = {
  raw: '#6b7280',
  normalized: '#3b82f6',
  enriched: '#8b5cf6',
  processed: '#10b981',
  failed: '#ef4444',
};

const CHART_COLORS = ['#e94560', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`analyst-panel p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
      {children}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: <span className="font-semibold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [eventsData, sourcesData, summaryData, statsData] = await Promise.all([
        api.getEvents({ limit: 500, since_hours: 168 }),
        api.getSources(),
        api.getAnalysisSummary(),
        api.getEventStats(),
      ]);
      setEvents(eventsData);
      setSources(sourcesData);
      setSummary(summaryData);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Derived data ---

  // Event timeline (hourly buckets, last 48h)
  const timelineData = (() => {
    const now = new Date();
    const buckets: Record<string, number> = {};
    for (let i = 47; i >= 0; i--) {
      const hour = startOfHour(subHours(now, i));
      buckets[format(hour, 'MMM d HH:00')] = 0;
    }
    events.forEach((e) => {
      try {
        const hour = startOfHour(parseISO(e.published_at));
        const key = format(hour, 'MMM d HH:00');
        if (key in buckets) buckets[key]++;
      } catch { /* ignore parse errors */ }
    });
    return Object.entries(buckets).map(([time, count]) => ({ time, count }));
  })();

  // Severity distribution (PieChart)
  const severityData = (() => {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    events.forEach((e) => {
      const sev = e.llm_significance || e.severity || 'low';
      if (sev in counts) counts[sev]++;
    });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  })();

  // Severity timeline — stacked area (severity breakdown over time)
  const severityTimelineData = (() => {
    const now = new Date();
    const buckets: Record<string, { time: string; critical: number; high: number; medium: number; low: number }> = {};
    for (let i = 47; i >= 0; i--) {
      const hour = startOfHour(subHours(now, i));
      const key = format(hour, 'MMM d HH:00');
      buckets[key] = { time: key, critical: 0, high: 0, medium: 0, low: 0 };
    }
    events.forEach((e) => {
      try {
        const hour = startOfHour(parseISO(e.published_at));
        const key = format(hour, 'MMM d HH:00');
        const sev = (e.llm_significance || e.severity || 'low') as keyof typeof buckets[string];
        if (key in buckets && sev in buckets[key]) (buckets[key] as any)[sev]++;
      } catch {}
    });
    return Object.values(buckets);
  })();

  // Category treemap data
  const categoryTreeData = (() => {
    const cats = summary?.top_categories || [];
    if (cats.length === 0) return [];
    return cats.slice(0, 12).map((c: { name: string; count: number }, i: number) => ({
      name: c.name,
      size: c.count,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
  })();

  // Actor radar data
  const actorRadarData = (() => {
    const actors = summary?.top_actors || [];
    if (actors.length === 0) return [];
    const max = Math.max(...actors.map((a: { count: number }) => a.count), 1);
    return actors.slice(0, 8).map((a: { name: string; count: number }) => ({
      actor: a.name.length > 12 ? a.name.slice(0, 11) + '…' : a.name,
      mentions: a.count,
      fullMark: max,
    }));
  })();

  // Processing pipeline status
  const pipelineData = stats
    ? Object.entries(stats).map(([name, count]) => ({ name, count }))
    : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-primary p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-100 mb-6">📈 Analytics</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="analyst-panel p-4 h-64 animate-pulse">
                <div className="h-4 bg-gray-700 rounded w-1/3 mb-4" />
                <div className="h-40 bg-gray-800/50 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">📈 Analytics</h1>
            <p className="text-sm text-gray-400 mt-1">
              {events.length} events from {sources.length} sources
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-300 transition-colors"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Quick stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Events', value: summary?.total_events || 0, color: 'text-white' },
            { label: 'AI Processed', value: summary?.llm_processed || 0, color: 'text-purple-400' },
            { label: 'Enriched', value: summary?.with_enrichment || 0, color: 'text-green-400' },
            { label: 'Active Sources', value: sources.filter((s) => s.enabled).length, color: 'text-blue-400' },
          ].map((stat) => (
            <div key={stat.label} className="analyst-panel p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{stat.label}</p>
              <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* Event Timeline */}
        <ChartCard title="📊 Event Volume (Last 48 Hours)" className="col-span-full">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={timelineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                interval={5}
                angle={-45}
                textAnchor="end"
                height={50}
              />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#e94560"
                fill="#e94560"
                fillOpacity={0.2}
                name="Events"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Row of 3: severity, categories, actors */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Severity Distribution */}
          <ChartCard title="⚡ Severity Distribution">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={severityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={{ stroke: '#6b7280' }}
                >
                  {severityData.map((entry) => (
                    <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Top Categories */}
          <ChartCard title="🔴 Top Categories">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={(summary?.top_categories || []).slice(0, 8)}
                layout="vertical"
                margin={{ left: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  width={55}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Events" radius={[0, 4, 4, 0]}>
                  {(summary?.top_categories || []).slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Top Actors */}
          <ChartCard title="🔵 Top Actors">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={(summary?.top_actors || []).slice(0, 8)}
                layout="vertical"
                margin={{ left: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  width={55}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Events" fill="#06b6d4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Row of 2: pipeline + themes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Processing Pipeline */}
          <ChartCard title="🔄 Processing Pipeline Status">
            {pipelineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={pipelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" name="Events" radius={[4, 4, 0, 0]}>
                    {pipelineData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#6b7280'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-500 py-8 text-center">No pipeline data available</p>
            )}
          </ChartCard>

          {/* Significance + Themes */}
          <ChartCard title="🟠 Themes & Significance">
            <div className="space-y-4">
              {/* Significance distribution */}
              {summary && summary.significance_distribution.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase mb-2">Significance Levels</p>
                  <div className="space-y-1">
                    {summary.significance_distribution.map((d) => {
                      const max = summary.significance_distribution[0]?.count || 1;
                      return (
                        <div key={d.level} className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 capitalize w-14">{d.level}</span>
                          <div className="flex-1 h-4 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${(d.count / max) * 100}%`,
                                backgroundColor: SEVERITY_COLORS[d.level] || '#6b7280',
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 font-mono w-8 text-right">{d.count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Top themes */}
              {summary && summary.top_themes.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase mb-2">Top Themes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.top_themes.map((theme) => (
                      <span
                        key={theme.name}
                        className="text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20"
                      >
                        {theme.name} <span className="text-amber-400/60">{theme.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ChartCard>
        </div>

        {/* Source Health Table */}
        <ChartCard title="📡 Source Health">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-gray-500">
                  <th className="text-left px-3 py-2 font-medium">Source</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-center px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Events</th>
                  <th className="text-right px-3 py-2 font-medium">Errors</th>
                  <th className="text-left px-3 py-2 font-medium">Last Polled</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="px-3 py-2 text-gray-200 font-medium">{source.name}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 text-[10px] uppercase">
                        {source.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          source.enabled ? 'bg-green-500' : 'bg-gray-600'
                        }`}
                        title={source.enabled ? 'Enabled' : 'Disabled'}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-gray-300 font-mono">{source.total_events}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={source.error_count > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}>
                        {source.error_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {source.last_polled_at
                        ? format(parseISO(source.last_polled_at), 'MMM d HH:mm')
                        : 'Never'}
                    </td>
                  </tr>
                ))}
                {sources.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                      No sources configured
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
