'use client';

import { useEffect, useState, useMemo } from 'react';
import Map, { Marker, Popup } from 'react-map-gl';
import { Event } from '@/lib/api';
import { useDashboardStore } from '@/store/dashboard';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';

const severityColors: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

export default function WorldMap() {
  const { events, selectedEvent, setSelectedEvent, openDrawer, timelineRange } = useDashboardStore();
  const [mapboxToken, setMapboxToken] = useState<string>('');
  const [viewState, setViewState] = useState({
    longitude: 0,
    latitude: 20,
    zoom: 2,
  });

  // Load token from env or localStorage
  useEffect(() => {
    const envToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem('mapbox_token') || '' : '';
    setMapboxToken(envToken || storedToken);
  }, []);

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

  const eventsWithLocation = filteredEvents.filter((e) => e.location !== null);

  // No token configured
  if (!mapboxToken) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-secondary rounded-lg border border-gray-700">
        <div className="text-center p-8 max-w-sm">
          <div className="text-4xl mb-3">🗺️</div>
          <h3 className="text-lg font-semibold text-gray-200 mb-2">Mapbox Token Required</h3>
          <p className="text-sm text-gray-400 mb-4">
            To display the geographic map, configure your Mapbox API token in Settings.
          </p>
          <Link
            href="/settings"
            className="inline-block px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-md text-sm font-medium transition-colors"
          >
            Go to Settings →
          </Link>
          <p className="text-xs text-gray-500 mt-3">
            Get a free token at{' '}
            <a
              href="https://mapbox.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:underline"
            >
              mapbox.com
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full rounded-lg overflow-hidden border border-gray-700">
      {/* Map legend */}
      <div className="absolute top-2 left-2 z-10 bg-secondary/90 backdrop-blur-sm border border-gray-700 rounded-lg px-3 py-2">
        <div className="flex items-center gap-3 text-[10px]">
          {Object.entries(severityColors).map(([level, color]) => (
            <div key={level} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-400 capitalize">{level}</span>
            </div>
          ))}
          <span className="text-gray-600">|</span>
          <span className="text-gray-500">{eventsWithLocation.length} located events</span>
        </div>
      </div>

      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={mapboxToken}
        style={{ width: '100%', height: '100%' }}
      >
        {eventsWithLocation.map((event) => {
          const color = event.severity ? severityColors[event.severity] : '#6b7280';
          const isSelected = selectedEvent?.id === event.id;
          const size = isSelected ? 'w-4 h-4' : 'w-3 h-3';

          return (
            <Marker
              key={event.id}
              longitude={event.location!.longitude}
              latitude={event.location!.latitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelectedEvent(event);
              }}
            >
              <div
                className={`${size} rounded-full cursor-pointer hover:scale-150 transition-all ${
                  isSelected ? 'ring-2 ring-white/50' : ''
                }`}
                style={{ backgroundColor: color }}
              />
            </Marker>
          );
        })}

        {selectedEvent && selectedEvent.location && (
          <Popup
            longitude={selectedEvent.location.longitude}
            latitude={selectedEvent.location.latitude}
            anchor="top"
            onClose={() => setSelectedEvent(null)}
            closeButton={true}
            closeOnClick={false}
          >
            <div className="p-2 max-w-xs">
              <h3 className="font-bold text-sm mb-1 text-gray-900">{selectedEvent.title}</h3>
              <p className="text-xs text-gray-600 mb-2">
                {selectedEvent.description?.substring(0, 150)}
                {selectedEvent.description && selectedEvent.description.length > 150 ? '...' : ''}
              </p>
              <div className="flex gap-1 flex-wrap mb-2">
                {selectedEvent.categories?.slice(0, 3).map((cat) => (
                  <span key={cat} className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded capitalize">
                    {cat}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between">
                {selectedEvent.severity && (
                  <span className="text-xs font-semibold text-gray-700 capitalize">
                    {selectedEvent.severity}
                  </span>
                )}
                <button
                  onClick={() => openDrawer(selectedEvent.id)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  View details →
                </button>
              </div>
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
