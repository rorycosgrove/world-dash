'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useDashboardStore } from '@/store/dashboard';
import { api, Event } from '@/lib/api';
import clsx from 'clsx';

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
  const { events, setEvents, selectedEvent, setSelectedEvent, filterSeverity, filterCategory } =
    useDashboardStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const data = await api.getEvents({
          limit: 100,
          since_hours: 24,
          severity: filterSeverity || undefined,
        });
        setEvents(data);
        setError(null);
      } catch (err: any) {
        console.error('Failed to fetch events:', err);
        setError('Failed to load events');
      } finally {
        setIsLoading(false);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, [filterSeverity, setEvents]);

  // Client-side category filter
  const filteredEvents = useMemo(() => {
    if (!filterCategory) return events;
    return events.filter((e: Event) =>
      (e.categories || []).some((c: string) => c.toLowerCase() === filterCategory)
    );
  }, [events, filterCategory]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Events</h2>
          <span className="text-xs text-gray-500">{filteredEvents.length} / {events.length}</span>
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
      <div className="flex-1 overflow-y-auto">
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
              onClick={() => window.location.reload()}
              className="mt-2 text-xs text-gray-400 hover:text-white underline"
            >
              Retry
            </button>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <p className="text-lg mb-1">No events found</p>
            <p className="text-xs">
              {filterCategory ? `No events match "${filterCategory}". Try clearing the filter.` : 'Waiting for events...'}
            </p>
          </div>
        ) : (
          filteredEvents.map((event: Event) => {
            const sig = event.llm_significance || event.severity;
            const isSelected = selectedEvent?.id === event.id;
            const categories = event.categories ?? [];
            const actors = event.actors ?? [];

            return (
              <div
                key={event.id}
                className={clsx(
                  'px-3 py-2.5 border-b border-gray-800 cursor-pointer transition-colors',
                  isSelected ? 'bg-accent border-l-2 border-l-purple-500' : 'hover:bg-gray-800/50'
                )}
                onClick={() => setSelectedEvent(isSelected ? null : event)}
              >
                {/* Title row */}
                <div className="flex items-start gap-2">
                  {sig && <SeverityDot level={sig} />}
                  <h3 className="text-sm font-medium flex-1 leading-snug line-clamp-2">{event.title}</h3>
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500">
                  <span>{formatDistanceToNow(new Date(event.published_at), { addSuffix: true })}</span>
                  {event.location?.country && (
                    <span className="text-blue-400/70">📍{event.location.country}</span>
                  )}
                  {event.llm_processed_at && (
                    <span className="text-purple-400/60" title="AI analyzed">🤖</span>
                  )}
                </div>

                {/* Category/actor chips — compact, max 1 row */}
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
          })
        )}
      </div>
    </div>
  );
}
