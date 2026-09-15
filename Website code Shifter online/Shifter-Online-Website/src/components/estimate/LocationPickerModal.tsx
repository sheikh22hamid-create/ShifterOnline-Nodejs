import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Loader2, MapPin, X } from 'lucide-react';
import type { SelectedPlace } from '../../lib/route';

interface LocationPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmLocation: (place: SelectedPlace) => void;
  initialPlace?: SelectedPlace | null;
  title: string;
}

const pinIcon = L.divIcon({
  className: '',
  html: `<div style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9999px;background:#FF5A1F;color:#fff;box-shadow:0 4px 12px rgba(255,90,31,0.5);border:3px solid #fff;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
         </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
});

export function LocationPickerModal({
  open,
  onClose,
  onConfirmLocation,
  initialPlace,
  title,
}: LocationPickerModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [latLng, setLatLng] = useState<{ lat: number; lng: number }>({
    lat: initialPlace?.lat || 22.7196,
    lng: initialPlace?.lng || 75.8577,
  });
  const [address, setAddress] = useState(initialPlace?.address || '');
  const [geocoding, setGeocoding] = useState(false);
  const [locatingUser, setLocatingUser] = useState(false);

  // Reverse geocode lat/lng to human readable address
  const reverseGeocode = async (lat: number, lng: number) => {
    setGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
        { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          setAddress(data.display_name);
          return;
        }
      }
      setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } catch {
      setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } finally {
      setGeocoding(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    const startLat = initialPlace?.lat || 22.7196;
    const startLng = initialPlace?.lng || 75.8577;
    setLatLng({ lat: startLat, lng: startLng });
    if (initialPlace?.address) setAddress(initialPlace.address);
    else reverseGeocode(startLat, startLng);

    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      if (!mapRef.current) {
        const map = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: false,
        }).setView([startLat, startLng], 14);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(map);

        const marker = L.marker([startLat, startLng], {
          icon: pinIcon,
          draggable: true,
        }).addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          setLatLng({ lat: pos.lat, lng: pos.lng });
          reverseGeocode(pos.lat, pos.lng);
        });

        map.on('click', (e: L.LeafletMouseEvent) => {
          const { lat, lng } = e.latlng;
          marker.setLatLng([lat, lng]);
          setLatLng({ lat, lng });
          reverseGeocode(lat, lng);
        });

        mapRef.current = map;
        markerRef.current = marker;
      } else {
        mapRef.current.setView([startLat, startLng], 14);
        markerRef.current?.setLatLng([startLat, startLng]);
      }

      mapRef.current.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [open, initialPlace]);

  useEffect(() => {
    if (!open && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
    }
  }, [open]);

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setLatLng({ lat, lng });
        if (mapRef.current && markerRef.current) {
          mapRef.current.setView([lat, lng], 16);
          markerRef.current.setLatLng([lat, lng]);
        }
        reverseGeocode(lat, lng);
        setLocatingUser(false);
      },
      (err) => {
        console.warn('Geolocation failed:', err);
        alert('Could not access your location. Please select on map manually.');
        setLocatingUser(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleConfirm = () => {
    onConfirmLocation({
      address: address || `Location (${latLng.lat.toFixed(4)}, ${latLng.lng.toFixed(4)})`,
      lat: latLng.lat,
      lng: latLng.lng,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs">
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-white shadow-card">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-orange/10 text-orange">
              <MapPin size={18} />
            </span>
            <h3 className="font-extrabold text-ink text-base">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted hover:bg-offwhite hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {/* Map Container */}
        <div className="relative">
          <div ref={containerRef} className="h-72 w-full" />

          {/* Quick GPS Location Button overlay */}
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locatingUser}
            className="absolute bottom-3 right-3 z-[400] flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-navy shadow-card transition-all hover:bg-navy hover:text-white"
          >
            {locatingUser ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Crosshair size={14} className="text-orange" />
            )}
            {locatingUser ? 'Locating...' : 'Use GPS Location'}
          </button>
        </div>

        {/* Selected Address Display & Confirmation Footer */}
        <div className="border-t border-line p-5">
          <div className="mb-4 rounded-xl border border-line bg-offwhite p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Selected Address</p>
            <p className="mt-1 text-xs font-semibold text-ink leading-relaxed">
              {geocoding ? 'Fetching address details...' : address || 'Click or drag pin on map to select location.'}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line px-4 py-2.5 text-xs font-semibold text-muted hover:bg-offwhite"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={geocoding}
              className="rounded-xl bg-orange px-5 py-2.5 text-xs font-bold text-white shadow-soft transition-all hover:bg-orange-light disabled:opacity-50"
            >
              Confirm Location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
