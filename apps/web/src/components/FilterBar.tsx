'use client';

import { useMemo } from 'react';
import { useDashboardStore } from '@/store/dashboard';

const KNOWN_CATEGORIES = [
  'military', 'diplomatic', 'economic', 'humanitarian', 'protest',
  'conflict', 'trade', 'sanctions', 'alliance', 'cyber', 'environmental',
];

export default function FilterBar() {
  const { events, filterSeverity, setFilterSeverity, filterCategory, setFilterCategory } =
    useDashboardStore();

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
    // Only show categories that appear in data, sorted by frequency
    const fromData = Array.from(catCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
    // Add known categories that aren't in data (greyed out)
    const extras = KNOWN_CATEGORIES.filter((k) => !catCount.has(k));
    return { active: fromData, inactive: extras };
  }, [events]);

  return (
    <div className="analyst-panel p-2.5">
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

        {/* Active filter indicator */}
        {(filterSeverity || filterCategory) && (
          <button
            onClick={() => { setFilterSeverity(null); setFilterCategory(null); }}
            className="text-[11px] px-2 py-1 rounded bg-gray-700 text-gray-400 hover:bg-gray-600 flex-shrink-0"
            title="Clear all filters"
          >
            ✕ Clear
          </button>
        )}
      </div>
    </div>
  );
}
