'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Cluster, ClusterDetail } from '@/lib/api';
import { useChatStore } from '@/store/chat';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

export default function ClusterPanel() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClusterDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { openChat, setContextClusterId } = useChatStore();

  const fetchClusters = useCallback(async () => {
    try {
      const data = await api.getClusters();
      setClusters(data);
    } catch (e) {
      console.error('Failed to fetch clusters', e);
    }
  }, []);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  const handleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setLoading(true);
    try {
      const d = await api.getCluster(id);
      setDetail(d);
    } catch (e) {
      console.error('Failed to fetch cluster detail', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoGenerate = async () => {
    setGenerating(true);
    try {
      await api.autoGenerateClusters();
      await fetchClusters();
    } catch (e) {
      console.error('Auto-generate failed', e);
    } finally {
      setGenerating(false);
    }
  };

  const handleChatAbout = (cluster: Cluster) => {
    setContextClusterId(cluster.id);
    openChat();
  };

  const handlePin = async (cluster: Cluster) => {
    try {
      await api.updateCluster(cluster.id, { pinned: !cluster.pinned });
      await fetchClusters();
    } catch (e) {
      console.error('Failed to toggle pin', e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCluster(id);
      setClusters((prev) => prev.filter((c) => c.id !== id));
      if (expanded === id) {
        setExpanded(null);
        setDetail(null);
      }
    } catch (e) {
      console.error('Failed to delete cluster', e);
    }
  };

  return (
    <div className="analyst-panel p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Topic Clusters
        </h3>
        <button
          onClick={handleAutoGenerate}
          disabled={generating}
          className={clsx(
            'text-[10px] px-2 py-0.5 rounded transition-colors',
            generating
              ? 'text-gray-500 cursor-wait'
              : 'text-accent hover:bg-accent/10'
          )}
          title="Auto-generate clusters from embedded events"
        >
          {generating ? '⏳ Generating…' : '✨ Auto-generate'}
        </button>
      </div>

      {clusters.length === 0 ? (
        <div className="text-xs text-gray-600 text-center py-4">
          No clusters yet. Click auto-generate or create manually.
        </div>
      ) : (
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {clusters.map((c) => (
            <div key={c.id} className="border border-gray-700/50 rounded-md overflow-hidden">
              {/* Cluster header */}
              <button
                onClick={() => handleExpand(c.id)}
                className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-gray-700/30 transition-colors"
              >
                <span className="text-[10px] text-gray-500">
                  {expanded === c.id ? '▼' : '▶'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-200 truncate flex items-center gap-1">
                    {c.pinned && <span title="Pinned">📌</span>}
                    {c.auto_generated && <span className="text-[9px] text-gray-600">auto</span>}
                    {c.label}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {c.event_count} event{c.event_count !== 1 ? 's' : ''}
                    {c.keywords?.length > 0 && (
                      <span> · {c.keywords.slice(0, 3).join(', ')}</span>
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded detail */}
              {expanded === c.id && (
                <div className="px-2.5 pb-2 border-t border-gray-700/30">
                  {loading ? (
                    <div className="text-[10px] text-gray-500 py-2">Loading…</div>
                  ) : detail ? (
                    <div className="space-y-1.5 mt-1.5">
                      {detail.summary && (
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                          {detail.summary}
                        </p>
                      )}

                      {/* Events list */}
                      <div className="space-y-0.5">
                        {detail.events.slice(0, 8).map((evt) => (
                          <div key={evt.id} className="text-[10px] text-gray-500 truncate">
                            • {evt.title}
                          </div>
                        ))}
                        {detail.events.length > 8 && (
                          <div className="text-[10px] text-gray-600">
                            +{detail.events.length - 8} more
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleChatAbout(c)}
                          className="text-[10px] text-accent hover:underline"
                        >
                          💬 Chat about
                        </button>
                        <button
                          onClick={() => handlePin(c)}
                          className="text-[10px] text-gray-500 hover:text-gray-300"
                        >
                          {c.pinned ? '📌 Unpin' : '📌 Pin'}
                        </button>
                        {!c.pinned && (
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="text-[10px] text-gray-600 hover:text-red-400"
                          >
                            🗑 Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
