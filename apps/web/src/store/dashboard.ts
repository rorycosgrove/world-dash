import { create } from 'zustand';
import { Event, Alert } from '@/lib/api';

export type ViewMode = 'network' | 'map';
export type SortBy = 'time' | 'severity' | 'risk_score';
export type DateRange = '1h' | '6h' | '24h' | '7d' | '30d';

interface DashboardState {
  // Data
  events: Event[];
  alerts: Alert[];

  // Selection
  selectedEvent: Event | null;
  selectedEventId: string | null;
  drawerOpen: boolean;

  // Filters
  filterSeverity: string | null;
  filterCategory: string | null;
  searchQuery: string;
  sortBy: SortBy;
  dateRange: DateRange;

  // View controls
  viewMode: ViewMode;
  showDebugPanel: boolean;
  showAlertPanel: boolean;
  autoRefresh: boolean;

  // Counts
  unacknowledgedAlertCount: number;

  // Actions
  setEvents: (events: Event[]) => void;
  setAlerts: (alerts: Alert[]) => void;
  setSelectedEvent: (event: Event | null) => void;
  openDrawer: (eventId: string) => void;
  closeDrawer: () => void;
  setFilterSeverity: (severity: string | null) => void;
  setFilterCategory: (category: string | null) => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (sortBy: SortBy) => void;
  setDateRange: (range: DateRange) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleDebugPanel: () => void;
  toggleAlertPanel: () => void;
  toggleAutoRefresh: () => void;
  setUnacknowledgedAlertCount: (count: number) => void;
  clearAllFilters: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  // Data
  events: [],
  alerts: [],

  // Selection
  selectedEvent: null,
  selectedEventId: null,
  drawerOpen: false,

  // Filters
  filterSeverity: null,
  filterCategory: null,
  searchQuery: '',
  sortBy: 'time',
  dateRange: '24h',

  // View controls
  viewMode: 'network',
  showDebugPanel: false,
  showAlertPanel: true,
  autoRefresh: true,

  // Counts
  unacknowledgedAlertCount: 0,

  // Actions
  setEvents: (events) => set({ events }),
  setAlerts: (alerts) => set({ alerts }),
  setSelectedEvent: (event) => set({ selectedEvent: event }),
  openDrawer: (eventId) => set({ selectedEventId: eventId, drawerOpen: true }),
  closeDrawer: () => set({ selectedEventId: null, drawerOpen: false }),
  setFilterSeverity: (severity) => set({ filterSeverity: severity }),
  setFilterCategory: (category) => set({ filterCategory: category }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortBy: (sortBy) => set({ sortBy }),
  setDateRange: (range) => set({ dateRange: range }),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleDebugPanel: () => set((state) => ({ showDebugPanel: !state.showDebugPanel })),
  toggleAlertPanel: () => set((state) => ({ showAlertPanel: !state.showAlertPanel })),
  toggleAutoRefresh: () => set((state) => ({ autoRefresh: !state.autoRefresh })),
  setUnacknowledgedAlertCount: (count) => set({ unacknowledgedAlertCount: count }),
  clearAllFilters: () =>
    set({ filterSeverity: null, filterCategory: null, searchQuery: '', sortBy: 'time', dateRange: '24h' }),
}));
