'use client';

import { useEffect, useState } from 'react';
import Map, { Marker, Popup } from 'react-map-gl';
import { Event } from '@/lib/api';
import { useDashboardStore } from '@/store/dashboard';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

const severityColors: Record<string, string> = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

export default function WorldMap() {
  const { events, selectedEvent, setSelectedEvent } = useDashboardStore();
  const [viewState, setViewState] = useState({
    longitude: 0,
    latitude: 20,
    zoom: 2,
  });

  const eventsWithLocation = events.filter((e) => e.location !== null);

  return (
    <div className="h-full w-full">
      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
      >
        {eventsWithLocation.map((event) => {
          const color = event.severity ? severityColors[event.severity] : '#6b7280';
          
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
                className="w-3 h-3 rounded-full cursor-pointer hover:scale-150 transition-transform"
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
              <h3 className="font-bold text-sm mb-1">{selectedEvent.title}</h3>
              <p className="text-xs text-gray-600 mb-2">
                {selectedEvent.description?.substring(0, 150)}...
              </p>
              <div className="flex gap-2 flex-wrap">
                {selectedEvent.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-1 bg-gray-200 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              {selectedEvent.severity && (
                <div className="mt-2">
                  <span
                    className={`text-xs font-semibold severity-${selectedEvent.severity}`}
                  >
                    {selectedEvent.severity.toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
