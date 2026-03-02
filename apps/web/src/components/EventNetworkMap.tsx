'use client';

import { useMemo, useState, useEffect } from 'react';
import { useDashboardStore } from '@/store/dashboard';
import { Event, Source, api, EventContext } from '@/lib/api';

type NodeKind = 'event' | 'category' | 'theme' | 'actor' | 'location';
type MapMode = 'browse' | 'context' | 'relations';

interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  size: number;
  color: string;
  event?: Event;
  meta?: {
    significance?: string;
    isRelated?: boolean;
  };
}

interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  weight: number;
  color: string;
}

const KIND_COLORS: Record<NodeKind, string> = {
  event: '#8b5cf6',
  category: '#ef4444',
  theme: '#f59e0b',
  actor: '#06b6d4',
  location: '#10b981',
};

function significanceColor(sig: string): string {
  const colors: Record<string, string> = {
    critical: '#dc2626',
    high: '#f97316',
    medium: '#f59e0b',
    low: '#84cc16',
  };
  return colors[sig.toLowerCase()] || '#94a3b8';
}

export default function EventNetworkMap() {
  const { events, selectedEvent, setSelectedEvent } = useDashboardStore();
  const [sources, setSources] = useState<Source[]>([]);
  const [mapMode, setMapMode] = useState<MapMode>('browse');
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [contextData, setContextData] = useState<EventContext | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [focusLatestSource, setFocusLatestSource] = useState(true);

  useEffect(() => {
    const fetchSources = async () => {
      try {
        const data = await api.getSources({ limit: 300 });
        setSources(data);
      } catch (error) {
        console.error('Failed to fetch sources:', error);
      }
    };
    fetchSources();
    const interval = setInterval(fetchSources, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const update = () => {
      const width = Math.max(window.innerWidth - 700, 700);
      const height = Math.max(window.innerHeight - 220, 500);
      setSize({ width, height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // When event is selected, load its context
  useEffect(() => {
    if (selectedEvent && mapMode === 'context') {
      const loadContext = async () => {
        setIsLoadingContext(true);
        try {
          console.log(`Fetching context for event ${selectedEvent.id}`);
          const ctx = await api.analyzeEventContext(selectedEvent.id);
          console.log('Event context loaded:', ctx);
          setContextData(ctx);
        } catch (error: any) {
          console.error('Failed to load event context:', error?.message || error);
          console.error('Full error:', error);
          // Set fallback context data even on error
          if (selectedEvent) {
            setContextData({
              event_id: selectedEvent.id,
              categories: selectedEvent.tags.slice(0, 3) || ['Analysis'],
              actors: [],
              locations: selectedEvent.location?.country ? [selectedEvent.location.country] : ['Global'],
              themes: ['Geopolitical Intelligence'],
              significance: selectedEvent.severity || 'medium',
              related_event_ids: [],
            });
          }
        } finally {
          setIsLoadingContext(false);
        }
      };
      loadContext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.id, mapMode]);

  // NOTE: Removed auto-switch to context mode — user picks mode explicitly

  const latestSource = useMemo(() => {
    if (!sources.length) return null;
    return [...sources]
      .filter((s) => Boolean(s.last_polled_at))
      .sort((a, b) => new Date(b.last_polled_at || 0).getTime() - new Date(a.last_polled_at || 0).getTime())[0] || null;
  }, [sources]);

  const effectiveEvents = useMemo(() => {
    if (!focusLatestSource || !latestSource) return events;
    const scoped = events.filter((e) => e.source_id === latestSource.id);
    return scoped.length > 0 ? scoped : events;
  }, [events, focusLatestSource, latestSource]);

  const { nodes, edges, legendInfo } = useMemo(() => {
    const width = size.width;
    const height = size.height;
    const cx = width / 2;
    const cy = height / 2;

    // CONTEXT MODE: Show selected event + its context + related events
    if (mapMode === 'context' && selectedEvent && contextData) {
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // Central event node
      const eventNode: GraphNode = {
        id: `event:${selectedEvent.id}`,
        label: selectedEvent.title.slice(0, 40),
        kind: 'event',
        x: cx,
        y: cy,
        size: 40,
        color: significanceColor(contextData.significance),
        event: selectedEvent,
        meta: { significance: contextData.significance },
      };
      nodes.push(eventNode);

      // Category nodes (LLM-extracted semantic categories)
      const categoryRadius = Math.min(width, height) * 0.25;
      contextData.categories.forEach((cat, idx) => {
        const angle = (idx / Math.max(contextData.categories.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const node: GraphNode = {
          id: `category:${cat}`,
          label: cat,
          kind: 'category',
          x: cx + categoryRadius * Math.cos(angle),
          y: cy + categoryRadius * Math.sin(angle),
          size: 20,
          color: KIND_COLORS.category,
        };
        nodes.push(node);

        // Edge from event to category
        edges.push({
          id: `event->category:${cat}`,
          sourceId: eventNode.id,
          targetId: node.id,
          weight: 2,
          color: '#ef4444',
        });
      });

      // Theme nodes
      const themeRadius = Math.min(width, height) * 0.35;
      contextData.themes.forEach((theme, idx) => {
        const angle = (idx / Math.max(contextData.themes.length, 1)) * Math.PI * 2 - Math.PI / 2 + 0.5;
        const node: GraphNode = {
          id: `theme:${theme}`,
          label: theme,
          kind: 'theme',
          x: cx + themeRadius * Math.cos(angle),
          y: cy + themeRadius * Math.sin(angle),
          size: 18,
          color: KIND_COLORS.theme,
        };
        nodes.push(node);

        // Edge from event to theme
        edges.push({
          id: `event->theme:${theme}`,
          sourceId: eventNode.id,
          targetId: node.id,
          weight: 1.5,
          color: '#f59e0b',
        });
      });

      // Actor nodes
      const actorRadius = Math.min(width, height) * 0.3;
      contextData.actors.forEach((actor, idx) => {
        const angle = (idx / Math.max(contextData.actors.length, 1)) * Math.PI * 2 - Math.PI / 2 + 1.0;
        const node: GraphNode = {
          id: `actor:${actor}`,
          label: actor,
          kind: 'actor',
          x: cx + actorRadius * Math.cos(angle),
          y: cy + actorRadius * Math.sin(angle),
          size: 18,
          color: KIND_COLORS.actor,
        };
        nodes.push(node);

        // Edge from event to actor
        edges.push({
          id: `event->actor:${actor}`,
          sourceId: eventNode.id,
          targetId: node.id,
          weight: 2,
          color: '#06b6d4',
        });
      });

      // Location nodes
      const locRadius = Math.min(width, height) * 0.32;
      contextData.locations.forEach((loc, idx) => {
        const angle = (idx / Math.max(contextData.locations.length, 1)) * Math.PI * 2 - Math.PI / 2 - 1.0;
        const node: GraphNode = {
          id: `location:${loc}`,
          label: loc,
          kind: 'location',
          x: cx + locRadius * Math.cos(angle),
          y: cy + locRadius * Math.sin(angle),
          size: 18,
          color: KIND_COLORS.location,
        };
        nodes.push(node);

        // Edge from event to location
        edges.push({
          id: `event->location:${loc}`,
          sourceId: eventNode.id,
          targetId: node.id,
          weight: 1.5,
          color: '#10b981',
        });
      });

      // Related event nodes (outer ring)
      const relatedEvents = effectiveEvents.filter((e) => contextData.related_event_ids.includes(e.id));
      const outerRadius = Math.min(width, height) * 0.45;
      relatedEvents.forEach((relEvent, idx) => {
        const angle = (idx / Math.max(relatedEvents.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const node: GraphNode = {
          id: `event:${relEvent.id}`,
          label: relEvent.title.slice(0, 30),
          kind: 'event',
          x: cx + outerRadius * Math.cos(angle),
          y: cy + outerRadius * Math.sin(angle),
          size: 16,
          color: significanceColor(relEvent.llm_significance || relEvent.severity || 'medium'),
          event: relEvent,
          meta: { isRelated: true, significance: relEvent.llm_significance || relEvent.severity || 'medium' },
        };
        nodes.push(node);

        // Edge from central event to related event
        edges.push({
          id: `event:${selectedEvent.id}->event:${relEvent.id}`,
          sourceId: eventNode.id,
          targetId: node.id,
          weight: 1,
          color: '#8b5cf6',
        });
      });

      return {
        nodes,
        edges,
        legendInfo: {
          mode: 'context',
          selectedEvent: selectedEvent.title,
          categories: contextData.categories.length,
          themes: contextData.themes.length,
          actors: contextData.actors.length,
          locations: contextData.locations.length,
          related: relatedEvents.length,
        },
      };
    }

    // RELATIONS MODE: Show all event relationships based on semantic similarity
    if (mapMode === 'relations') {
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const maxEvents = Math.min(effectiveEvents.length, 30);

      // Arrange events in circular layout
      const radius = Math.min(width, height) * 0.35;
      effectiveEvents.slice(0, maxEvents).forEach((event, idx) => {
        const angle = (idx / maxEvents) * Math.PI * 2 - Math.PI / 2;
        const node: GraphNode = {
          id: `event:${event.id}`,
          label: event.title.slice(0, 35),
          kind: 'event',
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
          size: 18,
          color: significanceColor(event.llm_significance || event.severity || 'medium'),
          event,
        };
        nodes.push(node);

        // Edge between events if they share categories, actors, tags, or locations
        for (let j = idx + 1; j < maxEvents; j++) {
          const otherEvent = effectiveEvents[j];
          const sharedCategories = (event.categories || []).filter((c) =>
            (otherEvent.categories || []).includes(c)
          );
          const sharedActors = (event.actors || []).filter((a) =>
            (otherEvent.actors || []).includes(a)
          );
          const sharedTags = event.tags.filter((t) => otherEvent.tags.includes(t));
          const sameLocation = event.location?.country === otherEvent.location?.country;

          const weight =
            sharedCategories.length * 2 +
            sharedActors.length * 2 +
            sharedTags.length +
            (sameLocation ? 1 : 0);

          if (weight > 0) {
            edges.push({
              id: `${event.id}->${otherEvent.id}`,
              sourceId: `event:${event.id}`,
              targetId: `event:${otherEvent.id}`,
              weight,
              color: sharedCategories.length > 0 ? '#ef4444' : sharedActors.length > 0 ? '#06b6d4' : '#8b5cf6',
            });
          }
        }
      });

      return {
        nodes,
        edges,
        legendInfo: {
          mode: 'relations',
          totalEvents: effectiveEvents.length,
          displayed: maxEvents,
        },
      };
    }

    // BROWSE MODE: Simple event list visualization
    const nodes: GraphNode[] = effectiveEvents.map((event, idx) => {
      const angle = (idx / Math.max(effectiveEvents.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = Math.min(width, height) * 0.4;
      return {
        id: `event:${event.id}`,
        label: event.title.slice(0, 40),
        kind: 'event',
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        size: 16,
        color: significanceColor(event.llm_significance || event.severity || 'medium'),
        event,
      };
    });

    return {
      nodes,
      edges: [],
      legendInfo: {
        mode: 'browse',
        totalEvents: effectiveEvents.length,
      },
    };
  }, [size, mapMode, selectedEvent, contextData, effectiveEvents]);

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  return (
    <div className="h-full w-full bg-gray-950 border border-gray-800 rounded-lg relative overflow-hidden">
      <div className="absolute top-3 left-3 z-10">
        <h3 className="text-sm font-semibold text-gray-100">
          {mapMode === 'context' ? '🎯 Event Context' : mapMode === 'relations' ? '🔗 Event Relations' : '📊 Event Browser'}
        </h3>
        <p className="text-xs text-gray-400">
          {mapMode === 'context' && selectedEvent
            ? `Context: ${selectedEvent.title.slice(0, 40)}`
            : mapMode === 'relations'
              ? 'Semantic relationships between events'
              : 'All events by severity'}
        </p>

        {/* Mode selector */}
        <div className="mt-2 flex gap-1 text-xs">
          {(['browse', 'context', 'relations'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setMapMode(mode);
                if (mode === 'browse') setSelectedEvent(null);
              }}
              className={`px-2 py-1 rounded border transition-all ${
                mapMode === mode
                  ? 'bg-purple-600 border-purple-400 text-white'
                  : 'border-gray-600 text-gray-400 hover:border-gray-500'
              }`}
            >
              {mode === 'browse' ? '📊 Browse' : mode === 'context' ? '🎯 Context' : '🔗 Relations'}
            </button>
          ))}
        </div>

        {/* Source focus toggle */}
        {latestSource && (
          <div className="mt-2 text-xs">
            <label className="flex items-center gap-1 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={focusLatestSource}
                onChange={(e) => setFocusLatestSource(e.target.checked)}
              />
              Latest: {latestSource.name.slice(0, 20)}
            </label>
          </div>
        )}

        {/* Context loading indicator */}
        {mapMode === 'context' && isLoadingContext && (
          <div className="mt-2 flex items-center gap-2 text-xs text-yellow-400">
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="56" strokeDashoffset="14" />
            </svg>
            Analyzing context…
          </div>
        )}

        {mapMode === 'context' && !selectedEvent && !isLoadingContext && (
          <div className="mt-2 text-xs text-gray-500 italic">Select an event from the feed to see its context graph</div>
        )}

        {/* Context legend */}
        {mapMode === 'context' && contextData && (
          <div className="mt-2 text-xs space-y-0.5 text-gray-300">
            <div>🔴 Categories: {contextData.categories.join(', ').slice(0, 40)}</div>
            <div>🟠 Themes: {contextData.themes.join(', ').slice(0, 40)}</div>
            <div>🔵 Actors: {contextData.actors.join(', ').slice(0, 40)}</div>
            <div>🟢 Locations: {contextData.locations.join(', ').slice(0, 40)}</div>
            <div>Significance: <span className="font-bold">{contextData.significance.toUpperCase()}</span></div>
          </div>
        )}
      </div>

      {/* SVG Canvas */}
      <svg
        width={size.width}
        height={size.height}
        className="w-full h-full"
        onClick={(e) => {
          // Click on empty space to deselect
          if ((e.target as SVGElement).tagName === 'svg' || (e.target as SVGElement).tagName === 'rect') {
            setSelectedEvent(null);
            setContextData(null);
          }
        }}
      >
        {/* Background rect to catch clicks */}
        <rect width={size.width} height={size.height} fill="transparent" />
        {/* Edges */}
        {edges.map((edge) => {
          const source = nodeById.get(edge.sourceId);
          const target = nodeById.get(edge.targetId);
          if (!source || !target) return null;

          return (
            <line
              key={edge.id}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={edge.color}
              strokeWidth={Math.max(0.5, edge.weight * 0.5)}
              opacity={0.4}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => (
          <g
            key={node.id}
            onClick={() => {
              if (node.event) {
                setSelectedEvent(node.event);
              }
            }}
            className="cursor-pointer"
          >
            {/* Node circle */}
            <circle
              cx={node.x}
              cy={node.y}
              r={node.size}
              fill={node.color}
              opacity={node.id === `event:${selectedEvent?.id}` ? 1 : 0.8}
              className="transition-opacity hover:opacity-100"
            />

            {/* Selection ring */}
            {node.id === `event:${selectedEvent?.id}` && (
              <circle cx={node.x} cy={node.y} r={node.size + 4} fill="none" stroke="#fbbf24" strokeWidth={2} />
            )}

            {/* Label */}
            <text
              x={node.x}
              y={node.y + node.size + 12}
              textAnchor="middle"
              className="text-xs fill-gray-200 pointer-events-none"
              style={{
                fontSize: '10px',
                fontWeight: node.kind === 'event' ? 'bold' : 'normal',
              }}
            >
              {node.label.length > 15 ? node.label.slice(0, 15) + '...' : node.label}
            </text>
          </g>
        ))}
      </svg>

      {/* Event detail panel at bottom */}
      {selectedEvent && (
        <div className="absolute bottom-3 left-3 right-3 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-purple-300 truncate">{selectedEvent.title}</div>
              {selectedEvent.description && (
                <div className="text-gray-400 mt-1 line-clamp-2">{selectedEvent.description}</div>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                {(selectedEvent.llm_significance || selectedEvent.severity) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 capitalize">
                    {selectedEvent.llm_significance || selectedEvent.severity}
                  </span>
                )}
                {selectedEvent.location?.country && (
                  <span className="text-gray-500">📍 {selectedEvent.location.country}</span>
                )}
                {mapMode !== 'context' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMapMode('context');
                    }}
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    View context →
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedEvent(null);
                setContextData(null);
              }}
              className="text-gray-500 hover:text-gray-300 text-base leading-none flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
