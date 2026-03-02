'use client';

import { useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useDashboardStore } from '@/store/dashboard';
import { api } from '@/lib/api';
import clsx from 'clsx';

export default function AlertPanel() {
  const { alerts, setAlerts } = useDashboardStore();

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const data = await api.getAlerts({
          limit: 50,
          acknowledged: false,
        });
        setAlerts(data);
      } catch (error) {
        console.error('Failed to fetch alerts:', error);
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 15000); // Refresh every 15s

    return () => clearInterval(interval);
  }, [setAlerts]);

  const handleAcknowledge = async (id: string) => {
    try {
      await api.acknowledgeAlert(id);
      setAlerts(alerts.filter((a) => a.id !== id));
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
    }
  };

  if (alerts.length === 0) {
    return (
      <div className="analyst-panel p-4">
        <h2 className="text-lg font-bold mb-2">🔔 Active Alerts</h2>
        <p className="text-sm text-gray-400">No active alerts</p>
      </div>
    );
  }

  return (
    <div className="analyst-panel p-4">
      <h2 className="text-lg font-bold mb-3">🔔 Active Alerts ({alerts.length})</h2>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={clsx(
              'p-3 rounded border',
              alert.severity === 'critical' && 'border-red-500 bg-red-950',
              alert.severity === 'high' && 'border-orange-500 bg-orange-950',
              alert.severity === 'medium' && 'border-yellow-500 bg-yellow-950',
              alert.severity === 'low' && 'border-green-500 bg-green-950'
            )}
          >
            <div className="flex items-start justify-between mb-1">
              <h3 className="font-semibold text-sm flex-1">{alert.title}</h3>
              <button
                onClick={() => handleAcknowledge(alert.id)}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
              >
                Ack
              </button>
            </div>

            {alert.description && (
              <p className="text-xs text-gray-300 mb-2">{alert.description}</p>
            )}

            <div className="text-xs text-gray-400">
              {alert.created_at
                ? formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })
                : 'Timestamp unavailable'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
