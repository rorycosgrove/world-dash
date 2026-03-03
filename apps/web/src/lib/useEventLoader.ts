'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useDashboardStore } from '@/store/dashboard';
import { api, Event } from '@/lib/api';

const DATE_RANGE_HOURS: Record<string, number> = {
  '1h': 1, '6h': 6, '24h': 24, '3d': 72, '7d': 168, '30d': 720,
};

/**
 * Central hook that fetches events into the dashboard store.
 * Mount this once at the page level so events are available
 * to all child components (EventNetworkMap, WorldMap, InsightFeed, etc.).
 */
export function useEventLoader() {
  const {
    filterSeverity,
    filterCategory,
    searchQuery,
    dateRange,
    autoRefresh,
    setEvents,
  } = useDashboardStore();

  const fetchEvents = useCallback(async () => {
    try {
      const sinceHours = DATE_RANGE_HOURS[dateRange] || 24;
      const data = await api.getEvents({
        limit: 200,
        since_hours: sinceHours,
        severity: filterSeverity || undefined,
        search: searchQuery || undefined,
        category: filterCategory || undefined,
      });

      // Preserve selected event reference when data refreshes
      const currentSelected = useDashboardStore.getState().selectedEvent;
      if (currentSelected) {
        const fresh = data.find((e: Event) => e.id === currentSelected.id);
        if (fresh) {
          const idx = data.indexOf(fresh);
          if (idx !== -1 && JSON.stringify(fresh) !== JSON.stringify(currentSelected)) {
            useDashboardStore.getState().setSelectedEvent(fresh);
          }
        }
      }

      setEvents(data);
    } catch (err) {
      console.error('Failed to fetch events:', err);
    }
  }, [filterSeverity, filterCategory, searchQuery, dateRange, setEvents]);

  // Initial fetch + polling
  useEffect(() => {
    fetchEvents();
    if (!autoRefresh) return;
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, [fetchEvents, autoRefresh]);

  return { refetch: fetchEvents };
}
