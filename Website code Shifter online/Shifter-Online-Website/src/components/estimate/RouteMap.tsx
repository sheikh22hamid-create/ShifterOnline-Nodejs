import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../../lib/api';
import type { SelectedPlace } from '../../lib/route';

interface RouteMapProps {
  pickup: SelectedPlace;
  drop: SelectedPlace;
  path: LatLng[] | null;
  className?: string;
}

function dotIcon(color: string, label: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:${color};color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(11,23,54,0.35);border:2px solid #fff;">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

const pickupIcon = dotIcon('#0B2A68', 'A');
const dropIcon = dotIcon('#FF5A1F', 'B');

export function RouteMap({ pickup, drop, path, className = '' }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(mapRef.current);
      layerGroupRef.current = L.layerGroup().addTo(mapRef.current);
    }

    const map = mapRef.current;
    const layerGroup = layerGroupRef.current!;
    layerGroup.clearLayers();

    const pickupLatLng = L.latLng(pickup.lat, pickup.lng);
    const dropLatLng = L.latLng(drop.lat, drop.lng);

    L.marker(pickupLatLng, { icon: pickupIcon, title: pickup.address }).addTo(layerGroup);
    L.marker(dropLatLng, { icon: dropIcon, title: drop.address }).addTo(layerGroup);

    const bounds = L.latLngBounds([pickupLatLng, dropLatLng]);

    if (path && path.length > 1) {
      const line = L.polyline(
        path.map((p) => [p.lat, p.lng]),
        { color: '#FF5A1F', weight: 4, opacity: 0.9 }
      );
      line.addTo(layerGroup);
      bounds.extend(line.getBounds());
    }

    map.fitBounds(bounds, { padding: [48, 48] });

    // Leaflet needs an explicit size recalculation once its container has a
    // real, laid-out size (it's rendered inside an animated/collapsed section).
    setTimeout(() => map.invalidateSize(), 0);
  }, [pickup, drop, path]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    []
  );

  return <div ref={containerRef} className={`overflow-hidden rounded-2xl border border-line ${className}`} />;
}
