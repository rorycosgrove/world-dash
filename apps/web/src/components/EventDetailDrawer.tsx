'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { useDashboardStore } from '@/store/dashboard';
import { useChatStore } from '@/store/chat';
import { api, Event, EventContext } from '@/lib/api';
import clsx from 'clsx';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
};

const SEVERITY_TEXT: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/15 border-red-500/30',
  high: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  medium: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
  low: 'text-green-400 bg-green-500/15 border-green-500/30',
};

function RiskGauge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.7 ? '#ef4444' : score >= 0.4 ? '#f59e0b' : '#10b981';

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono" style={{ color }}>
        {score.toFixed(2)}
      </span>
    </div>
  );
}

function EventDetailBody({
  event,
  severity,
  context,
  contextLoading,
  showRawContent,
  setShowRawContent,
  onAnalyzeContext,
}: {
  event: Event;
  severity: string;
  context: EventContext | null;
  contextLoading: boolean;
  showRawContent: boolean;
  setShowRawContent: (v: boolean) => void;
  onAnalyzeContext: () => void;
}) {
  return (
    <div className="p-4 space-y-5">
      {/* Source Link */}
      {event.url && (
        <div>
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Source</h3>
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-purple-400 hover:text-purple-300 hover:underline break-all"
          >
            {event.url.length > 80 ? event.url.substring(0, 80) + '...' : event.url} ↗
          </a>
        </div>
      )}

      {/* Description */}
      {event.description && (
        <div>
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Description</h3>
          <p className="text-sm text-gray-300 leading-relaxed">{event.description}</p>
        </div>
      )}

      {/* LLM Analysis */}
      {event.llm_processed_at && (
        <div className="bg-secondary rounded-lg border border-gray-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-purple-400 uppercase tracking-wide">
              🤖 AI Analysis
            </h3>
            <span className="text-[10px] text-gray-500">
              {format(new Date(event.llm_processed_at), 'MMM d, HH:mm')}
            </span>
          </div>

          {event.llm_significance && (
            <div>
              <span className="text-[10px] text-gray-500 uppercase">Significance</span>
              <span
                className={clsx(
                  'ml-2 text-xs px-2 py-0.5 rounded border capitalize',
                  SEVERITY_TEXT[event.llm_significance] || 'text-gray-400 bg-gray-700 border-gray-600'
                )}
              >
                {event.llm_significance}
              </span>
            </div>
          )}

          {event.categories.length > 0 && (
            <div>
              <span className="text-[10px] text-gray-500 uppercase block mb-1">Categories</span>
              <div className="flex flex-wrap gap-1">
                {event.categories.map((cat) => (
                  <span key={cat} className="text-[11px] px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/20 capitalize">{cat}</span>
                ))}
              </div>
            </div>
          )}

          {event.actors.length > 0 && (
            <div>
              <span className="text-[10px] text-gray-500 uppercase block mb-1">Actors</span>
              <div className="flex flex-wrap gap-1">
                {event.actors.map((actor) => (
                  <span key={actor} className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">{actor}</span>
                ))}
              </div>
            </div>
          )}

          {event.themes.length > 0 && (
            <div>
              <span className="text-[10px] text-gray-500 uppercase block mb-1">Themes</span>
              <div className="flex flex-wrap gap-1">
                {event.themes.map((theme) => (
                  <span key={theme} className="text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">{theme}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Entities */}
      {event.entities && event.entities.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Extracted Entities</h3>
          <div className="bg-secondary rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-gray-500">
                  <th className="text-left px-3 py-2 font-medium">Entity</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-right px-3 py-2 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {event.entities.map((entity, idx) => (
                  <tr key={idx} className="border-b border-gray-800 last:border-0">
                    <td className="px-3 py-1.5 text-gray-200">{entity.text}</td>
                    <td className="px-3 py-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 text-[10px] uppercase">{entity.type}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-400 font-mono">{(entity.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Location */}
      {event.location && (
        <div>
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">📍 Location</h3>
          <div className="bg-secondary rounded-lg border border-gray-700 p-3 text-sm space-y-1">
            {event.location.country && (
              <div className="flex justify-between"><span className="text-gray-500">Country</span><span className="text-gray-200">{event.location.country}</span></div>
            )}
            {event.location.region && (
              <div className="flex justify-between"><span className="text-gray-500">Region</span><span className="text-gray-200">{event.location.region}</span></div>
            )}
            {event.location.city && (
              <div className="flex justify-between"><span className="text-gray-500">City</span><span className="text-gray-200">{event.location.city}</span></div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Coordinates</span>
              <span className="text-gray-200 font-mono text-xs">{event.location.latitude.toFixed(4)}, {event.location.longitude.toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Confidence</span>
              <span className="text-gray-200 font-mono text-xs">{(event.location.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Tags */}
      {event.tags.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Tags</h3>
          <div className="flex flex-wrap gap-1">
            {event.tags.map((tag) => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded bg-gray-700 text-gray-300 border border-gray-600">{tag}</span>
            ))}
          </div>
        </div>
      )}

      {/* Context Analysis */}
      <div>
        <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Context Analysis</h3>
        {context ? (
          <div className="bg-secondary rounded-lg border border-gray-700 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs text-green-400">✅ Analysis complete</div>
            {context.significance && (
              <div>
                <span className="text-[10px] text-gray-500">Significance: </span>
                <span className="text-sm text-gray-200 capitalize">{context.significance}</span>
              </div>
            )}
            {context.related_event_ids.length > 0 && (
              <div>
                <span className="text-[10px] text-gray-500">Related events: </span>
                <span className="text-sm text-gray-200">{context.related_event_ids.length} found</span>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onAnalyzeContext}
            disabled={contextLoading}
            className="w-full py-2 px-4 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-sm text-purple-300 transition-colors disabled:opacity-50"
          >
            {contextLoading ? '🔄 Analyzing...' : '🧠 Analyze Context (AI)'}
          </button>
        )}
      </div>

      {/* Metadata */}
      <div className="border-t border-gray-700 pt-4">
        <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Metadata</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-gray-500">Status</span><p className="text-gray-200 capitalize">{event.status}</p></div>
          <div><span className="text-gray-500">Published</span><p className="text-gray-200">{format(new Date(event.published_at), 'MMM d, yyyy HH:mm')}</p></div>
          <div><span className="text-gray-500">Created</span><p className="text-gray-200">{format(new Date(event.created_at), 'MMM d, yyyy HH:mm')}</p></div>
          <div><span className="text-gray-500">Event ID</span><p className="text-gray-200 font-mono text-[10px] truncate">{event.id}</p></div>
        </div>
      </div>

      {/* Raw Content (expandable) */}
      {event.description && (
        <div>
          <button
            onClick={() => setShowRawContent(!showRawContent)}
            className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showRawContent ? '▼ Hide raw content' : '▶ Show raw content'}
          </button>
          {showRawContent && (
            <pre className="mt-2 p-3 bg-gray-900 rounded-lg text-[10px] text-gray-400 overflow-x-auto max-h-48 whitespace-pre-wrap break-words border border-gray-700">
              {event.description}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function EventDetailDrawer({ inline }: { inline?: boolean } = {}) {
  const { selectedEventId, closeDrawer, events, pinnedEventIds, togglePinEvent, openRightPanel } = useDashboardStore();
  const { setContextEventId, openChat } = useChatStore();
  const [event, setEvent] = useState<Event | null>(null);
  const [context, setContext] = useState<EventContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(false);
  const [showRawContent, setShowRawContent] = useState(false);

  const fetchEvent = useCallback(async () => {
    if (!selectedEventId) return;
    setLoading(true);
    try {
      // Try from store first, fall back to API
      const storeEvent = events.find((e) => e.id === selectedEventId);
      if (storeEvent) {
        setEvent(storeEvent);
      } else {
        const data = await api.getEvent(selectedEventId);
        setEvent(data);
      }
    } catch (err) {
      console.error('Failed to load event:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedEventId, events]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const handleAnalyzeContext = async () => {
    if (!selectedEventId) return;
    setContextLoading(true);
    try {
      const ctx = await api.analyzeEventContext(selectedEventId);
      setContext(ctx);
    } catch (err) {
      console.error('Failed to analyze context:', err);
    } finally {
      setContextLoading(false);
    }
  };

  if (!selectedEventId) return null;

  const severity = event?.llm_significance || event?.severity || 'medium';

  // Inline mode: render as embedded scrollable panel (for command-center right panel)
  if (inline) {
    return (
      <div className="flex flex-col h-full overflow-y-auto bg-primary">
        {/* Header */}
        <div className="sticky top-0 bg-primary/95 backdrop-blur-sm border-b border-gray-700/50 p-3 z-10">
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-700 rounded w-3/4" />
                <div className="h-3 bg-gray-800 rounded w-1/2" />
              </div>
            ) : (
              <>
                <h2 className="text-sm font-bold leading-tight">{event?.title}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {event?.severity && (
                    <span
                      className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase',
                        SEVERITY_TEXT[severity] || 'text-gray-400 bg-gray-700 border-gray-600'
                      )}
                    >
                      {severity}
                    </span>
                  )}
                  {event?.risk_score !== null && event?.risk_score !== undefined && (
                    <RiskGauge score={event.risk_score} />
                  )}
                  {event?.published_at && (
                    <span className="text-[10px] text-gray-500">
                      {formatDistanceToNow(new Date(event.published_at), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          {selectedEventId && (
            <div className="flex items-center gap-1.5 mt-2">
              <button
                onClick={() => togglePinEvent(selectedEventId)}
                className={clsx(
                  'text-[10px] px-2 py-0.5 rounded border transition-colors',
                  pinnedEventIds.has(selectedEventId)
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-gray-600 text-gray-400 hover:border-amber-500/50 hover:text-amber-300'
                )}
              >
                📌 {pinnedEventIds.has(selectedEventId) ? 'Pinned' : 'Pin'}
              </button>
              <button
                onClick={() => {
                  setContextEventId(selectedEventId);
                  openRightPanel('chat');
                }}
                className="text-[10px] px-2 py-0.5 rounded border border-gray-600 text-gray-400 hover:border-accent/50 hover:text-blue-300 transition-colors"
              >
                💬 Chat
              </button>
            </div>
          )}
        </div>

        {/* Content — reuses same body as drawer mode */}
        {loading ? (
          <div className="p-3 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="h-3 bg-gray-700 rounded w-1/4" />
                <div className="h-4 bg-gray-800 rounded w-full" />
              </div>
            ))}
          </div>
        ) : event ? (
          <EventDetailBody
            event={event}
            severity={severity}
            context={context}
            contextLoading={contextLoading}
            showRawContent={showRawContent}
            setShowRawContent={setShowRawContent}
            onAnalyzeContext={handleAnalyzeContext}
          />
        ) : (
          <div className="p-6 text-center text-gray-500 text-sm">Event not found</div>
        )}
      </div>
    );
  }

  // Drawer mode (default): fixed overlay with backdrop
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={closeDrawer}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] md:w-[540px] bg-primary border-l border-gray-700 z-50 overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-primary/95 backdrop-blur-sm border-b border-gray-700 p-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {loading ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-5 bg-gray-700 rounded w-3/4" />
                  <div className="h-3 bg-gray-800 rounded w-1/2" />
                </div>
              ) : (
                <>
                  <h2 className="text-lg font-bold leading-tight">{event?.title}</h2>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {event?.severity && (
                      <span
                        className={clsx(
                          'text-[11px] px-2 py-0.5 rounded border font-medium uppercase',
                          SEVERITY_TEXT[severity] || 'text-gray-400 bg-gray-700 border-gray-600'
                        )}
                      >
                        {severity}
                      </span>
                    )}
                    {event?.risk_score !== null && event?.risk_score !== undefined && (
                      <RiskGauge score={event.risk_score} />
                    )}
                    {event?.published_at && (
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(event.published_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={closeDrawer}
              className="text-gray-400 hover:text-white text-xl px-2 py-1 hover:bg-gray-700 rounded transition-colors flex-shrink-0"
            >
              ✕
            </button>
          </div>

          {/* Action buttons */}
          {selectedEventId && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => togglePinEvent(selectedEventId)}
                className={clsx(
                  'text-xs px-2.5 py-1 rounded border transition-colors',
                  pinnedEventIds.has(selectedEventId)
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                    : 'border-gray-600 text-gray-400 hover:border-amber-500/50 hover:text-amber-300'
                )}
              >
                📌 {pinnedEventIds.has(selectedEventId) ? 'Pinned' : 'Pin for Compare'}
              </button>
              <button
                onClick={() => {
                  setContextEventId(selectedEventId);
                  openChat();
                }}
                className="text-xs px-2.5 py-1 rounded border border-gray-600 text-gray-400 hover:border-accent/50 hover:text-blue-300 transition-colors"
              >
                💬 Chat about this
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="h-3 bg-gray-700 rounded w-1/4" />
                <div className="h-4 bg-gray-800 rounded w-full" />
                <div className="h-4 bg-gray-800 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : event ? (
          <EventDetailBody
            event={event}
            severity={severity}
            context={context}
            contextLoading={contextLoading}
            showRawContent={showRawContent}
            setShowRawContent={setShowRawContent}
            onAnalyzeContext={handleAnalyzeContext}
          />
        ) : (
          <div className="p-8 text-center text-gray-500">
            <p>Event not found</p>
          </div>
        )}
      </div>
    </>
  );
}
