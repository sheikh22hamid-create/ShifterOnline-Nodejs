import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, MapPin } from 'lucide-react';
import { api } from '../../lib/api';
import type { SelectedPlace } from '../../lib/route';
import { LocationPickerModal } from './LocationPickerModal';

interface LocationAutocompleteInputProps {
  value: string;
  onTextChange: (text: string) => void;
  onPlaceSelected: (place: SelectedPlace | null) => void;
  onLoadError?: (message: string) => void;
  placeholder: string;
  className: string;
}

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

// Client-side Nominatim fallback function if backend geocode endpoint is unreachable
async function fallbackNominatimSearch(query: string): Promise<SelectedPlace[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=6&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      place_id?: number | string;
    }>;
    return data.map((item) => ({
      address: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      placeId: String(item.place_id || `${item.lat},${item.lon}`),
    }));
  } catch (err) {
    console.warn('Nominatim fallback geocode error:', err);
    return [];
  }
}

export function LocationAutocompleteInput({
  value,
  onTextChange,
  onPlaceSelected,
  onLoadError,
  placeholder,
  className,
}: LocationAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<SelectedPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pickerModalOpen, setPickerModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const runSearch = async (query: string) => {
    const thisRequestId = ++requestIdRef.current;
    setSearching(true);

    try {
      // 1. Try primary API
      const res = await api.searchLocations(query);
      if (thisRequestId !== requestIdRef.current) return;
      if (res && Array.isArray(res.results) && res.results.length > 0) {
        const places: SelectedPlace[] = res.results.map((r) => ({
          address: r.address,
          lat: r.lat,
          lng: r.lng,
          placeId: r.placeId,
        }));
        setSuggestions(places);
        setOpen(true);
        setSearching(false);
        return;
      }
    } catch {
      // Ignore backend API error and fallback to direct client-side search
    }

    // 2. Direct Nominatim Client-Side Fallback if primary API returns empty or errors out
    try {
      const fallbackResults = await fallbackNominatimSearch(query);
      if (thisRequestId !== requestIdRef.current) return;
      if (fallbackResults.length > 0) {
        setSuggestions(fallbackResults);
        setOpen(true);
      } else {
        setSuggestions([]);
        onLoadError?.('No location matches found. Please try a nearby landmark.');
      }
    } catch (err) {
      if (thisRequestId !== requestIdRef.current) return;
      setSuggestions([]);
    } finally {
      if (thisRequestId === requestIdRef.current) setSearching(false);
    }
  };

  const handleChange = (text: string) => {
    onTextChange(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestIdRef.current += 1;
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      onPlaceSelected(null);
      return;
    }

    // Auto-assign a fallback place so the user is never stuck if they type a location manually
    onPlaceSelected({
      address: trimmed,
      lat: 22.7196, // default center fallback
      lng: 75.8577,
    });

    debounceRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
  };

  const handleSelect = (place: SelectedPlace) => {
    onTextChange(place.address);
    onPlaceSelected(place);
    setSuggestions([]);
    setOpen(false);
  };

  const openGoogleMapsSearch = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const query = value.trim() || placeholder;
    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    window.open(gmapsUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center w-full">
        <input
          required
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className={`${className} pr-10`}
          autoComplete="off"
        />
        {searching ? (
          <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted" />
        ) : (
          <button
            type="button"
            onClick={() => setPickerModalOpen(true)}
            title="Pick location on Interactive Map"
            aria-label="Pick location on map"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition-colors hover:bg-navy/10 hover:text-navy"
          >
            <MapPin size={17} className="text-orange" />
          </button>
        )}
      </div>

      {/* Action links below field */}
      <div className="mt-1 flex items-center justify-between text-[11px] px-1 text-muted">
        <button
          type="button"
          onClick={() => setPickerModalOpen(true)}
          className="inline-flex items-center gap-1 font-semibold text-navy hover:underline"
        >
          📍 Pick on Interactive Map
        </button>
        <button
          type="button"
          onClick={openGoogleMapsSearch}
          className="inline-flex items-center gap-1 font-semibold text-royal hover:underline"
        >
          Search on Google Maps <ExternalLink size={10} />
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-line bg-white py-1.5 shadow-card">
          {suggestions.map((s) => (
            <li key={s.placeId ?? `${s.lat},${s.lng}`}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                className="flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm text-ink/85 hover:bg-offwhite"
              >
                <MapPin size={15} className="mt-0.5 shrink-0 text-orange" />
                <span>{s.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Interactive Map Location Picker Modal */}
      <LocationPickerModal
        open={pickerModalOpen}
        onClose={() => setPickerModalOpen(false)}
        title={`Select ${placeholder}`}
        onConfirmLocation={(place) => {
          handleSelect(place);
        }}
      />
    </div>
  );
}


