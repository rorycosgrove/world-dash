import { create } from 'zustand';
import { Event, Alert } from '@/lib/api';

interface DashboardState {
  events: Event[];
  alerts: Alert[];
  selectedEvent: Event | null;
  filterSeverity: string | null;
  filterCategory: string | null;
  autoRefresh: boolean;
  
  setEvents: (events: Event[]) => void;
  setAlerts: (alerts: Alert[]) => void;
  setSelectedEvent: (event: Event | null) => void;
  setFilterSeverity: (severity: string | null) => void;
  setFilterCategory: (category: string | null) => void;
  toggleAutoRefresh: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  events: [],
  alerts: [],
  selectedEvent: null,
  filterSeverity: null,
  filterCategory: null,
  autoRefresh: true,
  
  setEvents: (events) => set({ events }),
  setAlerts: (alerts) => set({ alerts }),
  setSelectedEvent: (event) => set({ selectedEvent: event }),
  setFilterSeverity: (severity) => set({ filterSeverity: severity }),
  setFilterCategory: (category) => set({ filterCategory: category }),
  toggleAutoRefresh: () => set((state) => ({ autoRefresh: !state.autoRefresh })),
}));
