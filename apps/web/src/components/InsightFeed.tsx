'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { api, Alert, Cluster, ClusterDetail, Event } from '@/lib/api';
import { useDashboardStore } from '@/store/dashboard';
import { useChatStore } from '@/store/chat';
import clsx from 'clsx';
import toast from 'react-hot-toast';

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────
const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
};

const SEV_TEXT: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-green-400',
};

const SEV_BG: Record<string, string> = {
  critical: 'bg-red-500/15',
  high: 'bg-orange-500/15',
  medium: 'bg-yellow-500/15',
  low: 'bg-green-500/15',
};

// ────────────────────────────────────────────────────────────────
// Section interface
// ────────────────────────────────────────────────────────────────
type SectionId = 'pulse' | 'alerts' | 'trends' | 'clusters' | 'notable';

interface AnalysisData {
  total_events: number;
  llm_processed: number;
  with_enrichment: number;
  top_categories: { name: string; count: number }[];
  top_actors: { name: string; count: number }[];
  top_themes: { name: string; count: number }[];
  significance_distribution: { level: string; count: number }[];
}

// ────────────────────────────────────────────────────────────────
// Pulse Section — live stats strip
// ────────────────────────────────────────────────────────────────
function PulseSection({ analysis, events }: { analysis: AnalysisData | null; events: Event[] }) {
  const { autoRefresh, timelineRange } = useDashboardStore();

  const rangeCount = useMemo(() => {
    if (!timelineRange) return events.length;
    const s = new Date(timelineRange.start).getTime();
    const e = new Date(timelineRange.end).getTime();
    return events.filter(ev => {
      const t = new Date(ev.published_at).getTime();
      return t >= s && t <= e;
    }).length;
  }, [events, timelineRange]);

  const scanPct = analysis ? Math.round((analysis.llm_processed / Math.max(analysis.total_events, 1)) * 100) : 0;
  const enrichPct = analysis ? Math.round((analysis.with_enrichment / Math.max(analysis.total_events, 1)) * 100) : 0;

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={clsx('w-1.5 h-1.5 rounded-full', autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-gray-600')} />
          <span className="text-[10px] text-gray-400">{autoRefresh ? 'LIVE' : 'PAUSED'}</span>
        </div>
        <span className="text-[10px] text-gray-500">{rangeCount} events{timelineRange ? ' in range' : ''}</span>
      </div>

      {/* Mini stat bars */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-500 w-14">AI Scan</span>
          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${scanPct}%` }} />
          </div>
          <span className="text-[9px] text-purple-300 w-8 text-right">{scanPct}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-500 w-14">Enriched</span>
          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-500 rounded-full transition-all duration-500" style={{ width: `${enrichPct}%` }} />
          </div>
          <span className="text-[9px] text-cyan-300 w-8 text-right">{enrichPct}%</span>
        </div>
      </div>

      {/* Significance distribution */}
      {analysis && analysis.significance_distribution.length > 0 && (
        <div className="flex items-center gap-1 mt-2">
          {analysis.significance_distribution.map(({ level, count }) => (
            <button
              key={level}
              onClick={() => useDashboardStore.getState().setFilterSeverity(level)}
              className={clsx('flex-1 text-center py-0.5 rounded text-[9px] transition-colors hover:opacity-80', SEV_BG[level] || 'bg-gray-700', SEV_TEXT[level] || 'text-gray-400')}
              title={`Filter to ${level} significance`}
            >
              {count}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Alert Section
// ────────────────────────────────────────────────────────────────
function AlertSection({ alerts, onAcknowledge }: { alerts: Alert[]; onAcknowledge: (id: string) => void }) {
  const { openDrawer } = useDashboardStore();

  if (alerts.length === 0) {
    return (
      <div className="px-3 py-2 text-[10px] text-gray-600 text-center">
        All clear — no active alerts
      </div>
    );
  }

  return (
    <div className="space-y-1 px-2 py-1 max-h-48 overflow-y-auto scrollbar-thin">
      {alerts.slice(0, 8).map(alert => (
        <div
          key={alert.id}
          className={clsx(
            'flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-800/60',
            alert.severity === 'critical' && 'border-l-2 border-red-500',
            alert.severity === 'high' && 'border-l-2 border-orange-500',
          )}
          onClick={() => alert.event_id && openDrawer(alert.event_id)}
        >
          <div className={clsx('w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0', SEV_COLORS[alert.severity] || 'bg-gray-500')} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-gray-200 line-clamp-1">{alert.title}</div>
            <div className="text-[9px] text-gray-500 mt-0.5">
              {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onAcknowledge(alert.id); }}
            className="text-[9px] text-gray-500 hover:text-green-400 transition-colors flex-shrink-0 px-1"
            title="Acknowledge"
          >
            ✓
          </button>
        </div>
      ))}
      {alerts.length > 8 && (
        <a href="/alerts" className="block text-center text-[10px] text-purple-400 hover:text-purple-300 py-1">
          +{alerts.length - 8} more →
        </a>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Trend Section — AI analysis insights
// ────────────────────────────────────────────────────────────────
function TrendSection({ analysis }: { analysis: AnalysisData | null }) {
  const { setFilterCategory } = useDashboardStore();

  if (!analysis) return <div className="px-3 py-2 text-[10px] text-gray-600 text-center">Loading analysis…</div>;

  const topCats = analysis.top_categories.slice(0, 5);
  const topActors = analysis.top_actors.slice(0, 4);
  const maxCount = topCats.length > 0 ? topCats[0].count : 1;

  return (
    <div className="px-3 py-1 space-y-2">
      {/* Top Categories with bars */}
      {topCats.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Top Categories</div>
          {topCats.map(cat => (
            <button
              key={cat.name}
              onClick={() => setFilterCategory(cat.name)}
              className="w-full flex items-center gap-2 group hover:bg-gray-800/40 rounded px-1 py-0.5 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-300 truncate group-hover:text-white transition-colors">{cat.name}</span>
                  <span className="text-gray-500 flex-shrink-0 ml-2">{cat.count}</span>
                </div>
                <div className="h-1 bg-gray-800 rounded-full mt-0.5 overflow-hidden">
                  <div
                    className="h-full bg-highlight/60 rounded-full transition-all duration-300"
                    style={{ width: `${(cat.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Top Actors */}
      {topActors.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Key Actors</div>
          <div className="flex flex-wrap gap-1">
            {topActors.map(a => (
              <span key={a.name} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 truncate max-w-[120px]">
                {a.name} ({a.count})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top Themes */}
      {analysis.top_themes.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Themes</div>
          <div className="flex flex-wrap gap-1">
            {analysis.top_themes.slice(0, 5).map(t => (
              <span key={t.name} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 truncate max-w-[120px]">
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Cluster Section
// ────────────────────────────────────────────────────────────────
function ClusterSection() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClusterDetail | null>(null);
  const [generating, setGenerating] = useState(false);
  const { openChat, setContextClusterId } = useChatStore();

  useEffect(() => {
    api.getClusters().then(setClusters).catch(console.error);
  }, []);

  const handleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id);
    try {
      const d = await api.getCluster(id);
      setDetail(d);
    } catch (e) { console.error(e); }
  };

  const handleAutoGenerate = async () => {
    setGenerating(true);
    try {
      await api.autoGenerateClusters();
      const fresh = await api.getClusters();
      setClusters(fresh);
      toast.success('Clusters generated');
    } catch (e) { console.error(e); toast.error('Failed to generate clusters'); }
    finally { setGenerating(false); }
  };

  if (clusters.length === 0) {
    return (
      <div className="px-3 py-2 text-center">
        <button
          onClick={handleAutoGenerate}
          disabled={generating}
          className="text-[10px] text-purple-400 hover:text-purple-300 disabled:text-gray-600"
        >
          {generating ? 'Generating…' : '✨ Auto-generate clusters'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-2 py-1 max-h-56 overflow-y-auto scrollbar-thin">
      {clusters.slice(0, 6).map(cluster => (
        <div key={cluster.id}>
          <button
            onClick={() => handleExpand(cluster.id)}
            className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-gray-800/40 transition-colors text-left"
          >
            <span className="text-[9px] text-gray-500">{expanded === cluster.id ? '▾' : '▸'}</span>
            <span className="text-[11px] text-gray-200 flex-1 truncate">{cluster.label}</span>
            <span className="text-[9px] text-gray-500 flex-shrink-0">{cluster.event_count}</span>
          </button>

          {expanded === cluster.id && detail && (
            <div className="ml-5 mb-1 space-y-1 animate-fade-in">
              {detail.summary && (
                <p className="text-[10px] text-gray-400 leading-relaxed">{detail.summary}</p>
              )}
              {detail.keywords?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detail.keywords.slice(0, 6).map((kw: string) => (
                    <span key={kw} className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-300">{kw}</span>
                  ))}
                </div>
              )}
              <button
                onClick={() => { setContextClusterId(cluster.id); openChat(); }}
                className="text-[9px] text-purple-400 hover:text-purple-300"
              >
                💬 Investigate
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Notable Events Section — high significance unviewed
// ────────────────────────────────────────────────────────────────
function NotableSection({ events }: { events: Event[] }) {
  const { openDrawer, timelineRange } = useDashboardStore();

  const notable = useMemo(() => {
    let filtered = events.filter(e =>
      (e.llm_significance === 'critical' || e.llm_significance === 'high' || e.risk_score != null && e.risk_score >= 70)
    );
    if (timelineRange) {
      const s = new Date(timelineRange.start).getTime();
      const end = new Date(timelineRange.end).getTime();
      filtered = filtered.filter(e => {
        const t = new Date(e.published_at).getTime();
        return t >= s && t <= end;
      });
    }
    return filtered
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
      .slice(0, 6);
  }, [events, timelineRange]);

  if (notable.length === 0) {
    return (
      <div className="px-3 py-2 text-[10px] text-gray-600 text-center">
        No high-significance events{timelineRange ? ' in selected range' : ''}
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-2 py-1 max-h-44 overflow-y-auto scrollbar-thin">
      {notable.map(event => (
        <button
          key={event.id}
          onClick={() => openDrawer(event.id)}
          className="w-full flex items-start gap-2 p-1.5 rounded hover:bg-gray-800/40 transition-colors text-left"
        >
          <div className={clsx(
            'w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0',
            SEV_COLORS[event.llm_significance || event.severity || 'medium'] || 'bg-gray-500'
          )} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-gray-200 line-clamp-1">{event.title}</div>
            <div className="flex items-center gap-2 mt-0.5">
              {event.risk_score != null && (
                <span className="text-[9px] text-gray-500">Risk: {event.risk_score}</span>
              )}
              <span className="text-[9px] text-gray-600">
                {formatDistanceToNow(new Date(event.published_at), { addSuffix: true })}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Section header helper
// ────────────────────────────────────────────────────────────────
function SectionHeader({
  title, icon, count, isOpen, onToggle
}: {
  title: string; icon: string; count?: number; isOpen: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800/30 transition-colors border-t border-gray-800/50"
    >
      <span className="text-[9px] text-gray-500">{isOpen ? '▾' : '▸'}</span>
      <span className="text-[10px]">{icon}</span>
      <span className="text-[10px] font-medium text-gray-300 flex-1 text-left">{title}</span>
      {count != null && count > 0 && (
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400">{count}</span>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────────
export default function InsightFeed() {
  const { events, alerts, setAlerts, autoRefresh, setUnacknowledgedAlertCount } = useDashboardStore();

  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set(['pulse', 'alerts', 'trends', 'notable']));
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const prevAlertCount = useRef(alerts.length);

  const toggleSection = useCallback((id: SectionId) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Fetch analysis
  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await api.getAnalysisSummary();
        setAnalysis(data);
      } catch (e) { console.error('Analysis fetch failed:', e); }
    };
    fetch();
    if (!autoRefresh) return;
    const interval = setInterval(fetch, 20000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Fetch alerts
  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const data = await api.getAlerts({ limit: 50, acknowledged: false });
        setAlerts(data);
        setUnacknowledgedAlertCount(data.length);
        if (data.length > prevAlertCount.current) {
          const newAlerts = data.slice(0, data.length - prevAlertCount.current);
          newAlerts.forEach(alert => {
            if (alert.severity === 'critical' || alert.severity === 'high') {
              toast.error(`🚨 ${alert.title}`, { duration: 6000 });
            }
          });
        }
        prevAlertCount.current = data.length;
      } catch (e) { console.error('Alerts fetch failed:', e); }
    };
    fetchAlerts();
    if (!autoRefresh) return;
    const interval = setInterval(fetchAlerts, 15000);
    return () => clearInterval(interval);
  }, [setAlerts, setUnacknowledgedAlertCount, autoRefresh]);

  const handleAcknowledge = useCallback(async (id: string) => {
    try {
      await api.acknowledgeAlert(id);
      const updated = alerts.filter(a => a.id !== id);
      setAlerts(updated);
      setUnacknowledgedAlertCount(updated.length);
    } catch (e) { console.error(e); }
  }, [alerts, setAlerts, setUnacknowledgedAlertCount]);

  return (
    <div className="h-full flex flex-col bg-gray-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800/60 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-200">Intelligence</span>
        <div className="flex-1" />
        <span className="text-[9px] text-gray-600">{events.length} events</span>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Pulse — always visible, not collapsible */}
        <PulseSection analysis={analysis} events={events} />

        {/* Alerts */}
        <SectionHeader
          title="Alerts" icon="🔔" count={alerts.length}
          isOpen={openSections.has('alerts')} onToggle={() => toggleSection('alerts')}
        />
        {openSections.has('alerts') && (
          <AlertSection alerts={alerts} onAcknowledge={handleAcknowledge} />
        )}

        {/* Trends */}
        <SectionHeader
          title="Analysis" icon="📊"
          isOpen={openSections.has('trends')} onToggle={() => toggleSection('trends')}
        />
        {openSections.has('trends') && <TrendSection analysis={analysis} />}

        {/* Clusters */}
        <SectionHeader
          title="Clusters" icon="🔗"
          isOpen={openSections.has('clusters')} onToggle={() => toggleSection('clusters')}
        />
        {openSections.has('clusters') && <ClusterSection />}

        {/* Notable */}
        <SectionHeader
          title="Notable Events" icon="⚡"
          isOpen={openSections.has('notable')} onToggle={() => toggleSection('notable')}
        />
        {openSections.has('notable') && <NotableSection events={events} />}
      </div>
    </div>
  );
}
