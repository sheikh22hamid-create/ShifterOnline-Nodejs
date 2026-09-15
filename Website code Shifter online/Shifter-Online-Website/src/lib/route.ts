import { api, type LatLng } from './api';

export interface SelectedPlace {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

export type RouteResult = {
  pickup: SelectedPlace;
  drop: SelectedPlace;
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationMinutes: number;
  path: LatLng[] | null;
};

function placeKey(place: SelectedPlace): string {
  return place.placeId ?? `${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;
}

// Per-session cache so re-submitting the same pickup/drop pair doesn't fire a
// duplicate request against the shared public OSRM instance.
const routeCache = new Map<string, RouteResult>();

export async function getRouteEstimate(pickup: SelectedPlace, drop: SelectedPlace): Promise<RouteResult> {
  const cacheKey = `${placeKey(pickup)}|${placeKey(drop)}`;
  const cached = routeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let distanceKm = 0;
  let durationMinutes = 0;

  // 1. Fetch live distance & duration from Render backend API
  try {
    const distRes = await api.getDistanceEstimate({
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      drop_lat: drop.lat,
      drop_lng: drop.lng,
    });
    if (distRes?.DistanceData) {
      distanceKm = distRes.DistanceData.distance_km || 0;
      durationMinutes = distRes.DistanceData.duration_min || 0;
    }
  } catch (err) {
    console.warn('Backend distance estimate failed, falling back to OSRM:', err);
  }

  // 2. Fetch driving path geometry for map display from OSRM
  let path: LatLng[] | null = null;
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${drop.lng},${drop.lat}?overview=full&geometries=geojson`;
    const res = await fetch(osrmUrl);
    if (res.ok) {
      const data = (await res.json()) as {
        routes?: Array<{
          distance?: number;
          duration?: number;
          geometry?: { coordinates: Array<[number, number]> };
        }>;
      };
      if (data.routes && data.routes[0] && data.routes[0].geometry?.coordinates) {
        path = data.routes[0].geometry.coordinates.map((coord) => ({
          lat: coord[1],
          lng: coord[0],
        }));
        if (!distanceKm && data.routes[0].distance) {
          distanceKm = Math.round((data.routes[0].distance / 1000) * 100) / 100;
        }
        if (!durationMinutes && data.routes[0].duration) {
          durationMinutes = Math.round(data.routes[0].duration / 60);
        }
      }
    }
  } catch (err) {
    console.warn('OSRM path fetch error:', err);
  }

  // Fallback 2-point line if OSRM geometry is unavailable
  if (!path) {
    path = [
      { lat: pickup.lat, lng: pickup.lng },
      { lat: drop.lat, lng: drop.lng },
    ];
  }

  const routeResult: RouteResult = {
    pickup,
    drop,
    distanceMeters: Math.round(distanceKm * 1000),
    distanceKm,
    durationSeconds: durationMinutes * 60,
    durationMinutes,
    path,
  };

  routeCache.set(cacheKey, routeResult);
  return routeResult;
}
