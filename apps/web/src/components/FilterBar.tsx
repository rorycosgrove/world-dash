'use client';

import { useCallback, useMemo, useState } from 'react';
import { useDashboardStore, DateRange, SortBy } from '@/store/dashboard';
import { api, SemanticSearchResult } from '@/lib/api';
import clsx from 'clsx';

const KNOWN_CATEGORIES = [
  'military', 'diplomatic', 'economic', 'humanitarian', 'protest',
  'conflict', 'trade', 'sanctions', 'alliance', 'cyber', 'environmental',
];

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

const SORT_OPTIONS: { value: SortBy; label: string; icon: string }[] = [
  { value: 'time', label: 'Time', icon: '🕐' },
  { value: 'severity', label: 'Severity', icon: '⚡' },
  { value: 'risk_score', label: 'Risk', icon: '📊' },
];

export default function FilterBar() {
  const {
    events,
    filterSeverity,
    setFilterSeverity,
    filterCategory,
    setFilterCategory,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    dateRange,
    setDateRange,
    clearAllFilters,
  } = useDashboardStore();

  const severities = [
    { value: null, label: 'All' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Med' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Crit' },
  ];

  // Derive available categories from events that have LLM data, sorted by frequency
  const availableCategories = useMemo(() => {
    const catCount = new Map<string, number>();
    events.forEach((e) => {
      (e.categories || []).forEach((c) => {
        const lower = c.toLowerCase();
        catCount.set(lower, (catCount.get(lower) || 0) + 1);
      });
    });
    const fromData = Array.from(catCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
    const extras = KNOWN_CATEGORIES.filter((k) => !catCount.has(k));
    return { active: fromData, inactive: extras };
  }, [events]);

  const hasActiveFilters = filterSeverity || filterCategory || searchQuery || sortBy !== 'time' || dateRange !== '24h';

  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [showSemanticResults, setShowSemanticResults] = useState(false);

  const handleSemanticSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSemanticLoading(true);
    setShowSemanticResults(true);
    try {
      const results = await api.semanticSearch(searchQuery.trim(), 10, 0.3);
      setSemanticResults(results);
    } catch (e) {
      console.error('Semantic search failed', e);
      setSemanticResults([]);
    } finally {
      setSemanticLoading(false);
    }
  }, [searchQuery]);

  return (
    <div className="analyst-panel p-2.5 space-y-2">
      {/* Row 1: Search + Date Range + Sort */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-0 max-w-xs">
          <input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) handleSemanticSearch();
            }}
            className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setShowSemanticResults(false); setSemanticResults([]); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Semantic search button */}
        <button
          onClick={handleSemanticSearch}
          disabled={!searchQuery.trim() || semanticLoading}
          className={clsx(
            'flex-shrink-0 text-[10px] px-2 py-1 rounded-md transition-colors',
            searchQuery.trim()
              ? 'text-purple-400 hover:bg-purple-900/30 border border-purple-700/40'
              : 'text-gray-600 cursor-not-allowed'
          )}
          title="Semantic vector search (Ctrl+Enter)"
        >
          {semanticLoading ? '⏳' : '🔮'} AI Search
        </button>

        {/* Spacer */}
        <div className="w-px h-5 bg-gray-700 flex-shrink-0" />

        {/* Date range */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Range</span>
          {DATE_RANGES.map((dr) => (
            <button
              key={dr.value}
              onClick={() => setDateRange(dr.value)}
              className={clsx(
                'text-[11px] px-1.5 py-1 rounded transition-colors',
                dateRange === dr.value
                  ? 'bg-accent text-white'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'
              )}
            >
              {dr.label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-gray-700 flex-shrink-0" />

        {/* Sort */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Sort</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              className={clsx(
                'text-[11px] px-1.5 py-1 rounded transition-colors',
                sortBy === opt.value
                  ? 'bg-accent text-white'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'
              )}
              title={`Sort by ${opt.label}`}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Severity + Category filters */}
      <div className="flex items-center gap-3">
        {/* Severity filter */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[11px] font-semibold text-gray-400 mr-0.5 uppercase tracking-wide">Sev</span>
          {severities.map((sev) => (
            <button
              key={sev.label}
              onClick={() => setFilterSeverity(sev.value)}
              className={`text-[11px] px-2 py-1 rounded transition-colors ${
                filterSeverity === sev.value
                  ? 'bg-highlight text-white'
                  : 'bg-gray-700/50 hover:bg-gray-600 text-gray-300'
              }`}
            >
              {sev.label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-gray-700 flex-shrink-0" />

        {/* Category filter — horizontal scroll */}
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide">
          <span className="text-[11px] font-semibold text-gray-400 mr-0.5 uppercase tracking-wide flex-shrink-0">Cat</span>
          <button
            onClick={() => setFilterCategory(null)}
            className={`text-[11px] px-2 py-1 rounded transition-colors flex-shrink-0 ${
              filterCategory === null
                ? 'bg-highlight text-white'
                : 'bg-gray-700/50 hover:bg-gray-600 text-gray-300'
            }`}
          >
            All
          </button>
          {availableCategories.active.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
              className={`text-[11px] px-2 py-1 rounded transition-colors capitalize flex-shrink-0 ${
                filterCategory === cat
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-700/50 hover:bg-gray-600 text-gray-300'
              }`}
            >
              {cat}
            </button>
          ))}
          {availableCategories.inactive.slice(0, 4).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
              className={`text-[11px] px-2 py-1 rounded transition-colors capitalize flex-shrink-0 ${
                filterCategory === cat
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-800/50 text-gray-600 hover:bg-gray-700 hover:text-gray-400'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Clear all */}
        {hasActiveFilters && (
          <button
            onClick={() => { clearAllFilters(); setShowSemanticResults(false); setSemanticResults([]); }}
            className="text-[11px] px-2 py-1 rounded bg-gray-700 text-gray-400 hover:bg-gray-600 flex-shrink-0"
            title="Clear all filters"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Semantic search results dropdown */}
      {showSemanticResults && (
        <div className="border border-purple-800/30 rounded-md bg-gray-800/80 max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-700/50">
            <span className="text-[10px] text-purple-400 font-medium">
              🔮 Semantic Results ({semanticResults.length})
            </span>
            <button
              onClick={() => setShowSemanticResults(false)}
              className="text-[10px] text-gray-500 hover:text-gray-300"
            >
              ✕
            </button>
          </div>
          {semanticLoading ? (
            <div className="text-[10px] text-gray-500 text-center py-3">Searching vectors…</div>
          ) : semanticResults.length === 0 ? (
            <div className="text-[10px] text-gray-600 text-center py-3">No similar events found</div>
          ) : (
            semanticResults.map((r) => (
              <div
                key={r.event.id}
                className="px-2.5 py-1.5 border-b border-gray-700/30 hover:bg-gray-700/30 transition-colors cursor-pointer"
                onClick={() => {
                  const { openDrawer } = useDashboardStore.getState();
                  openDrawer(r.event.id);
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1 py-0.5 rounded font-mono flex-shrink-0">
                    {(r.similarity * 100).toFixed(0)}%
                  </span>
                  <span className="text-[11px] text-gray-300 truncate">{r.event.title}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
