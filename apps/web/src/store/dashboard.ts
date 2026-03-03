import { create } from 'zustand';
import { Event, Alert, ChartSpec } from '@/lib/api';

export type ViewMode = 'network' | 'map' | 'compare';
export type SortBy = 'time' | 'severity' | 'risk_score';
export type DateRange = '1h' | '6h' | '24h' | '7d' | '30d';
export type SwimlaneDimension = 'severity' | 'category' | 'actor' | 'theme' | 'location';
export type TimelineViewMode = 'density' | 'swimlane';
export type RightPanelMode = 'detail' | 'chat';

export interface InsightItem {
  id: string;
  type: 'alert' | 'trend' | 'cluster' | 'notable';
  title: string;
  description: string;
  severity?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface DashboardState {
  // Data
  events: Event[];
  alerts: Alert[];

  // Selection
  selectedEvent: Event | null;
  selectedEventId: string | null;
  drawerOpen: boolean;

  // Compare / Pin
  pinnedEventIds: Set<string>;
  compareMode: boolean;
  activeChartSpec: ChartSpec | null;

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

  // Timeline state
  timelineRange: { start: string; end: string } | null;
  swimlaneDimension: SwimlaneDimension;
  timelineViewMode: TimelineViewMode;
  timelineCollapsed: boolean;

  // Panel layout
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelMode: RightPanelMode;

  // Insight feed
  insightItems: InsightItem[];

  // Counts
  unacknowledgedAlertCount: number;

  // Actions
  setEvents: (events: Event[]) => void;
  setAlerts: (alerts: Alert[]) => void;
  setSelectedEvent: (event: Event | null) => void;
  openDrawer: (eventId: string) => void;
  closeDrawer: () => void;
  togglePinEvent: (id: string) => void;
  pinEvents: (ids: string[]) => void;
  clearPins: () => void;
  setCompareMode: (on: boolean) => void;
  setActiveChartSpec: (spec: ChartSpec | null) => void;
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
  // Timeline actions
  setTimelineRange: (range: { start: string; end: string } | null) => void;
  setSwimlaneDimension: (dim: SwimlaneDimension) => void;
  setTimelineViewMode: (mode: TimelineViewMode) => void;
  toggleTimelineCollapsed: () => void;
  // Panel actions
  toggleLeftPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelMode: (mode: RightPanelMode) => void;
  openRightPanel: (mode: RightPanelMode) => void;
  closeRightPanel: () => void;
  // Insight actions
  setInsightItems: (items: InsightItem[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  // Data
  events: [],
  alerts: [],

  // Selection
  selectedEvent: null,
  selectedEventId: null,
  drawerOpen: false,

  // Compare / Pin
  pinnedEventIds: new Set<string>(),
  compareMode: false,
  activeChartSpec: null,

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

  // Timeline state
  timelineRange: null,
  swimlaneDimension: 'severity',
  timelineViewMode: 'density',
  timelineCollapsed: false,

  // Panel layout
  leftPanelOpen: true,
  rightPanelOpen: false,
  rightPanelMode: 'detail',

  // Insight feed
  insightItems: [],

  // Counts
  unacknowledgedAlertCount: 0,

  // Actions
  setEvents: (events) => set({ events }),
  setAlerts: (alerts) => set({ alerts }),
  setSelectedEvent: (event) => set({ selectedEvent: event }),
  openDrawer: (eventId) => set({ selectedEventId: eventId, drawerOpen: true, rightPanelOpen: true, rightPanelMode: 'detail' }),
  closeDrawer: () => set({ selectedEventId: null, drawerOpen: false }),

  togglePinEvent: (id) =>
    set((state) => {
      const next = new Set(state.pinnedEventIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const compareMode = next.size >= 2 ? state.compareMode : false;
      return { pinnedEventIds: next, compareMode };
    }),
  pinEvents: (ids) =>
    set((state) => {
      const next = new Set(state.pinnedEventIds);
      ids.forEach((id) => next.add(id));
      return { pinnedEventIds: next };
    }),
  clearPins: () => set({ pinnedEventIds: new Set<string>(), compareMode: false, activeChartSpec: null }),
  setCompareMode: (on) => set({ compareMode: on }),
  setActiveChartSpec: (spec) => set({ activeChartSpec: spec }),

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
    set({ filterSeverity: null, filterCategory: null, searchQuery: '', sortBy: 'time', dateRange: '24h', timelineRange: null }),

  // Timeline actions
  setTimelineRange: (range) => set({ timelineRange: range }),
  setSwimlaneDimension: (dim) => set({ swimlaneDimension: dim }),
  setTimelineViewMode: (mode) => set({ timelineViewMode: mode }),
  toggleTimelineCollapsed: () => set((state) => ({ timelineCollapsed: !state.timelineCollapsed })),

  // Panel actions
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
  openRightPanel: (mode) => set({ rightPanelOpen: true, rightPanelMode: mode }),
  closeRightPanel: () => set({ rightPanelOpen: false }),

  // Insight actions
  setInsightItems: (items) => set({ insightItems: items }),
}));
