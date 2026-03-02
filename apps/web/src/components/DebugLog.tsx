'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  summary: string;
  details?: string;
  source?: string;
}

const LEVEL_CONFIG = {
  info: {
    icon: 'ℹ️',
    badge: 'bg-blue-600/80 text-blue-100',
    row: 'border-l-blue-500',
    label: 'INFO',
  },
  warn: {
    icon: '⚠️',
    badge: 'bg-yellow-600/80 text-yellow-100',
    row: 'border-l-yellow-500',
    label: 'WARN',
  },
  error: {
    icon: '🔴',
    badge: 'bg-red-600/80 text-red-100',
    row: 'border-l-red-500',
    label: 'ERR',
  },
  debug: {
    icon: '🔧',
    badge: 'bg-gray-600/80 text-gray-200',
    row: 'border-l-gray-500',
    label: 'DBG',
  },
};

/** Turn raw console args into a human-readable summary + optional detail blob. */
function parseLogArgs(args: any[]): { summary: string; details?: string; source?: string } {
  const first = args[0];

  // Known structured messages from our app
  if (typeof first === 'string') {
    // API URL logging
    if (first.startsWith('API URL:')) {
      return { summary: `API connected → ${args[1] || first.slice(9)}`, source: 'api-client' };
    }
    // Event context loading
    if (first.startsWith('Fetching context for event')) {
      return { summary: `🔍 Loading context for event`, details: first, source: 'network-map' };
    }
    if (first === 'Event context loaded:') {
      const ctx = args[1];
      if (ctx && typeof ctx === 'object') {
        const cats = ctx.categories?.join(', ') || 'none';
        const actors = ctx.actors?.join(', ') || 'none';
        return {
          summary: `✅ Context loaded — ${cats}`,
          details: JSON.stringify(ctx, null, 2),
          source: 'llm',
        };
      }
      return { summary: '✅ Event context loaded', details: JSON.stringify(args[1]), source: 'llm' };
    }
    // Fetch failures
    if (first.startsWith('Failed to fetch') || first.startsWith('Failed to load')) {
      return {
        summary: `❌ ${first}`,
        details: args.length > 1 ? JSON.stringify(args.slice(1), null, 2) : undefined,
        source: 'network',
      };
    }
    // Ollama test
    if (first.startsWith('Testing Ollama')) {
      return { summary: `🤖 ${first}`, source: 'settings' };
    }
  }

  // Generic fallback: build readable summary
  const parts = args.map((arg) => {
    if (arg === null || arg === undefined) return String(arg);
    if (arg instanceof Error) return arg.message;
    if (typeof arg === 'object') return JSON.stringify(arg);
    return String(arg);
  });

  const fullMessage = parts.join(' ');

  // If short enough, just show it
  if (fullMessage.length <= 120) {
    return { summary: fullMessage };
  }

  return {
    summary: fullMessage.slice(0, 110) + '…',
    details: fullMessage,
  };
}

export default function DebugLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error' | 'debug'>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Hook into console methods
  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalDebug = console.debug;

    const addLog = (level: LogEntry['level'], args: any[]) => {
      const { summary, details, source } = parseLogArgs(args);

      const logEntry: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        level,
        summary,
        details,
        source,
      };

      setLogs((prev) => {
        const updated = [...prev, logEntry];
        return updated.slice(Math.max(0, updated.length - 500));
      });
    };

    console.log = (...args) => {
      addLog('info', args);
      originalLog(...args);
    };
    console.warn = (...args) => {
      addLog('warn', args);
      originalWarn(...args);
    };
    console.error = (...args) => {
      addLog('error', args);
      originalError(...args);
    };
    console.debug = (...args) => {
      addLog('debug', args);
      originalDebug(...args);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      console.debug = originalDebug;
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = filter === 'all' ? logs : logs.filter((l) => l.level === filter);

  return (
    <div className="h-full flex flex-col bg-secondary">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-700 p-3">
        <h2 className="text-lg font-bold mb-2">🐛 Debug Log</h2>

        {/* Filter buttons */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex gap-1">
            {(['all', 'info', 'warn', 'error', 'debug'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`px-2 py-1 rounded border transition-colors ${
                  filter === level
                    ? 'bg-purple-600 border-purple-400 text-white'
                    : 'border-gray-600 text-gray-400 hover:border-gray-500'
                }`}
              >
                {level === 'all' ? 'ALL' : LEVEL_CONFIG[level].icon + ' ' + LEVEL_CONFIG[level].label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1 text-gray-400 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto
          </label>

          <button
            onClick={() => { setLogs([]); setExpandedIds(new Set()); }}
            className="px-2 py-1 rounded border border-gray-600 text-gray-400 hover:bg-gray-800 text-xs"
          >
            Clear
          </button>
        </div>

        <div className="text-xs text-gray-500 mt-2">
          {filteredLogs.length} / {logs.length} entries
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto text-xs">
        {filteredLogs.length === 0 ? (
          <div className="p-4 text-gray-500">No logs to display</div>
        ) : (
          filteredLogs.map((log) => {
            const cfg = LEVEL_CONFIG[log.level];
            const isExpanded = expandedIds.has(log.id);

            return (
              <div
                key={log.id}
                className={`px-3 py-1.5 border-b border-gray-800 border-l-2 ${cfg.row}`}
              >
                {/* Main row */}
                <div className="flex items-start gap-2">
                  <span className="text-gray-500 flex-shrink-0 font-mono">{log.timestamp}</span>
                  <span
                    className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${cfg.badge}`}
                  >
                    {cfg.icon} {cfg.label}
                  </span>
                  <span className="text-gray-100 flex-1 break-words leading-relaxed">
                    {log.summary}
                  </span>
                </div>

                {/* Source tag + expand link */}
                <div className="flex items-center gap-2 mt-0.5 ml-[70px]">
                  {log.source && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                      {log.source}
                    </span>
                  )}
                  {log.details && (
                    <button
                      onClick={() => toggleExpand(log.id)}
                      className="text-[10px] text-purple-400 hover:text-purple-300 underline"
                    >
                      {isExpanded ? '▼ Hide details' : '▶ Show details'}
                    </button>
                  )}
                </div>

                {/* Expandable details */}
                {isExpanded && log.details && (
                  <pre className="mt-1 ml-[70px] p-2 bg-gray-900 rounded text-gray-300 text-[10px] overflow-x-auto max-h-40 whitespace-pre-wrap break-words border border-gray-700">
                    {log.details}
                  </pre>
                )}
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
