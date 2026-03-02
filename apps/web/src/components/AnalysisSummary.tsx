'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useDashboardStore } from '@/store/dashboard';

interface AnalysisData {
  total_events: number;
  llm_processed: number;
  with_enrichment: number;
  top_categories: { name: string; count: number }[];
  top_actors: { name: string; count: number }[];
  top_themes: { name: string; count: number }[];
  significance_distribution: { level: string; count: number }[];
}

const SIG_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
};

const SIG_TEXT_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-green-400',
};

function ProgressRing({
  percent,
  size = 52,
  stroke = 4,
}: {
  percent: number;
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#374151"
        strokeWidth={stroke}
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={percent >= 80 ? '#10b981' : percent >= 40 ? '#f59e0b' : '#8b5cf6'}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-1000 ease-out"
      />
    </svg>
  );
}

export default function AnalysisSummary() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState(false);
  const { autoRefresh, setFilterCategory, setFilterSeverity } = useDashboardStore();

  const fetchSummary = useCallback(async () => {
    try {
      const summary = await api.getAnalysisSummary();
      setData(summary);
      setError(false);

      // Emit analysis progress for the debug panel
      const remaining = summary.total_events - summary.llm_processed;
      console.debug('Analysis update', {
        enriched: summary.with_enrichment,
        scanned: summary.llm_processed,
        total: summary.total_events,
        remaining,
        topCategories: summary.top_categories.slice(0, 3).map((c: { name: string }) => c.name),
        topActors: summary.top_actors.slice(0, 3).map((a: { name: string }) => a.name),
      });
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    if (!autoRefresh) return;
    const interval = setInterval(fetchSummary, 15000);
    return () => clearInterval(interval);
  }, [fetchSummary, autoRefresh]);

  if (error || !data) {
    return (
      <div className="analyst-panel p-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="animate-pulse">●</span>
          {error ? 'Analysis summary unavailable' : 'Loading analysis...'}
        </div>
      </div>
    );
  }

  const pctProcessed = data.total_events > 0
    ? Math.round((data.llm_processed / data.total_events) * 100)
    : 0;
  const pctEnriched = data.total_events > 0
    ? Math.round((data.with_enrichment / data.total_events) * 100)
    : 0;
  // Drive the progress ring by LLM scan progress — this is the metric that
  // steadily advances as the background pipeline processes events.
  const ringPct = pctProcessed;
  const totalSig = data.significance_distribution.reduce((s, d) => s + d.count, 0);

  return (
    <div className="analyst-panel">
      {/* Compact bar — always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 flex items-center gap-4 hover:bg-accent/30 transition-colors rounded-lg text-left"
      >
        {/* Progress ring */}
        <div className="relative flex-shrink-0">
          <ProgressRing percent={ringPct} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold text-gray-100">{ringPct}%</span>
          </div>
        </div>

        {/* Key stats row */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-400">
              🤖 <span className="text-gray-100 font-semibold">{data.llm_processed}</span>/{data.total_events} scanned
            </span>
            {data.with_enrichment > 0 && (
              <>
                <span className="text-gray-600">|</span>
                <span className="text-gray-400">
                  <span className="text-gray-100 font-semibold">{data.with_enrichment}</span> enriched
                </span>
              </>
            )}
            {data.llm_processed < data.total_events && (
              <>
                <span className="text-gray-600">|</span>
                <span className="text-purple-400 animate-pulse text-[11px]">
                  🤖 Analyzing… {data.total_events - data.llm_processed} remaining
                </span>
              </>
            )}
          </div>

          {/* Significance mini-bar */}
          {totalSig > 0 && (
            <div className="flex gap-0.5 mt-1.5 h-1.5 rounded-full overflow-hidden bg-gray-800">
              {data.significance_distribution.map((d) => (
                <button
                  key={d.level}
                  onClick={(e) => { e.stopPropagation(); setFilterSeverity(d.level); }}
                  className={`${SIG_COLORS[d.level] || 'bg-gray-600'} transition-all duration-500 hover:brightness-125 cursor-pointer`}
                  style={{ width: `${(d.count / totalSig) * 100}%` }}
                  title={`${d.level}: ${d.count} — click to filter`}
                />
              ))}
            </div>
          )}

          {/* Top 3 categories inline */}
          {data.top_categories.length > 0 && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {data.top_categories.slice(0, 4).map((cat) => (
                <button
                  key={cat.name}
                  onClick={(e) => { e.stopPropagation(); setFilterCategory(cat.name.toLowerCase()); }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/20 capitalize hover:bg-red-500/25 transition-colors cursor-pointer"
                >
                  {cat.name} <span className="text-red-400/60">{cat.count}</span>
                </button>
              ))}
              {data.top_categories.length > 4 && (
                <span className="text-[10px] text-gray-500">+{data.top_categories.length - 4}</span>
              )}
            </div>
          )}
        </div>

        {/* Expand arrow */}
        <span className={`text-gray-500 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {/* Expanded insights panel */}
      {isExpanded && (
        <div className="border-t border-gray-700 p-3 grid grid-cols-3 gap-4 text-xs animate-in">
          {/* Categories column */}
          <div>
            <h4 className="text-gray-400 font-semibold mb-2 uppercase tracking-wide text-[10px]">
              🔴 Top Categories
            </h4>
            <div className="space-y-1">
              {data.top_categories.slice(0, 8).map((cat) => {
                const maxCount = data.top_categories[0]?.count || 1;
                return (
                  <div key={cat.name} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between">
                        <span className="text-gray-200 capitalize truncate">{cat.name}</span>
                        <span className="text-gray-500 ml-1 flex-shrink-0">{cat.count}</span>
                      </div>
                      <div className="h-1 bg-gray-800 rounded-full mt-0.5">
                        <div
                          className="h-1 bg-red-500/60 rounded-full transition-all duration-500"
                          style={{ width: `${(cat.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actors column */}
          <div>
            <h4 className="text-gray-400 font-semibold mb-2 uppercase tracking-wide text-[10px]">
              🔵 Top Actors
            </h4>
            <div className="space-y-1">
              {data.top_actors.slice(0, 8).map((actor) => {
                const maxCount = data.top_actors[0]?.count || 1;
                return (
                  <div key={actor.name} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between">
                        <span className="text-gray-200 truncate">{actor.name}</span>
                        <span className="text-gray-500 ml-1 flex-shrink-0">{actor.count}</span>
                      </div>
                      <div className="h-1 bg-gray-800 rounded-full mt-0.5">
                        <div
                          className="h-1 bg-cyan-500/60 rounded-full transition-all duration-500"
                          style={{ width: `${(actor.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Significance + Themes column */}
          <div>
            <h4 className="text-gray-400 font-semibold mb-2 uppercase tracking-wide text-[10px]">
              ⚡ Significance
            </h4>
            <div className="space-y-1 mb-3">
              {data.significance_distribution.map((d) => (
                <div key={d.level} className="flex items-center justify-between">
                  <span className={`capitalize ${SIG_TEXT_COLORS[d.level] || 'text-gray-400'}`}>
                    {d.level}
                  </span>
                  <span className="text-gray-400 font-mono">{d.count}</span>
                </div>
              ))}
            </div>

            {data.top_themes.length > 0 && (
              <>
                <h4 className="text-gray-400 font-semibold mb-2 uppercase tracking-wide text-[10px]">
                  🟠 Top Themes
                </h4>
                <div className="flex flex-wrap gap-1">
                  {data.top_themes.slice(0, 6).map((theme) => (
                    <span
                      key={theme.name}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20"
                    >
                      {theme.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
