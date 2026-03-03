'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useDashboardStore } from '@/store/dashboard';
import { Event, api, EventContext } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type NodeKind = 'event' | 'category' | 'theme' | 'actor' | 'location' | 'hub';
type ViewMode = 'overview' | 'context' | 'compare';
type GroupBy = 'category' | 'actor' | 'theme' | 'location' | 'significance';

interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  size: number;
  color: string;
  event?: Event;
  hubCount?: number;
  meta?: Record<string, any>;
}

interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  weight: number;
  color: string;
  dashed?: boolean;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const KIND_COLORS: Record<NodeKind, string> = {
  event: '#8b5cf6',
  category: '#ef4444',
  theme: '#f59e0b',
  actor: '#06b6d4',
  location: '#10b981',
  hub: '#a78bfa',
};

const GROUP_CONFIGS: Record<GroupBy, { label: string; icon: string; color: string; nodeKind: NodeKind }> = {
  category:     { label: 'Category',     icon: '🔴', color: '#ef4444', nodeKind: 'category' },
  actor:        { label: 'Actor',        icon: '🔵', color: '#06b6d4', nodeKind: 'actor' },
  theme:        { label: 'Theme',        icon: '🟠', color: '#f59e0b', nodeKind: 'theme' },
  location:     { label: 'Location',     icon: '🟢', color: '#10b981', nodeKind: 'location' },
  significance: { label: 'Significance', icon: '⚡', color: '#a78bfa', nodeKind: 'hub' },
};

function sigColor(sig: string): string {
  const s = sig?.toLowerCase() || '';
  if (s === 'critical') return '#dc2626';
  if (s === 'high') return '#f97316';
  if (s === 'medium') return '#f59e0b';
  if (s === 'low') return '#84cc16';
  return '#94a3b8';
}

function getGroupValues(event: Event, groupBy: GroupBy): string[] {
  switch (groupBy) {
    case 'category': return event.categories?.length ? event.categories : [];
    case 'actor': return event.actors?.length ? event.actors : [];
    case 'theme': return event.themes?.length ? event.themes : [];
    case 'location': return event.location?.country ? [event.location.country] : [];
    case 'significance': return [event.llm_significance || event.severity || 'medium'];
    default: return [];
  }
}

function zoomBy(t: Transform, factor: number, sz: { width: number; height: number }): Transform {
  const newK = Math.max(0.25, Math.min(5, t.k * factor));
  const r = newK / t.k;
  const cx = sz.width / 2;
  const cy = sz.height / 2;
  return { x: cx - (cx - t.x) * r, y: cy - (cy - t.y) * r, k: newK };
}

// ---------------------------------------------------------------------------
// Force-directed simulation (runs after initial radial layout)
// ---------------------------------------------------------------------------

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  pinned?: boolean; // hub nodes can be pinned to reduce jitter
}

function runForceSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  iterations: number = 60,
  options: {
    repulsion?: number;
    attraction?: number;
    damping?: number;
    labelPadding?: number;
    centerGravity?: number;
    bounds?: { width: number; height: number };
  } = {}
): GraphNode[] {
  if (nodes.length <= 1) return nodes;

  const {
    repulsion = 3000,
    attraction = 0.005,
    damping = 0.85,
    labelPadding = 18,
    centerGravity = 0.01,
    bounds,
  } = options;

  const cx = bounds ? bounds.width / 2 : 0;
  const cy = bounds ? bounds.height / 2 : 0;

  // Build edge lookup
  const edgeMap = new Map<string, Set<string>>();
  edges.forEach(e => {
    if (!edgeMap.has(e.sourceId)) edgeMap.set(e.sourceId, new Set());
    if (!edgeMap.has(e.targetId)) edgeMap.set(e.targetId, new Set());
    edgeMap.get(e.sourceId)!.add(e.targetId);
    edgeMap.get(e.targetId)!.add(e.sourceId);
  });

  // Initialize simulation nodes
  const simNodes: SimNode[] = nodes.map(n => ({
    id: n.id,
    x: n.x,
    y: n.y,
    vx: 0,
    vy: 0,
    size: n.size,
    pinned: false,
  }));

  const idxMap = new Map<string, number>();
  simNodes.forEach((n, i) => idxMap.set(n.id, i));

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations; // cooling factor

    // Repulsion between all node pairs (Barnes-Hut would be better for >200 nodes)
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = a.size + b.size + labelPadding;

        // Strong repulsion when overlapping, normal repulsion otherwise
        let force: number;
        if (dist < minDist) {
          force = (repulsion * 2) / (dist * dist + 1);
        } else {
          force = repulsion / (dist * dist + 1);
        }

        const fx = (dx / dist) * force * temp;
        const fy = (dy / dist) * force * temp;

        if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
        if (!b.pinned) { b.vx += fx; b.vy += fy; }
      }
    }

    // Attraction along edges
    edges.forEach(edge => {
      const si = idxMap.get(edge.sourceId);
      const ti = idxMap.get(edge.targetId);
      if (si === undefined || ti === undefined) return;

      const a = simNodes[si];
      const b = simNodes[ti];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const force = dist * attraction * edge.weight * temp;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!a.pinned) { a.vx += fx; a.vy += fy; }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
    });

    // Center gravity
    if (bounds) {
      simNodes.forEach(n => {
        if (n.pinned) return;
        n.vx += (cx - n.x) * centerGravity * temp;
        n.vy += (cy - n.y) * centerGravity * temp;
      });
    }

    // Apply velocities with damping
    simNodes.forEach(n => {
      if (n.pinned) return;
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;

      // Keep within bounds
      if (bounds) {
        const pad = 40;
        n.x = Math.max(pad, Math.min(bounds.width - pad, n.x));
        n.y = Math.max(pad, Math.min(bounds.height - pad, n.y));
      }
    });
  }

  // Map simulated positions back to GraphNode objects
  return nodes.map(n => {
    const idx = idxMap.get(n.id);
    if (idx === undefined) return n;
    const sim = simNodes[idx];
    return { ...n, x: sim.x, y: sim.y };
  });
}

// Label collision avoidance (post-process)
function resolveLabels(
  nodes: GraphNode[],
  maxIter: number = 20,
): GraphNode[] {
  if (nodes.length <= 1) return nodes;

  // Label bounding boxes (approximate)
  interface LabelBox {
    idx: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const charWidth = 5.5; // approximate px per char at ~10px font
  const lineHeight = 14;

  const boxes: LabelBox[] = nodes.map((n, i) => {
    const labelLen = Math.min(n.label.length, 22);
    const w = labelLen * charWidth;
    const h = lineHeight;
    return {
      idx: i,
      x: n.x - w / 2,
      y: n.y + n.size + 4,
      w,
      h,
    };
  });

  // Iterative repulsion to resolve overlaps
  for (let iter = 0; iter < maxIter; iter++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];

        // Check overlap
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

        if (overlapX > 0 && overlapY > 0) {
          // Push apart in the direction of least overlap
          const pushX = overlapX / 2 + 2;
          const pushY = overlapY / 2 + 1;

          if (overlapX < overlapY) {
            if (a.x < b.x) { a.x -= pushX; b.x += pushX; }
            else { a.x += pushX; b.x -= pushX; }
          } else {
            if (a.y < b.y) { a.y -= pushY; b.y += pushY; }
            else { a.y += pushY; b.y -= pushY; }
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // Apply adjusted label positions as metadata (we'll store label offsets)
  return nodes.map((n, i) => {
    const box = boxes[i];
    // Compute label offset relative to default position
    const defaultLabelX = n.x;
    const defaultLabelY = n.y + n.size + 4 + lineHeight / 2;
    const labelX = box.x + box.w / 2;
    const labelY = box.y + box.h / 2;

    return {
      ...n,
      meta: {
        ...n.meta,
        labelOffsetX: labelX - defaultLabelX,
        labelOffsetY: labelY - defaultLabelY,
      },
    };
  });
}

// Hard overlap resolution — guarantees no node circles overlap
function resolveOverlaps(
  nodes: GraphNode[],
  padding: number = 6,
  maxIter: number = 80,
): GraphNode[] {
  if (nodes.length <= 1) return nodes;

  const pos = nodes.map(n => ({ x: n.x, y: n.y, r: n.size + padding }));

  for (let iter = 0; iter < maxIter; iter++) {
    let maxOverlap = 0;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i];
        const b = pos[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = a.r + b.r;
        if (dist < minDist) {
          const overlap = minDist - dist;
          maxOverlap = Math.max(maxOverlap, overlap);
          const nx = dx / dist;
          const ny = dy / dist;
          const push = overlap / 2 + 0.5;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
    if (maxOverlap < 0.5) break;
  }

  return nodes.map((n, i) => ({ ...n, x: pos[i].x, y: pos[i].y }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function EventNetworkMap() {
  const { events, selectedEvent, setSelectedEvent, pinnedEventIds, togglePinEvent, clearPins, compareMode, setCompareMode, timelineRange } = useDashboardStore();

  // Filter events by timeline range
  const filteredEvents = useMemo(() => {
    if (!timelineRange) return events;
    const s = new Date(timelineRange.start).getTime();
    const e = new Date(timelineRange.end).getTime();
    return events.filter((ev) => {
      const t = new Date(ev.published_at).getTime();
      return t >= s && t <= e;
    });
  }, [events, timelineRange]);

  // --- View state ---
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const [contextData, setContextData] = useState<EventContext | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);

  // --- Canvas state ---
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // --- Interaction state ---
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const didPan = useRef(false);

  // --- Multi-select (from global store) ---
  const pinnedIds = pinnedEventIds;

  // --- Hover ---
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // --- Drag state ---
  const dragStartRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const dragOverrides = useRef<Map<string, { x: number; y: number }>>(new Map());

  // --- Expanded subgroups ---
  const [expandedHubs, setExpandedHubs] = useState<Set<string>>(new Set());

  // --- Animation refs (declared early so drag handler can access) ---
  const animPositions = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const [, triggerRender] = useState(0);

  // ===================================================================
  // EFFECTS
  // ===================================================================

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset transform on mode / groupBy change
  useEffect(() => {
    setTransform({ x: 0, y: 0, k: 1 });
    setExpandedHubs(new Set());
    dragOverrides.current.clear();
  }, [viewMode, groupBy]);

  // Auto-switch out of compare mode when pins are cleared
  useEffect(() => {
    if (viewMode === 'compare' && pinnedIds.size === 0) setViewMode('overview');
  }, [pinnedIds.size, viewMode]);

  // Sync local viewMode with store compareMode
  useEffect(() => {
    if (compareMode && pinnedIds.size >= 2) {
      setSelectedEvent(null);
      setContextData(null);
      setViewMode('compare');
    }
  }, [compareMode, pinnedIds.size, setSelectedEvent]);

  // Build local context helper
  const buildLocalContext = useCallback((event: Event): EventContext => {
    const cats = event.categories?.length ? event.categories : event.tags?.slice(0, 3) || ['Analysis'];
    const actors = event.actors?.length ? event.actors : [];
    const themes = event.themes?.length ? event.themes : ['Geopolitical Intelligence'];
    const locations = event.location?.country ? [event.location.country] : ['Global'];
    const significance = event.llm_significance || event.severity || 'medium';
    const related = events
      .filter((e: Event) => {
        if (e.id === event.id) return false;
        return (e.categories || []).some((c: string) => cats.includes(c))
            || (e.actors || []).some((a: string) => actors.includes(a));
      })
      .slice(0, 10)
      .map((e: Event) => e.id);
    return { event_id: event.id, categories: cats, actors, locations, themes, significance, related_event_ids: related };
  }, [events]);

  // Auto-context on single select
  useEffect(() => {
    if (!selectedEvent) {
      setContextData(null);
      if (viewMode === 'context') setViewMode(pinnedIds.size >= 2 ? 'compare' : 'overview');
      return;
    }
    // Don't exit compare mode when clicking an event — only show context if not comparing
    if (viewMode !== 'compare') setViewMode('context');
    const hasLLM = Boolean(selectedEvent.categories?.length || selectedEvent.actors?.length || selectedEvent.themes?.length);
    if (hasLLM) {
      setContextData(buildLocalContext(selectedEvent));
      return;
    }
    (async () => {
      setIsLoadingContext(true);
      try {
        const ctx = await api.analyzeEventContext(selectedEvent.id);
        setContextData(ctx);
      } catch {
        setContextData(buildLocalContext(selectedEvent));
      } finally {
        setIsLoadingContext(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent?.id]);

  // Refresh context live when events update
  useEffect(() => {
    if (!selectedEvent || viewMode !== 'context') return;
    const fresh = events.find((e: Event) => e.id === selectedEvent.id);
    if (fresh && (fresh.categories?.length || fresh.actors?.length || fresh.themes?.length)) {
      setContextData(buildLocalContext(fresh));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // ===================================================================
  // INTERACTION HANDLERS
  // ===================================================================

  // Zoom (wheel) — needs native event for passive:false
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setTransform(prev => {
      const newK = Math.max(0.25, Math.min(5, prev.k * factor));
      const r = newK / prev.k;
      return { x: mx - (mx - prev.x) * r, y: my - (my - prev.y) * r, k: newK };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Pan — mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const tag = (e.target as SVGElement).tagName;
    if (tag !== 'svg' && tag !== 'rect') return;
    setIsPanning(true);
    didPan.current = false;
    const t = transformRef.current;
    panStart.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
  }, []);

  // Node drag start — called from node <g> onMouseDown
  const handleNodeDragStart = useCallback((e: React.MouseEvent, nodeId: string, nodeX: number, nodeY: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const t = transformRef.current;
    const graphX = (e.clientX - rect.left - t.x) / t.k;
    const graphY = (e.clientY - rect.top - t.y) / t.k;
    dragStartRef.current = { nodeId, offsetX: nodeX - graphX, offsetY: nodeY - graphY };
    didPan.current = false;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Handle node drag
    if (dragStartRef.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const t = transformRef.current;
      const graphX = (e.clientX - rect.left - t.x) / t.k;
      const graphY = (e.clientY - rect.top - t.y) / t.k;
      const newX = graphX + dragStartRef.current.offsetX;
      const newY = graphY + dragStartRef.current.offsetY;

      // Update animated position directly for instant response
      const state = animPositions.current.get(dragStartRef.current.nodeId);
      if (state) {
        state.x = newX;
        state.y = newY;
        state.vx = 0;
        state.vy = 0;
      }
      // Store override so animation doesn't snap back
      dragOverrides.current.set(dragStartRef.current.nodeId, { x: newX, y: newY });
      didPan.current = true;
      triggerRender((c: number) => c + 1);
      return;
    }

    // Handle canvas pan
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan.current = true;
    setTransform(prev => ({ ...prev, x: panStart.current.tx + dx, y: panStart.current.ty + dy }));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    if (dragStartRef.current) {
      dragStartRef.current = null;
    }
    setIsPanning(false);
  }, []);

  const togglePin = useCallback((eventId: string) => {
    togglePinEvent(eventId);
  }, [togglePinEvent]);

  const fitToContent = useCallback((nodeList: GraphNode[]) => {
    if (nodeList.length === 0) { setTransform({ x: 0, y: 0, k: 1 }); return; }
    const pad = 60;
    const xs = nodeList.map(n => n.x);
    const ys = nodeList.map(n => n.y);
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const cw = maxX - minX;
    const ch = maxY - minY;
    const k = Math.min(size.width / cw, size.height / ch, 2);
    const x = (size.width - cw * k) / 2 - minX * k;
    const y = (size.height - ch * k) / 2 - minY * k;
    setTransform({ x, y, k });
  }, [size]);

  // ===================================================================
  // GRAPH COMPUTATION
  // ===================================================================
  const { nodes, edges } = useMemo(() => {
    const W = size.width;
    const H = size.height;
    const cx = W / 2;
    const cy = H / 2;

    // ========== CONTEXT MODE (single event) ==========
    if (viewMode === 'context' && selectedEvent && contextData) {
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      nodes.push({
        id: `event:${selectedEvent.id}`, label: selectedEvent.title.slice(0, 40), kind: 'event',
        x: cx, y: cy, size: 36, color: sigColor(contextData.significance),
        event: selectedEvent, meta: { significance: contextData.significance },
      });

      const rings: { items: string[]; kind: NodeKind; radius: number; off: number }[] = [
        { items: contextData.categories, kind: 'category', radius: 0.25, off: 0 },
        { items: contextData.themes,     kind: 'theme',    radius: 0.32, off: 0.5 },
        { items: contextData.actors,     kind: 'actor',    radius: 0.30, off: 1.0 },
        { items: contextData.locations,  kind: 'location', radius: 0.30, off: -1.0 },
      ];

      rings.forEach(({ items, kind, radius, off }) => {
        const r = Math.min(W, H) * radius;
        items.forEach((item: string, idx: number) => {
          const a = (idx / Math.max(items.length, 1)) * Math.PI * 2 - Math.PI / 2 + off;
          const nid = `${kind}:${item}`;
          nodes.push({ id: nid, label: item, kind, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), size: 18, color: KIND_COLORS[kind] });
          edges.push({ id: `e->${nid}`, sourceId: `event:${selectedEvent.id}`, targetId: nid, weight: 2, color: KIND_COLORS[kind] });
        });
      });

      // Related events
      const relEv = events.filter((e: Event) => contextData.related_event_ids.includes(e.id));
      const outerR = Math.min(W, H) * 0.45;
      relEv.forEach((re: Event, i: number) => {
        const a = (i / Math.max(relEv.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const nid = `event:${re.id}`;
        nodes.push({ id: nid, label: re.title.slice(0, 30), kind: 'event', x: cx + outerR * Math.cos(a), y: cy + outerR * Math.sin(a), size: 14, color: sigColor(re.llm_significance || re.severity || 'medium'), event: re, meta: { isRelated: true } });
        edges.push({ id: `rel:${re.id}`, sourceId: `event:${selectedEvent.id}`, targetId: nid, weight: 1, color: '#8b5cf6' });
      });

      return { nodes, edges };
    }

    // ========== COMPARE MODE (multiple pinned events) ==========
    if (viewMode === 'compare' && pinnedIds.size > 0) {
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const pinned = events.filter((e: Event) => pinnedIds.has(e.id));
      if (pinned.length === 0) return { nodes: [], edges: [] };

      // Collect attributes
      const attrs = new Map<string, { kind: NodeKind; label: string; eids: Set<string> }>();
      pinned.forEach((ev: Event) => {
        (ev.categories || []).forEach((c: string) => {
          const k = `category:${c}`;
          if (!attrs.has(k)) attrs.set(k, { kind: 'category', label: c, eids: new Set() });
          attrs.get(k)!.eids.add(ev.id);
        });
        (ev.actors || []).forEach((a: string) => {
          const k = `actor:${a}`;
          if (!attrs.has(k)) attrs.set(k, { kind: 'actor', label: a, eids: new Set() });
          attrs.get(k)!.eids.add(ev.id);
        });
        (ev.themes || []).forEach((t: string) => {
          const k = `theme:${t}`;
          if (!attrs.has(k)) attrs.set(k, { kind: 'theme', label: t, eids: new Set() });
          attrs.get(k)!.eids.add(ev.id);
        });
        if (ev.location?.country) {
          const k = `location:${ev.location.country}`;
          if (!attrs.has(k)) attrs.set(k, { kind: 'location', label: ev.location.country!, eids: new Set() });
          attrs.get(k)!.eids.add(ev.id);
        }
      });

      // Place pinned events in inner ring
      const innerR = Math.min(W, H) * (pinned.length > 1 ? 0.15 : 0);
      pinned.forEach((ev: Event, i: number) => {
        const a = (i / pinned.length) * Math.PI * 2 - Math.PI / 2;
        nodes.push({
          id: `event:${ev.id}`, label: ev.title.slice(0, 35), kind: 'event',
          x: cx + innerR * Math.cos(a), y: cy + innerR * Math.sin(a),
          size: 26, color: sigColor(ev.llm_significance || ev.severity || 'medium'), event: ev,
        });
      });

      // Sort: shared attrs first, then by kind
      const sorted = [...attrs.entries()].sort((a, b) => {
        const diff = b[1].eids.size - a[1].eids.size;
        return diff !== 0 ? diff : a[1].kind.localeCompare(b[1].kind);
      });

      // Place attribute nodes in outer ring
      const outerR = Math.min(W, H) * 0.38;
      sorted.forEach(([key, { kind, label, eids }], i) => {
        const a = (i / Math.max(sorted.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const shared = eids.size > 1;
        nodes.push({
          id: key, label, kind,
          x: cx + outerR * Math.cos(a), y: cy + outerR * Math.sin(a),
          size: shared ? 16 : 10, color: KIND_COLORS[kind],
          hubCount: shared ? eids.size : undefined,
          meta: { shared, connectedEvents: [...eids] },
        });
        eids.forEach((eid: string) => {
          edges.push({
            id: `event:${eid}->${key}`, sourceId: `event:${eid}`, targetId: key,
            weight: shared ? 2 : 1, color: KIND_COLORS[kind],
          });
        });
      });

      // Cross-edges between pinned events that share attributes
      for (let i = 0; i < pinned.length; i++) {
        for (let j = i + 1; j < pinned.length; j++) {
          const ea = pinned[i];
          const eb = pinned[j];
          const sc = (ea.categories || []).filter((c: string) => (eb.categories || []).includes(c)).length;
          const sa = (ea.actors || []).filter((a: string) => (eb.actors || []).includes(a)).length;
          const st = (ea.themes || []).filter((t: string) => (eb.themes || []).includes(t)).length;
          const total = sc + sa + st;
          if (total > 0) {
            edges.push({
              id: `cross:${ea.id}->${eb.id}`, sourceId: `event:${ea.id}`, targetId: `event:${eb.id}`,
              weight: total, color: '#a78bfa', dashed: true,
            });
          }
        }
      }

      return { nodes, edges };
    }

    // ========== OVERVIEW MODE (grouped) ==========
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const cfg = GROUP_CONFIGS[groupBy];

    const groups = new Map<string, Event[]>();
    const ungrouped: Event[] = [];
    filteredEvents.forEach((event: Event) => {
      const vals = getGroupValues(event, groupBy);
      if (vals.length === 0) ungrouped.push(event);
      else vals.forEach((v: string) => {
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v)!.push(event);
      });
    });

    const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12);
    const displayedKeys = new Set(sortedGroups.map(([k]) => k));
    const overflow: Event[] = [];
    groups.forEach((evts, key) => {
      if (!displayedKeys.has(key)) evts.forEach(e => { if (!overflow.some(o => o.id === e.id)) overflow.push(e); });
    });

    const hubR = Math.min(W, H) * 0.30;
    const total = sortedGroups.length + (ungrouped.length + overflow.length > 0 ? 1 : 0);

    sortedGroups.forEach(([gv, gEvts], gi) => {
      const ha = (gi / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
      const hx = cx + hubR * Math.cos(ha);
      const hy = cy + hubR * Math.sin(ha);
      const hid = `hub:${gv}`;

      nodes.push({
        id: hid, label: gv, kind: cfg.nodeKind, x: hx, y: hy,
        size: Math.min(30, 14 + gEvts.length * 1.2),
        color: groupBy === 'significance' ? sigColor(gv) : cfg.color,
        hubCount: gEvts.length,
      });

      const isExpanded = expandedHubs.has(gv);
      const maxS = isExpanded ? Math.min(gEvts.length, 30) : Math.min(gEvts.length, 8);
      const eR = Math.min(W, H) * (isExpanded ? 0.20 : 0.12) + maxS * 2;
      gEvts.slice(0, maxS).forEach((ev: Event, ei: number) => {
        const ea = (ei / Math.max(maxS, 1)) * Math.PI * 2 - Math.PI / 2;
        const eid = `event:${ev.id}`;
        if (!nodes.some(n => n.id === eid)) {
          nodes.push({
            id: eid, label: ev.title.slice(0, 25), kind: 'event',
            x: hx + eR * Math.cos(ea), y: hy + eR * Math.sin(ea), size: 10,
            color: sigColor(ev.llm_significance || ev.severity || 'medium'), event: ev,
          });
        }
        edges.push({ id: `${hid}->${eid}`, sourceId: hid, targetId: eid, weight: 1.5, color: groupBy === 'significance' ? sigColor(gv) : cfg.color });
      });
    });

    // Ungrouped / overflow
    const allUng = [...ungrouped, ...overflow];
    const seen = new Set(nodes.filter(n => n.kind === 'event').map(n => n.id));
    const uniq = allUng.filter(e => !seen.has(`event:${e.id}`));
    if (uniq.length > 0) {
      const ha = (sortedGroups.length / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
      const hx = cx + hubR * Math.cos(ha);
      const hy = cy + hubR * Math.sin(ha);
      nodes.push({ id: 'hub:other', label: 'Other', kind: 'hub', x: hx, y: hy, size: 16, color: '#64748b', hubCount: uniq.length });
      const eR = Math.min(W, H) * 0.10;
      uniq.slice(0, 6).forEach((ev: Event, i: number) => {
        const ea = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const eid = `event:${ev.id}`;
        if (!nodes.some(n => n.id === eid)) {
          nodes.push({ id: eid, label: ev.title.slice(0, 25), kind: 'event', x: hx + eR * Math.cos(ea), y: hy + eR * Math.sin(ea), size: 9, color: '#94a3b8', event: ev });
        }
        edges.push({ id: `hub:other->${eid}`, sourceId: 'hub:other', targetId: eid, weight: 1, color: '#64748b' });
      });
    }

    // Cross-hub edges
    for (let i = 0; i < sortedGroups.length; i++) {
      for (let j = i + 1; j < sortedGroups.length; j++) {
        const idsA = new Set(sortedGroups[i][1].map((e: Event) => e.id));
        const shared = sortedGroups[j][1].filter((e: Event) => idsA.has(e.id)).length;
        if (shared > 0) {
          edges.push({
            id: `cross:${sortedGroups[i][0]}->${sortedGroups[j][0]}`,
            sourceId: `hub:${sortedGroups[i][0]}`, targetId: `hub:${sortedGroups[j][0]}`,
            weight: shared, color: '#6366f180',
          });
        }
      }
    }

    return { nodes, edges };
  }, [size, viewMode, groupBy, selectedEvent, contextData, filteredEvents, events, pinnedIds, expandedHubs]);

  // ===================================================================
  // FORCE SIMULATION + LABEL COLLISION RESOLUTION
  // ===================================================================
  const { simulatedNodes, simulatedEdges } = useMemo(() => {
    if (nodes.length === 0) return { simulatedNodes: nodes, simulatedEdges: edges };

    // Force-directed simulation with stronger repulsion to separate nodes
    let processed = runForceSimulation(nodes, edges, 90, {
      repulsion: nodes.length > 30 ? 5500 : 3500,
      attraction: 0.005,
      damping: 0.82,
      labelPadding: 22,
      centerGravity: 0.012,
      bounds: size,
    });

    // Hard constraint: guarantee no circle overlap
    processed = resolveOverlaps(processed, 6, 80);

    // Resolve label overlaps
    processed = resolveLabels(processed, 15);

    return { simulatedNodes: processed, simulatedEdges: edges };
  }, [nodes, edges, size]);

  // ===================================================================
  // ELASTIC SPRING ANIMATION
  // ===================================================================
  const animFrameRef = useRef<number>(0);
  const targetNodesRef = useRef(simulatedNodes);
  targetNodesRef.current = simulatedNodes;

  useEffect(() => {
    const targets = simulatedNodes;
    if (targets.length === 0) {
      animPositions.current.clear();
      return;
    }

    const state = animPositions.current;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const currentIds = new Set(targets.map((n: GraphNode) => n.id));

    // Initialise new nodes: spawn from centre for a "bloom" effect
    targets.forEach((node: GraphNode) => {
      if (!state.has(node.id)) {
        state.set(node.id, { x: cx, y: cy, vx: 0, vy: 0 });
      }
    });

    // Remove stale node state
    state.forEach((_: any, id: string) => {
      if (!currentIds.has(id)) state.delete(id);
    });

    let active = true;
    const STIFFNESS = 0.09;
    const FRICTION = 0.72;

    const step = () => {
      if (!active) return;
      const tgt = targetNodesRef.current;
      let settled = true;

      tgt.forEach((node: GraphNode) => {
        const s = state.get(node.id);
        if (!s) return;

        // Skip nodes being actively dragged – position set directly by handler
        if (dragStartRef.current?.nodeId === node.id) return;

        // Use drag override position as target if user has repositioned this node
        const override = dragOverrides.current.get(node.id);
        const tx = override ? override.x : node.x;
        const ty = override ? override.y : node.y;

        const dx = tx - s.x;
        const dy = ty - s.y;
        s.vx = (s.vx + dx * STIFFNESS) * FRICTION;
        s.vy = (s.vy + dy * STIFFNESS) * FRICTION;
        s.x += s.vx;
        s.y += s.vy;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3 || Math.abs(s.vx) > 0.05 || Math.abs(s.vy) > 0.05) {
          settled = false;
        }
      });

      // Snap to exact positions once motion stops
      if (settled) {
        tgt.forEach((node: GraphNode) => {
          const s = state.get(node.id);
          if (!s) return;
          const override = dragOverrides.current.get(node.id);
          s.x = override ? override.x : node.x;
          s.y = override ? override.y : node.y;
          s.vx = 0; s.vy = 0;
        });
      }

      triggerRender((c: number) => c + 1);

      if (!settled) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };

    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(step);

    return () => {
      active = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulatedNodes]);

  // Build display nodes from animated positions
  const displayNodes = (() => {
    const state = animPositions.current;
    if (state.size === 0) return simulatedNodes;
    return simulatedNodes.map((node: GraphNode) => {
      const s = state.get(node.id);
      return s ? { ...node, x: s.x, y: s.y } : node;
    });
  })();

  // ===================================================================
  // DERIVED
  // ===================================================================
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    displayNodes.forEach((n: GraphNode) => m.set(n.id, n));
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayNodes]);

  const hoveredNode = hoveredNodeId ? nodeById.get(hoveredNodeId) ?? null : null;

  // Highlight connected nodes/edges on hover
  const { connectedNodeIds, highlightedEdgeIds } = useMemo(() => {
    if (!hoveredNodeId) return { connectedNodeIds: null as Set<string> | null, highlightedEdgeIds: null as Set<string> | null };
    const nids = new Set<string>([hoveredNodeId]);
    const eids = new Set<string>();
    simulatedEdges.forEach((e: GraphEdge) => {
      if (e.sourceId === hoveredNodeId || e.targetId === hoveredNodeId) {
        eids.add(e.id);
        nids.add(e.sourceId);
        nids.add(e.targetId);
      }
    });
    return { connectedNodeIds: nids, highlightedEdgeIds: eids };
  }, [hoveredNodeId, simulatedEdges]);

  const cfg = GROUP_CONFIGS[groupBy];

  // ===================================================================
  // RENDER
  // ===================================================================
  return (
    <div ref={containerRef} className="h-full w-full bg-gray-950 border border-gray-800 rounded-lg relative overflow-hidden select-none">

      {/* ---- CONTROL PANEL ---- */}
      <div className="absolute top-3 left-3 z-10 max-w-[290px] space-y-1.5">
        <h3 className="text-sm font-semibold text-gray-100">
          {viewMode === 'context' ? '🎯 Event Context'
            : viewMode === 'compare' ? `🔍 Comparing ${pinnedIds.size} Events`
            : `${cfg.icon} Grouped by ${cfg.label}`}
        </h3>
        <p className="text-[11px] text-gray-400 leading-tight">
          {viewMode === 'context' && selectedEvent
            ? selectedEvent.title.slice(0, 55)
            : viewMode === 'compare'
              ? 'Shared attributes highlighted · Ctrl+click to pin/unpin'
              : `${filteredEvents.length} events${timelineRange ? ' in range' : ''} · Scroll to zoom · Drag canvas to pan · Drag nodes to move`}
        </p>

        {/* Group-by buttons (overview) */}
        {viewMode === 'overview' && (
          <div className="flex flex-wrap gap-1 text-xs">
            {(Object.keys(GROUP_CONFIGS) as GroupBy[]).map(g => (
              <button key={g} onClick={() => setGroupBy(g)}
                className={`px-2 py-1 rounded border transition-all ${
                  groupBy === g ? 'bg-purple-600 border-purple-400 text-white' : 'border-gray-600 text-gray-400 hover:border-gray-500'
                }`}>
                {GROUP_CONFIGS[g].icon} {GROUP_CONFIGS[g].label}
              </button>
            ))}
          </div>
        )}

        {/* Pin actions */}
        {pinnedIds.size > 0 && (
          <div className="flex gap-1 text-xs">
            {viewMode !== 'compare' && pinnedIds.size >= 2 && (
              <button
                onClick={() => { setSelectedEvent(null); setContextData(null); setViewMode('compare'); setCompareMode(true); }}
                className="px-2 py-1 rounded border border-amber-600 bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 transition-colors">
                🔍 Compare {pinnedIds.size}
              </button>
            )}
            <button
              onClick={() => { clearPins(); if (viewMode === 'compare') setViewMode('overview'); }}
              className="px-2 py-1 rounded border border-gray-600 text-gray-400 hover:border-gray-500 transition-colors">
              Clear pins
            </button>
          </div>
        )}

        {/* Back to overview */}
        {(viewMode === 'context' || viewMode === 'compare') && (
          <button
            onClick={() => { setSelectedEvent(null); setContextData(null); setViewMode('overview'); }}
            className="px-2 py-1 rounded border border-gray-600 text-gray-400 hover:border-gray-500 text-xs transition-colors">
            ← Overview
          </button>
        )}

        {/* Loading */}
        {viewMode === 'context' && isLoadingContext && (
          <div className="flex items-center gap-2 text-xs text-yellow-400">
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="56" strokeDashoffset="14" />
            </svg>
            Analyzing…
          </div>
        )}

        {/* Context legend text */}
        {viewMode === 'context' && contextData && (
          <div className="text-xs space-y-0.5 text-gray-300">
            <div>🔴 {contextData.categories.join(', ').slice(0, 50)}</div>
            <div>🟠 {contextData.themes.join(', ').slice(0, 50)}</div>
            <div>🔵 {contextData.actors.join(', ').slice(0, 50)}</div>
            <div>🟢 {contextData.locations.join(', ').slice(0, 50)}</div>
            <div>⚡ <span className="font-bold capitalize">{contextData.significance}</span></div>
          </div>
        )}
      </div>

      {/* ---- LEGEND (top-right) ---- */}
      <div className="absolute top-3 right-3 z-10 text-[10px] space-y-1 text-gray-400">
        {viewMode === 'overview' && (
          <>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: cfg.color }} />{cfg.label}</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block bg-purple-500" />Event</div>
            <div className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: '#6366f1' }} />Shared</div>
          </>
        )}
        {viewMode === 'compare' && (
          <>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block bg-purple-500" />Pinned event</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ef4444' }} />Category</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#06b6d4' }} />Actor</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#f59e0b' }} />Theme</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#10b981' }} />Location</div>
            <div className="flex items-center gap-1.5"><span className="w-4 h-0.5 border-t border-dashed inline-block" style={{ borderColor: '#a78bfa' }} />Shared link</div>
          </>
        )}
        {viewMode === 'context' && (
          <>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ef4444' }} />Category</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#06b6d4' }} />Actor</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#f59e0b' }} />Theme</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#10b981' }} />Location</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block bg-purple-400" />Related</div>
          </>
        )}
      </div>

      {/* ---- ZOOM CONTROLS (bottom-right) ---- */}
      <div className="absolute bottom-14 right-3 z-10 flex flex-col gap-1 items-center">
        <button onClick={() => setTransform(prev => zoomBy(prev, 1.3, size))}
          className="w-7 h-7 rounded bg-gray-800/80 border border-gray-600 text-gray-300 hover:bg-gray-700 flex items-center justify-center text-sm font-bold backdrop-blur-sm transition-colors">
          +
        </button>
        <button onClick={() => fitToContent(simulatedNodes)}
          className="w-7 h-7 rounded bg-gray-800/80 border border-gray-600 text-gray-400 hover:bg-gray-700 flex items-center justify-center text-[10px] backdrop-blur-sm transition-colors"
          title="Fit to content">
          ⊙
        </button>
        <button onClick={() => setTransform(prev => zoomBy(prev, 0.75, size))}
          className="w-7 h-7 rounded bg-gray-800/80 border border-gray-600 text-gray-300 hover:bg-gray-700 flex items-center justify-center text-sm font-bold backdrop-blur-sm transition-colors">
          −
        </button>
        <span className="text-[9px] text-gray-500 mt-0.5 tabular-nums">{Math.round(transform.k * 100)}%</span>
      </div>

      {/* ---- SVG CANVAS ---- */}
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        className="w-full h-full"
        style={{ cursor: dragStartRef.current ? 'grabbing' : isPanning ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { handleMouseUp(); setHoveredNodeId(null); }}
        onClick={(e) => {
          if (didPan.current) { didPan.current = false; return; }
          const tag = (e.target as SVGElement).tagName;
          if (tag === 'svg' || tag === 'rect') {
            setSelectedEvent(null);
            setContextData(null);
          }
        }}
      >
        <rect width={size.width} height={size.height} fill="transparent" />

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* Edges */}
          {simulatedEdges.map(edge => {
            const s = nodeById.get(edge.sourceId);
            const t = nodeById.get(edge.targetId);
            if (!s || !t) return null;
            const isHoverHL = highlightedEdgeIds?.has(edge.id);
            return (
              <line
                key={edge.id}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={edge.color}
                strokeWidth={Math.max(0.5, edge.weight * (isHoverHL ? 1 : 0.5))}
                opacity={connectedNodeIds ? (isHoverHL ? 0.85 : 0.08) : 0.35}
                strokeDasharray={edge.dashed ? '6 3' : undefined}
                className="transition-opacity duration-150"
              />
            );
          })}

          {/* Nodes */}
          {displayNodes.map(node => {
            const isHub = node.kind !== 'event';
            const isSelected = node.id === `event:${selectedEvent?.id}`;
            const isPinned = !!node.event && pinnedIds.has(node.event.id);
            const isHovered = hoveredNodeId === node.id;
            const dimmed = connectedNodeIds ? !connectedNodeIds.has(node.id) : false;
            const isExpanded = isHub && expandedHubs.has(node.label);
            const isDragging = dragStartRef.current?.nodeId === node.id;

            return (
              <g
                key={node.id}
                onMouseEnter={() => { if (!dragStartRef.current) setHoveredNodeId(node.id); }}
                onMouseLeave={() => setHoveredNodeId(null)}
                onMouseDown={(e) => handleNodeDragStart(e, node.id, node.x, node.y)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (didPan.current) return;
                  if (node.event) {
                    if (e.ctrlKey || e.metaKey) {
                      togglePin(node.event.id);
                    } else {
                      setSelectedEvent(node.event);
                    }
                  } else if (isHub && viewMode === 'overview') {
                    // Toggle expand/collapse for any subgroup
                    setExpandedHubs(prev => {
                      const next = new Set(prev);
                      if (next.has(node.label)) next.delete(node.label);
                      else next.add(node.label);
                      return next;
                    });
                  }
                }}
                className="cursor-pointer"
                style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
              >
                {/* Hub glow */}
                {isHub && <circle cx={node.x} cy={node.y} r={node.size + (isExpanded ? 12 : 8)} fill={node.color} opacity={isExpanded ? 0.22 : isHovered ? 0.15 : 0.06} />}

                {/* Expanded ring indicator */}
                {isExpanded && (
                  <circle cx={node.x} cy={node.y} r={node.size + 6} fill="none" stroke={node.color} strokeWidth={1.5} strokeDasharray="3 2" opacity={0.6} />
                )}

                {/* Pin ring */}
                {isPinned && (
                  <circle cx={node.x} cy={node.y} r={node.size + 5} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2" />
                )}

                {/* Main circle */}
                <circle
                  cx={node.x} cy={node.y} r={isHovered ? node.size + 2 : node.size}
                  fill={node.color}
                  opacity={dimmed ? 0.15 : isHovered ? 1 : isSelected || isPinned ? 1 : isHub ? 0.9 : 0.7}
                  className="transition-opacity duration-150"
                />

                {/* Hub count */}
                {isHub && node.hubCount != null && (
                  <text x={node.x} y={node.y + 4} textAnchor="middle" className="fill-white pointer-events-none font-bold" style={{ fontSize: '11px' }}>
                    {node.hubCount}
                  </text>
                )}

                {/* Selection ring */}
                {isSelected && (
                  <circle cx={node.x} cy={node.y} r={node.size + 4} fill="none" stroke="#fbbf24" strokeWidth={2.5} />
                )}

                {/* Label */}
                <text
                  x={node.x + (node.meta?.labelOffsetX || 0)}
                  y={node.y + node.size + 13 + (node.meta?.labelOffsetY || 0)}
                  textAnchor="middle"
                  className="fill-gray-200 pointer-events-none"
                  opacity={dimmed ? 0.2 : 1}
                  style={{ fontSize: isHub ? '11px' : '9px', fontWeight: isHub ? 'bold' : 'normal' }}
                >
                  {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* ---- HOVER TOOLTIP ---- */}
      {hoveredNode && (
        <div
          className="absolute z-30 pointer-events-none bg-gray-900/95 border border-gray-600 rounded-lg px-3 py-2 text-xs max-w-[250px] shadow-lg backdrop-blur-sm"
          style={{
            left: Math.min(Math.max(hoveredNode.x * transform.k + transform.x + 18, 8), size.width - 260),
            top: Math.max(hoveredNode.y * transform.k + transform.y - 50, 8),
          }}
        >
          <div className="font-medium text-gray-100 truncate">{hoveredNode.label}</div>

          {/* Event detail in tooltip */}
          {hoveredNode.event && (
            <>
              {hoveredNode.event.description && (
                <div className="text-gray-400 mt-0.5 line-clamp-2 text-[10px]">{hoveredNode.event.description}</div>
              )}
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 capitalize text-[10px]">
                  {hoveredNode.event.llm_significance || hoveredNode.event.severity || 'medium'}
                </span>
                {hoveredNode.event.location?.country && (
                  <span className="text-gray-500 text-[10px]">📍 {hoveredNode.event.location.country}</span>
                )}
              </div>
              {(() => {
                const categories = hoveredNode.event?.categories ?? [];
                const actors = hoveredNode.event?.actors ?? [];

                return (
                  <>
                    {categories.length > 0 && (
                      <div className="text-gray-500 mt-1 text-[10px]">
                        🔴 {categories.slice(0, 3).join(', ')}
                      </div>
                    )}
                    {actors.length > 0 && (
                      <div className="text-gray-500 text-[10px]">
                        🔵 {actors.slice(0, 2).join(', ')}
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}

          {/* Hub info */}
          {isHub(hoveredNode) && hoveredNode.hubCount != null && (
            <div className="text-gray-400 mt-0.5">{hoveredNode.hubCount} events</div>
          )}

          {/* Shared info (compare mode) */}
          {hoveredNode.meta?.shared && (
            <div className="text-amber-400 mt-0.5 text-[10px]">Shared by {hoveredNode.meta?.connectedEvents?.length} pinned events</div>
          )}

          {/* Action hints */}
          <div className="text-gray-600 mt-1.5 text-[10px] border-t border-gray-700 pt-1">
            {hoveredNode.event
              ? (pinnedIds.has(hoveredNode.event.id)
                  ? 'Click to focus · Ctrl+click to unpin · Drag to move'
                  : 'Click to focus · Ctrl+click to pin · Drag to move')
              : isHub(hoveredNode)
                ? (expandedHubs.has(hoveredNode.label) ? 'Click to collapse · Drag to move' : 'Click to expand · Drag to move')
                : 'Drag to move'}
          </div>
        </div>
      )}

      {/* ---- DETAIL PANEL (bottom) ---- */}
      {selectedEvent && (
        <div className="absolute bottom-3 left-3 right-14 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 text-xs z-10">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-purple-300 truncate">{selectedEvent.title}</div>
              {selectedEvent.description && (
                <div className="text-gray-400 mt-1 line-clamp-2">{selectedEvent.description}</div>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {(selectedEvent.llm_significance || selectedEvent.severity) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 capitalize">
                    {selectedEvent.llm_significance || selectedEvent.severity}
                  </span>
                )}
                {selectedEvent.location?.country && (
                  <span className="text-gray-500">📍 {selectedEvent.location.country}</span>
                )}
                {selectedEvent.categories?.slice(0, 3).map((c: string) => (
                  <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 capitalize">{c}</span>
                ))}
                {selectedEvent.actors?.slice(0, 2).map((a: string) => (
                  <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">{a}</span>
                ))}
                {!pinnedIds.has(selectedEvent.id) ? (
                  <button onClick={(e) => { e.stopPropagation(); togglePin(selectedEvent.id); }}
                    className="text-amber-400 hover:text-amber-300 underline transition-colors">📌 Pin</button>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); togglePin(selectedEvent.id); }}
                    className="text-gray-400 hover:text-gray-300 underline transition-colors">Unpin</button>
                )}
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setSelectedEvent(null); setContextData(null); }}
              className="text-gray-500 hover:text-gray-300 text-base leading-none flex-shrink-0 transition-colors">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ---- PINNED BAR (bottom, when no selection & not in compare) ---- */}
      {!selectedEvent && pinnedIds.size > 0 && viewMode !== 'compare' && (
        <div className="absolute bottom-3 left-3 right-14 bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg p-2 text-xs z-10">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-amber-400 flex-shrink-0">📌 Pinned:</span>
            {events.filter((e: Event) => pinnedIds.has(e.id)).map((e: Event) => (
              <span key={e.id} className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-200 flex items-center gap-1 text-[10px]">
                {e.title.slice(0, 28)}
                <button onClick={() => togglePin(e.id)} className="text-gray-500 hover:text-gray-300 ml-0.5">×</button>
              </span>
            ))}
            {pinnedIds.size >= 2 && (
              <button onClick={() => { setSelectedEvent(null); setContextData(null); setViewMode('compare'); setCompareMode(true); }}
                className="px-2 py-0.5 rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 transition-colors">
                Compare →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper used in JSX
function isHub(node: GraphNode): boolean {
  return node.kind !== 'event';
}
