'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDashboardStore } from '@/store/dashboard';
import type { ViewMode, DateRange, SortBy } from '@/store/dashboard';
import { api, SemanticSearchResult } from '@/lib/api';
import clsx from 'clsx';

const VIEW_MODES: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: 'network', label: 'Network', icon: '🕸️' },
  { mode: 'map', label: 'Map', icon: '🗺️' },
  { mode: 'compare', label: 'Compare', icon: '📊' },
];

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: '1h', label: '1H' },
  { value: '6h', label: '6H' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
];

const SORT_OPTIONS: { value: SortBy; label: string; icon: string }[] = [
  { value: 'time', label: 'Time', icon: '🕐' },
  { value: 'severity', label: 'Severity', icon: '⚡' },
  { value: 'risk_score', label: 'Risk', icon: '📈' },
];

export default function CommandBar() {
  const {
    viewMode, setViewMode,
    searchQuery, setSearchQuery,
    filterSeverity, setFilterSeverity,
    filterCategory, setFilterCategory,
    dateRange, setDateRange,
    sortBy, setSortBy,
    pinnedEventIds, clearPins,
    compareMode, setCompareMode,
    timelineRange, setTimelineRange,
    clearAllFilters,
    events,
  } = useDashboardStore();

  const [searchInputValue, setSearchInputValue] = useState(searchQuery);
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Debounced text search
  const handleSearchChange = useCallback((value: string) => {
    setSearchInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
    }, 300);
  }, [setSearchQuery]);

  // Semantic search (Ctrl+Enter)
  const handleSemanticSearch = useCallback(async () => {
    if (!searchInputValue.trim()) return;
    setIsSearching(true);
    try {
      const results = await api.semanticSearch(searchInputValue);
      setSemanticResults(results);
    } catch (e) {
      console.error('Semantic search failed:', e);
      setSemanticResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchInputValue]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSemanticSearch();
    }
    if (e.key === 'Escape') {
      setSemanticResults(null);
      setSearchInputValue('');
      setSearchQuery('');
    }
  }, [handleSemanticSearch, setSearchQuery]);

  // Close semantic results on outside click
  useEffect(() => {
    if (!semanticResults) return;
    const handler = () => setSemanticResults(null);
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [semanticResults]);

  // Active filter count
  const activeFilters: string[] = [];
  if (filterSeverity) activeFilters.push(`Severity: ${filterSeverity}`);
  if (filterCategory) activeFilters.push(`Category: ${filterCategory}`);
  if (searchQuery) activeFilters.push(`Search: "${searchQuery}"`);
  if (timelineRange) activeFilters.push('Time selection active');

  const hasFilters = activeFilters.length > 0;
  const pinCount = pinnedEventIds.size;

  return (
    <div className="command-bar flex-shrink-0">
      {/* Main bar */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* Search */}
        <div className="relative flex-1 min-w-0 max-w-md">
          <input
            ref={searchRef}
            type="text"
            value={searchInputValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search events… (Ctrl+Enter for AI)"
            data-command-search
            className="w-full text-xs bg-gray-800/60 border border-gray-700/50 rounded-md px-3 py-1.5 text-gray-200 placeholder-gray-500 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 outline-none transition-colors"
          />
          {isSearching && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <div className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Semantic search results dropdown */}
          {semanticResults && semanticResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 glass-panel-solid shadow-xl z-50 max-h-48 overflow-y-auto">
              {semanticResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    useDashboardStore.getState().openDrawer(r.event.id);
                    setSemanticResults(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-800/60 transition-colors border-b border-gray-800/30 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-purple-300">{Math.round(r.similarity * 100)}%</span>
                    <span className="text-xs text-gray-200 truncate">{r.event.title}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort */}
        <div className="hidden sm:flex items-center bg-gray-800/40 rounded p-0.5 gap-0.5">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              className={clsx(
                'text-[10px] px-1.5 py-0.5 rounded transition-colors',
                sortBy === opt.value ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300'
              )}
              title={`Sort by ${opt.label}`}
            >
              {opt.icon}
            </button>
          ))}
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-gray-700/50 hidden sm:block" />

        {/* Date range */}
        <div className="hidden md:flex items-center bg-gray-800/40 rounded p-0.5 gap-0.5">
          {DATE_RANGES.map(dr => (
            <button
              key={dr.value}
              onClick={() => setDateRange(dr.value)}
              className={clsx(
                'text-[10px] px-1.5 py-0.5 rounded transition-colors',
                dateRange === dr.value ? 'bg-accent text-white' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {dr.label}
            </button>
          ))}
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-gray-700/50" />

        {/* View mode toggle */}
        <div className="flex items-center bg-gray-800/40 rounded-md p-0.5 gap-0.5">
          {VIEW_MODES.map(vm => (
            <button
              key={vm.mode}
              onClick={() => setViewMode(vm.mode)}
              className={clsx(
                'text-[10px] px-2 py-1 rounded transition-colors flex items-center gap-1',
                viewMode === vm.mode
                  ? (vm.mode === 'compare' ? 'bg-purple-600/80 text-white' : 'bg-accent text-white')
                  : 'text-gray-400 hover:text-gray-200'
              )}
              title={vm.label}
            >
              <span>{vm.icon}</span>
              <span className="hidden lg:inline">{vm.label}</span>
            </button>
          ))}
        </div>

        {/* Pin count / Compare */}
        {pinCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-amber-400">📌 {pinCount}</span>
            {pinCount >= 2 && (
              <button
                onClick={() => { setCompareMode(true); setViewMode('compare'); }}
                className="text-[10px] px-2 py-0.5 rounded bg-purple-600/60 text-purple-200 hover:bg-purple-600 transition-colors"
              >
                Compare
              </button>
            )}
            <button
              onClick={clearPins}
              className="text-[10px] text-gray-500 hover:text-gray-300"
              title="Clear pins"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
          {filterSeverity && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-800/60 text-gray-300 border border-gray-700/50">
              ⚡ {filterSeverity}
              <button onClick={() => setFilterSeverity(null)} className="text-gray-500 hover:text-gray-300 ml-0.5">✕</button>
            </span>
          )}
          {filterCategory && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-800/60 text-gray-300 border border-gray-700/50">
              🔴 {filterCategory}
              <button onClick={() => setFilterCategory(null)} className="text-gray-500 hover:text-gray-300 ml-0.5">✕</button>
            </span>
          )}
          {timelineRange && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
              🕐 Time selection
              <button onClick={() => setTimelineRange(null)} className="text-purple-400 hover:text-purple-200 ml-0.5">✕</button>
            </span>
          )}
          <button onClick={clearAllFilters} className="text-[10px] text-gray-500 hover:text-gray-300 ml-1">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
