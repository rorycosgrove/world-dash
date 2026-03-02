'use client';

import { useEffect, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useDashboardStore } from '@/store/dashboard';
import { api } from '@/lib/api';
import clsx from 'clsx';
import toast from 'react-hot-toast';

export default function AlertPanel() {
  const { alerts, setAlerts, autoRefresh, setUnacknowledgedAlertCount, toggleAlertPanel, openDrawer } =
    useDashboardStore();
  const prevAlertCount = useRef(alerts.length);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const data = await api.getAlerts({
          limit: 50,
          acknowledged: false,
        });
        setAlerts(data);
        setUnacknowledgedAlertCount(data.length);

        // Toast for new high/critical alerts
        if (data.length > prevAlertCount.current) {
          const newAlerts = data.slice(0, data.length - prevAlertCount.current);
          newAlerts.forEach((alert) => {
            if (alert.severity === 'critical' || alert.severity === 'high') {
              toast.error(`🚨 ${alert.title}`, { duration: 6000 });
            }
          });
        }
        prevAlertCount.current = data.length;
      } catch (error) {
        console.error('Failed to fetch alerts:', error);
      }
    };

    fetchAlerts();
    if (!autoRefresh) return;
    const interval = setInterval(fetchAlerts, 15000);
    return () => clearInterval(interval);
  }, [setAlerts, setUnacknowledgedAlertCount, autoRefresh]);

  const handleAcknowledge = async (id: string) => {
    try {
      await api.acknowledgeAlert(id);
      const updated = alerts.filter((a) => a.id !== id);
      setAlerts(updated);
      setUnacknowledgedAlertCount(updated.length);
      toast.success('Alert acknowledged');
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
      toast.error('Failed to acknowledge alert');
    }
  };

  if (alerts.length === 0) {
    return (
      <div className="analyst-panel p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>🔔</span>
            <span>No active alerts — all clear</span>
          </div>
          <button
            onClick={toggleAlertPanel}
            className="text-[10px] text-gray-600 hover:text-gray-400"
          >
            Hide
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="analyst-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          🔔 Active Alerts
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
            {alerts.length}
          </span>
        </h2>
        <button
          onClick={toggleAlertPanel}
          className="text-[10px] text-gray-500 hover:text-gray-300"
        >
          Hide
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {alerts.slice(0, 5).map((alert) => (
          <div
            key={alert.id}
            className={clsx(
              'flex-shrink-0 w-60 p-2.5 rounded-lg border cursor-pointer hover:brightness-110 transition-all',
              alert.severity === 'critical' && 'border-red-500/50 bg-red-950/50',
              alert.severity === 'high' && 'border-orange-500/50 bg-orange-950/50',
              alert.severity === 'medium' && 'border-yellow-500/50 bg-yellow-950/50',
              alert.severity === 'low' && 'border-green-500/50 bg-green-950/50'
            )}
            onClick={() => alert.event_id && openDrawer(alert.event_id)}
          >
            <div className="flex items-start justify-between gap-1 mb-1">
              <h3 className="font-medium text-xs flex-1 line-clamp-2 leading-snug">{alert.title}</h3>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleAcknowledge(alert.id);
                }}
                className="text-[10px] px-1.5 py-0.5 bg-gray-700/80 hover:bg-gray-600 rounded flex-shrink-0"
              >
                Ack
              </button>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <span className={clsx(
                'uppercase font-semibold',
                alert.severity === 'critical' && 'text-red-400',
                alert.severity === 'high' && 'text-orange-400',
                alert.severity === 'medium' && 'text-yellow-400',
                alert.severity === 'low' && 'text-green-400',
              )}>
                {alert.severity}
              </span>
              <span>
                {alert.created_at
                  ? formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })
                  : 'Unknown time'}
              </span>
            </div>
          </div>
        ))}
        {alerts.length > 5 && (
          <a
            href="/alerts"
            className="flex-shrink-0 w-24 flex items-center justify-center text-xs text-purple-400 hover:text-purple-300 border border-gray-700 rounded-lg"
          >
            +{alerts.length - 5} more →
          </a>
        )}
      </div>
    </div>
  );
}
