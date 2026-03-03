'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useDashboardStore } from '@/store/dashboard';
import { api, Event } from '@/lib/api';
import clsx from 'clsx';

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const DATE_RANGE_HOURS: Record<string, number> = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 };

function SeverityDot({ level }: { level: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-green-500',
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[level] || 'bg-gray-500'}`}
      title={level}
    />
  );
}

export default function EventFeed() {
  const {
    events,
    setEvents,
    selectedEvent,
    setSelectedEvent,
    filterSeverity,
    filterCategory,
    searchQuery,
    sortBy,
    dateRange,
    autoRefresh,
    openDrawer,
    pinnedEventIds,
    togglePinEvent,
  } = useDashboardStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(50);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const sinceHours = DATE_RANGE_HOURS[dateRange] || 24;
      const data = await api.getEvents({
        limit: 200,
        since_hours: sinceHours,
        severity: filterSeverity || undefined,
        search: searchQuery || undefined,
      });

      // Merge new events while preserving object identity for selectedEvent
      const currentSelected = useDashboardStore.getState().selectedEvent;
      if (currentSelected) {
        const freshSelected = data.find((e: Event) => e.id === currentSelected.id);
        if (freshSelected) {
          // Preserve the selected event reference only if data hasn't changed
          const idx = data.indexOf(freshSelected);
          if (idx !== -1 && JSON.stringify(freshSelected) === JSON.stringify(currentSelected)) {
            data[idx] = currentSelected;
          } else if (freshSelected) {
            // Update selected event with fresh data
            useDashboardStore.getState().setSelectedEvent(freshSelected);
          }
        }
      }
      setEvents(data);
      setError(null);

      // Emit LLM scan stats for the debug panel
      const llmDone = data.filter((e: Event) => e.llm_processed_at).length;
      const pending = data.length - llmDone;
      console.debug('LLM scan status', {
        total: data.length,
        llmProcessed: llmDone,
        pending,
        categories: [...new Set(data.flatMap((e: Event) => e.categories || []))].slice(0, 6),
      });
    } catch (err: any) {
      console.error('Failed to fetch events:', err);
      setError('Failed to load events');
    } finally {
      setIsLoading(false);
    }
  }, [filterSeverity, searchQuery, dateRange, setEvents]);

  useEffect(() => {
    fetchEvents();
    if (!autoRefresh) return;
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, [fetchEvents, autoRefresh]);

  // Client-side filtering (category + text search), sorting
  const filteredEvents = useMemo(() => {
    let filtered = events;

    // Category filter
    if (filterCategory) {
      filtered = filtered.filter((e: Event) =>
        (e.categories || []).some((c: string) => c.toLowerCase() === filterCategory)
      );
    }

    // Client-side text search (supplement to server-side)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e: Event) =>
          e.title.toLowerCase().includes(q) ||
          (e.description || '').toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)) ||
          e.actors.some((a) => a.toLowerCase().includes(q)) ||
          e.categories.some((c) => c.toLowerCase().includes(q))
      );
    }

    // Sort
    if (sortBy === 'severity') {
      filtered = [...filtered].sort((a, b) => {
        const sa = SEVERITY_ORDER[a.llm_significance || a.severity || 'low'] || 0;
        const sb = SEVERITY_ORDER[b.llm_significance || b.severity || 'low'] || 0;
        return sb - sa;
      });
    } else if (sortBy === 'risk_score') {
      filtered = [...filtered].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
    }
    // 'time' is the default server order (newest first)

    return filtered;
  }, [events, filterCategory, searchQuery, sortBy]);

  // Infinite scroll "load more"
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      setDisplayCount((prev) => Math.min(prev + 30, filteredEvents.length));
    }
  }, [filteredEvents.length]);

  const displayedEvents = filteredEvents.slice(0, displayCount);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Events</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{filteredEvents.length} / {events.length}</span>
          </div>
        </div>
        {filterCategory && (
          <div className="mt-1 flex items-center gap-1">
            <span className="text-[11px] px-2 py-0.5 rounded bg-red-600/20 text-red-300 border border-red-500/30 capitalize">
              {filterCategory}
            </span>
            <button
              onClick={() => useDashboardStore.getState().setFilterCategory(null)}
              className="text-[11px] text-gray-500 hover:text-gray-300"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Events list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {isLoading ? (
          <div className="p-6 text-center text-gray-500">
            <div className="animate-pulse space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-16 bg-gray-800/50 rounded" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={fetchEvents}
              className="mt-2 text-xs text-gray-400 hover:text-white underline"
            >
              Retry
            </button>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <p className="text-lg mb-1">No events found</p>
            <p className="text-xs">
              {searchQuery
                ? `No results for "${searchQuery}". Try broadening the search.`
                : filterCategory
                ? `No events match "${filterCategory}". Try clearing the filter.`
                : 'Waiting for events...'}
            </p>
          </div>
        ) : (
          <>
            {displayedEvents.map((event: Event) => {
              const sig = event.llm_significance || event.severity;
              const isSelected = selectedEvent?.id === event.id;
              const isPinned = pinnedEventIds.has(event.id);
              const categories = event.categories ?? [];
              const actors = event.actors ?? [];

              return (
                <div
                  key={event.id}
                  className={clsx(
                    'px-3 py-2.5 border-b border-gray-800 cursor-pointer transition-colors group',
                    isPinned && 'border-l-2 border-l-amber-500',
                    isSelected ? 'bg-accent border-l-2 border-l-purple-500' : 'hover:bg-gray-800/50'
                  )}
                  onClick={() => setSelectedEvent(isSelected ? null : event)}
                  onDoubleClick={() => openDrawer(event.id)}
                >
                  {/* Title row */}
                  <div className="flex items-start gap-2">
                    {sig && <SeverityDot level={sig} />}
                    <h3 className="text-sm font-medium flex-1 leading-snug line-clamp-2">{event.title}</h3>
                    {/* Pin button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePinEvent(event.id);
                      }}
                      className={clsx(
                        'text-xs flex-shrink-0 transition-all',
                        isPinned
                          ? 'text-amber-400 hover:text-amber-300 opacity-100'
                          : 'text-gray-600 hover:text-amber-400 opacity-0 group-hover:opacity-100'
                      )}
                      title={isPinned ? 'Unpin from compare' : 'Pin for compare'}
                    >
                      📌
                    </button>
                    {/* Quick open drawer button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer(event.id);
                      }}
                      className="text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity text-xs flex-shrink-0"
                      title="View details"
                    >
                      →
                    </button>
                  </div>

                  {/* Meta row */}
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500">
                    <span>{formatDistanceToNow(new Date(event.published_at), { addSuffix: true })}</span>
                    {event.location?.country && (
                      <span className="text-blue-400/70">📍{event.location.country}</span>
                    )}
                    {event.risk_score !== null && event.risk_score !== undefined && (
                      <span className="text-gray-400 font-mono" title="Risk score">
                        ⚡{event.risk_score.toFixed(2)}
                      </span>
                    )}
                    {event.llm_processed_at && (
                      <span className="text-purple-400/60" title="AI analyzed">🤖</span>
                    )}
                  </div>

                  {/* Category/actor chips */}
                  {(categories.length > 0 || actors.length > 0) && (
                    <div className="flex gap-1 mt-1.5 flex-wrap max-h-6 overflow-hidden">
                      {categories.slice(0, 2).map((cat: string) => (
                        <span
                          key={cat}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 capitalize"
                        >
                          {cat}
                        </span>
                      ))}
                      {actors.slice(0, 2).map((actor: string) => (
                        <span
                          key={actor}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300"
                        >
                          {actor}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Load more indicator */}
            {displayCount < filteredEvents.length && (
              <div className="p-4 text-center">
                <button
                  onClick={() => setDisplayCount((prev) => Math.min(prev + 30, filteredEvents.length))}
                  className="text-xs text-purple-400 hover:text-purple-300 underline"
                >
                  Load more ({filteredEvents.length - displayCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
