'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chat';
import { useDashboardStore } from '@/store/dashboard';
import { api, ChatMessage, VisualizationCommand } from '@/lib/api';
import InlineChart from '@/components/InlineChart';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

const VIZ_TYPE_ICONS: Record<string, string> = {
  network: '🕸️',
  timeline: '📈',
  chart: '📊',
  filter: '🔍',
  map: '🗺️',
  compare: '⚖️',
};

function VisualizationCard({ viz, onApply }: { viz: VisualizationCommand; onApply: () => void }) {
  const hasChart = viz.chart_spec && viz.chart_spec.series?.length > 0;

  return (
    <div className="mt-2 bg-purple-900/20 border border-purple-500/30 rounded-lg p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm">{VIZ_TYPE_ICONS[viz.type] || '📊'}</span>
        <span className="text-xs font-medium text-purple-300">{viz.title || `${viz.type} visualization`}</span>
      </div>
      {viz.description && (
        <p className="text-[10px] text-gray-400 mb-2">{viz.description}</p>
      )}

      {/* Inline chart rendering */}
      {hasChart && (
        <div className="mb-2 bg-gray-900/50 rounded-md p-1.5">
          <InlineChart spec={viz.chart_spec!} height={180} />
        </div>
      )}

      {viz.event_ids.length > 0 && !hasChart && (
        <p className="text-[10px] text-gray-500 mb-2">{viz.event_ids.length} event{viz.event_ids.length !== 1 ? 's' : ''} selected</p>
      )}
      <button
        onClick={onApply}
        className="w-full text-xs py-1.5 rounded bg-purple-600/40 text-purple-200 hover:bg-purple-600/60 border border-purple-500/30 transition-colors font-medium"
      >
        {hasChart ? '🔍 Expand to Dashboard' : '✨ Apply Visualization'}
      </button>
    </div>
  );
}

function MessageBubble({
  msg,
  visualization,
  onApplyViz,
}: {
  msg: ChatMessage;
  visualization?: VisualizationCommand | null;
  onApplyViz?: () => void;
}) {
  const isUser = msg.role === 'user';
  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed',
          isUser
            ? 'bg-accent text-white rounded-br-sm'
            : 'bg-gray-700 text-gray-200 rounded-bl-sm'
        )}
      >
        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        {visualization && onApplyViz && (
          <VisualizationCard viz={visualization} onApply={onApplyViz} />
        )}
        <div
          className={clsx(
            'text-[10px] mt-1',
            isUser ? 'text-blue-200' : 'text-gray-500'
          )}
        >
          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
        </div>
      </div>
    </div>
  );
}

function SessionList({
  onSelect,
  onClose,
}: {
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}) {
  const { sessions, setSessions, sessionId: activeSession } = useChatStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getChatSessions();
        setSessions(data);
      } catch (e) {
        console.error('Failed to load sessions', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [setSessions]);

  const handleDelete = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteChatSession(sid);
      setSessions(sessions.filter((s) => s.session_id !== sid));
    } catch (err) {
      console.error('Failed to delete session', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-300">Chat History</span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-gray-500 text-xs text-center py-8">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="text-gray-500 text-xs text-center py-8">No sessions yet</div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => onSelect(s.session_id)}
              className={clsx(
                'w-full text-left px-3 py-2 border-b border-gray-700/50 hover:bg-gray-700/40 transition-colors',
                activeSession === s.session_id && 'bg-gray-700/60'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-300 truncate">
                  {s.session_id.slice(0, 8)}…
                </span>
                <button
                  onClick={(e) => handleDelete(s.session_id, e)}
                  className="text-gray-600 hover:text-red-400 text-[10px] flex-shrink-0"
                  title="Delete session"
                >
                  🗑
                </button>
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {s.message_count} messages · {formatDistanceToNow(new Date(s.last_message_at), { addSuffix: true })}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const {
    isOpen,
    closeChat,
    messages,
    setMessages,
    addMessage,
    sessionId,
    setSessionId,
    contextEventId,
    contextClusterId,
    contextEvents,
    setContextEvents,
    setMessageChartSpec,
    isLoading,
    setLoading,
    error,
    setError,
    startNewSession,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  const [pendingViz, setPendingViz] = useState<Record<string, VisualizationCommand>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { pinEvents, setCompareMode, setFilterSeverity, setFilterCategory, setDateRange, setViewMode: setDashViewMode, setActiveChartSpec } = useDashboardStore();

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Load session messages when sessionId changes
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const msgs = await api.getChatSession(sessionId);
        setMessages(msgs);
      } catch (e) {
        console.error('Failed to load session', e);
      }
    })();
  }, [sessionId, setMessages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    setError(null);

    // Optimistic user message
    const optimisticMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      session_id: sessionId || '',
      role: 'user',
      content: text,
      context_event_id: contextEventId,
      context_cluster_id: contextClusterId,
      metadata_json: null,
      created_at: new Date().toISOString(),
    };
    addMessage(optimisticMsg);
    setLoading(true);

    try {
      const response = await api.sendChatMessage({
        message: text,
        session_id: sessionId || undefined,
        context_event_id: contextEventId || undefined,
        context_cluster_id: contextClusterId || undefined,
      });

      // Update session ID (server assigns on first message)
      if (!sessionId) {
        setSessionId(response.session_id);
      }

      // Replace optimistic user message + add assistant response
      setMessages([
        ...messages.filter((m) => m.id !== optimisticMsg.id),
        { ...optimisticMsg, id: `user-${Date.now()}`, session_id: response.session_id },
        response.message,
      ]);

      // Store visualization command if present
      if (response.visualization) {
        setPendingViz((prev) => ({ ...prev, [response.message.id]: response.visualization! }));
        // Persist chart spec for session history
        if (response.visualization.chart_spec) {
          setMessageChartSpec(response.message.id, response.visualization.chart_spec);
        }
      }

      // Store context events for display
      if (response.context_events?.length) {
        setContextEvents(response.context_events);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to send message');
      // Remove optimistic message on error
      setMessages(messages.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setLoading(false);
    }
  }, [input, isLoading, sessionId, contextEventId, contextClusterId, messages, addMessage, setMessages, setSessionId, setLoading, setError, setContextEvents, setMessageChartSpec]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSessionSelect = (sid: string) => {
    setSessionId(sid);
    setShowSessions(false);
  };

  const applyVisualization = useCallback((viz: VisualizationCommand) => {
    // Pin events if specified
    if (viz.event_ids.length > 0) {
      pinEvents(viz.event_ids);
    }

    // Apply based on type
    switch (viz.type) {
      case 'compare':
      case 'chart':
        // If there's a chart_spec, open the compare/chart dashboard view
        if (viz.chart_spec) {
          setActiveChartSpec(viz.chart_spec);
        }
        if (viz.event_ids.length >= 2) {
          setCompareMode(true);
        }
        setDashViewMode('compare');
        break;
      case 'filter':
        if (viz.filter_spec) {
          if (viz.filter_spec.severity) setFilterSeverity(viz.filter_spec.severity);
          if (viz.filter_spec.category) setFilterCategory(viz.filter_spec.category);
          if (viz.filter_spec.date_range) setDateRange(viz.filter_spec.date_range);
        }
        break;
      case 'map':
        setDashViewMode('map');
        break;
      case 'network':
      case 'timeline':
        setDashViewMode('network');
        break;
    }
  }, [pinEvents, setCompareMode, setFilterSeverity, setFilterCategory, setDateRange, setDashViewMode, setActiveChartSpec]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 max-w-full bg-gray-800 border-l border-gray-700 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 bg-gray-800/95 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">💬</span>
          <span className="text-sm font-medium text-gray-200">Intelligence Chat</span>
          {sessionId && (
            <span className="text-[10px] text-gray-500 font-mono">
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="text-gray-400 hover:text-gray-200 p-1 rounded hover:bg-gray-700/50 transition-colors"
            title="Chat sessions"
          >
            <span className="text-xs">📋</span>
          </button>
          <button
            onClick={() => { startNewSession(); setShowSessions(false); }}
            className="text-gray-400 hover:text-gray-200 p-1 rounded hover:bg-gray-700/50 transition-colors"
            title="New conversation"
          >
            <span className="text-xs">➕</span>
          </button>
          <button
            onClick={closeChat}
            className="text-gray-400 hover:text-gray-200 p-1 rounded hover:bg-gray-700/50 transition-colors"
            title="Close chat"
          >
            <span className="text-xs">✕</span>
          </button>
        </div>
      </div>

      {/* Context badge */}
      {(contextEventId || contextClusterId) && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700/40 border-b border-gray-700/50 flex-shrink-0">
          <span className="text-[10px] text-gray-400">Context:</span>
          {contextEventId && (
            <span className="text-[10px] bg-accent/20 text-blue-300 px-1.5 py-0.5 rounded">
              Event {contextEventId.slice(0, 8)}…
            </span>
          )}
          {contextClusterId && (
            <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">
              Cluster {contextClusterId.slice(0, 8)}…
            </span>
          )}
        </div>
      )}

      {/* Session list overlay */}
      {showSessions ? (
        <div className="flex-1 overflow-hidden">
          <SessionList
            onSelect={handleSessionSelect}
            onClose={() => setShowSessions(false)}
          />
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <span className="text-3xl mb-3">🌍</span>
                <p className="text-sm text-gray-400 mb-1">Intelligence Chat</p>
                <p className="text-xs text-gray-500 max-w-[260px]">
                  Ask questions about world events, request analysis, explore patterns, or ask me to visualize and compare events.
                </p>
              </div>
            )}

            {messages.map((msg) => {
              const viz = pendingViz[msg.id] || (msg.metadata_json?.visualization as VisualizationCommand | undefined);
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  visualization={msg.role === 'assistant' ? viz : undefined}
                  onApplyViz={viz ? () => applyVisualization(viz) : undefined}
                />
              );
            })}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-700 rounded-lg px-3 py-2 rounded-bl-sm">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Context events (collapsed) */}
          {contextEvents.length > 0 && (
            <ContextEventsBar events={contextEvents} />
          )}

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-gray-700 p-3">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about world events…"
                rows={1}
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors"
                style={{ minHeight: '36px', maxHeight: '120px' }}
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className={clsx(
                  'flex-shrink-0 px-3 rounded-lg text-sm font-medium transition-colors',
                  input.trim() && !isLoading
                    ? 'bg-accent text-white hover:bg-accent/80'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                )}
                title="Send message (Enter)"
              >
                ↑
              </button>
            </div>
            <div className="text-[10px] text-gray-600 mt-1.5 text-center">
              Shift+Enter for newline · Responses use RAG context
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ContextEventsBar({ events }: { events: { id: string; title: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const { pinEvents, setCompareMode, setViewMode: setDashViewMode } = useDashboardStore();

  const handlePinAll = () => {
    pinEvents(events.map((e) => e.id));
  };

  const handleCompareAll = () => {
    pinEvents(events.map((e) => e.id));
    setCompareMode(true);
    setDashViewMode('compare');
  };

  const handleShowOnMap = () => {
    pinEvents(events.map((e) => e.id));
    setDashViewMode('map');
  };

  return (
    <div className="flex-shrink-0 border-t border-gray-700/50 bg-gray-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
      >
        <span className="text-[10px] text-gray-400">
          📎 {events.length} context event{events.length !== 1 ? 's' : ''} used
        </span>
        <span className="text-[10px] text-gray-500">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2">
          <div className="space-y-0.5 max-h-24 overflow-y-auto mb-2">
            {events.map((ev) => (
              <div key={ev.id} className="text-[10px] text-gray-500 truncate">
                • {ev.title}
              </div>
            ))}
          </div>
          {/* Action buttons */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={handlePinAll}
              className="text-[10px] px-2 py-1 rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-colors"
            >
              📌 Pin all
            </button>
            {events.length >= 2 && (
              <button
                onClick={handleCompareAll}
                className="text-[10px] px-2 py-1 rounded border border-purple-500/30 text-purple-300 hover:bg-purple-500/10 transition-colors"
              >
                ⚖️ Compare
              </button>
            )}
            <button
              onClick={handleShowOnMap}
              className="text-[10px] px-2 py-1 rounded border border-green-500/30 text-green-300 hover:bg-green-500/10 transition-colors"
            >
              🗺️ Show on map
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
