'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, Alert } from '@/lib/api';
import { useDashboardStore } from '@/store/dashboard';
import toast from 'react-hot-toast';

type SortField = 'created_at' | 'severity';
type SortDir = 'asc' | 'desc';

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-green-500/20 text-green-400 border-green-500/30',
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSev, setFilterSev] = useState<string | null>(null);
  const [filterAck, setFilterAck] = useState<'all' | 'unack' | 'ack'>('all');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { openDrawer, setUnacknowledgedAlertCount } = useDashboardStore();

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await api.getAlerts({ limit: 200 });
      setAlerts(data);
      setUnacknowledgedAlertCount(data.filter((a) => !a.acknowledged).length);
    } catch (err) {
      console.error('Failed to load alerts', err);
    } finally {
      setLoading(false);
    }
  }, [setUnacknowledgedAlertCount]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleAcknowledge = async (id: string) => {
    try {
      await api.acknowledgeAlert(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
      setUnacknowledgedAlertCount(alerts.filter((a) => !a.acknowledged && a.id !== id).length);
      toast.success('Alert acknowledged');
    } catch {
      toast.error('Failed to acknowledge');
    }
  };

  const handleBulkAcknowledge = async () => {
    const ids = Array.from(selected).filter((id) => {
      const a = alerts.find((al) => al.id === id);
      return a && !a.acknowledged;
    });
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => api.acknowledgeAlert(id)));
      setAlerts((prev) =>
        prev.map((a) => (ids.includes(a.id) ? { ...a, acknowledged: true } : a)),
      );
      setSelected(new Set());
      setUnacknowledgedAlertCount(
        alerts.filter((a) => !a.acknowledged && !ids.includes(a.id)).length,
      );
      toast.success(`${ids.length} alert(s) acknowledged`);
    } catch {
      toast.error('Bulk acknowledge failed');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredAlerts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredAlerts.map((a) => a.id)));
    }
  };

  // Filter & sort
  let filteredAlerts = [...alerts];
  if (filterSev) filteredAlerts = filteredAlerts.filter((a) => a.severity === filterSev);
  if (filterAck === 'unack') filteredAlerts = filteredAlerts.filter((a) => !a.acknowledged);
  if (filterAck === 'ack') filteredAlerts = filteredAlerts.filter((a) => a.acknowledged);

  filteredAlerts.sort((a, b) => {
    let cmp = 0;
    if (sortField === 'created_at') cmp = a.created_at.localeCompare(b.created_at);
    else cmp = (SEV_ORDER[a.severity] || 99) - (SEV_ORDER[b.severity] || 99);
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => {
        if (sortField === field) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
        else { setSortField(field); setSortDir('desc'); }
      }}
      className={`text-xs px-2 py-1 rounded transition-colors ${
        sortField === field ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label} {sortField === field ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-primary p-6">
        <h1 className="text-2xl font-bold text-gray-100 mb-6">🔔 Alerts</h1>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="analyst-panel p-4 h-16 animate-pulse">
              <div className="h-3 bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">🔔 Alerts</h1>
            <p className="text-sm text-gray-400 mt-1">
              {alerts.filter((a) => !a.acknowledged).length} unacknowledged of {alerts.length} total
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button
                onClick={handleBulkAcknowledge}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-medium transition-colors"
              >
                ✓ Acknowledge {selected.size} selected
              </button>
            )}
            <button
              onClick={fetchAlerts}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-300 transition-colors"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="analyst-panel p-3 flex flex-wrap items-center gap-3">
          {/* Severity filter */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 uppercase mr-1">Severity:</span>
            {['critical', 'high', 'medium', 'low'].map((sev) => (
              <button
                key={sev}
                onClick={() => setFilterSev(filterSev === sev ? null : sev)}
                className={`text-xs px-2 py-0.5 rounded capitalize border transition-colors ${
                  filterSev === sev
                    ? SEV_COLORS[sev]
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-gray-700" />

          {/* Ack filter */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 uppercase mr-1">Status:</span>
            {(['all', 'unack', 'ack'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFilterAck(v)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  filterAck === v ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {v === 'all' ? 'All' : v === 'unack' ? 'Unacknowledged' : 'Acknowledged'}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-gray-700" />

          {/* Sort */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 uppercase mr-1">Sort:</span>
            <SortButton field="created_at" label="Time" />
            <SortButton field="severity" label="Severity" />
          </div>
        </div>

        {/* Table */}
        <div className="analyst-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-500 text-xs">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === filteredAlerts.length && filteredAlerts.length > 0}
                    onChange={toggleSelectAll}
                    className="accent-highlight"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">Severity</th>
                <th className="text-left px-3 py-2 font-medium">Message</th>
                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Time</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr
                  key={alert.id}
                  className={`border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                    !alert.acknowledged ? 'bg-gray-800/30' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(alert.id)}
                      onChange={() => toggleSelect(alert.id)}
                      className="accent-highlight"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded capitalize border ${SEV_COLORS[alert.severity]}`}
                    >
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-200 max-w-md truncate">
                    <button
                      onClick={() => alert.event_id && openDrawer(alert.event_id)}
                      className="text-left hover:text-highlight transition-colors"
                      title={alert.message}
                    >
                      {alert.message}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs hidden md:table-cell whitespace-nowrap">
                    {new Date(alert.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {alert.acknowledged ? (
                      <span className="text-green-500 text-xs">✓ Ack</span>
                    ) : (
                      <span className="text-yellow-500 text-xs font-medium">● New</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        className="text-xs px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/40 transition-colors"
                      >
                        Acknowledge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredAlerts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                    {alerts.length === 0
                      ? 'No alerts yet — alerts are generated when critical events are detected'
                      : 'No alerts match the current filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
