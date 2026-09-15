const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://shifteronline-nodejs-dev.onrender.com';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('shifter_token');

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(body?.message ?? body?.msg ?? 'Something went wrong. Please try again.', res.status);
  }

  return body as T;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteCalculationResult {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationMinutes: number;
  path: LatLng[] | null;
}

export interface GeocodeResult {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
}

export interface DistanceEstimateResponse {
  DistanceData: {
    distance_km: number;
    distance_text?: string;
    duration_min: number;
    duration_text?: string;
    air_distance_km?: number;
    source?: string;
    origin_address?: string;
    destination_address?: string;
    pickup_lat: number;
    pickup_lng: number;
    drop_lat: number;
    drop_lng: number;
  };
  ResponseCode: string;
  Result: string;
  ResponseMsg: string;
}

export interface CategoryItem {
  id: number;
  cat_name: string;
  cat_img?: string;
  other_image?: string;
}

export interface CategoriesResponse {
  Result: boolean;
  categories: CategoryItem[];
}

export interface PackageEstimateItem {
  package_id: number;
  title: string;
  user_title: string;
  driver_title?: string;
  min_charge: number;
  per_km_charge: number;
  original_min_charge?: number;
  original_per_km_charge?: number;
  radius_charge: number;
  estimated_fare: number;
  is_night: number;
}

export interface FareEstimateResponse {
  Result: boolean;
  distance_km: number;
  duration_min: number;
  radius_km: number;
  packages: PackageEstimateItem[];
}

export interface CreateOrderPayload {
  uid?: number;
  category: string;
  delivery_type: number[]; // array of package/model IDs e.g. [34]
  booking_type?: number;
  plat: number;
  plong: number;
  paddress: string;
  pick_name?: string;
  pmobile: string;
  dlat: number;
  dlong: number;
  daddress: string;
  drop_name?: string;
  dmobile?: string;
  package_weight?: string;
  package_cost?: number;
  radius_km?: number;
  city_id?: number;
}

export interface CreateOrderResponse {
  Result: boolean | string;
  ResponseCode?: string;
  order_id?: number;
  msg?: string;
  message?: string;
}

export const api = {
  signup: (data: { name: string; email: string; password: string }) =>
    request<AuthResponse>('/api/auth/signup', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  me: () => request<{ user: AuthUser }>('/api/auth/me'),

  sendContactMessage: (data: {
    name: string;
    email: string;
    phone?: string;
    subject?: string;
    message: string;
  }) => request<{ message: string }>('/api/contact', { method: 'POST', body: JSON.stringify(data) }),

  getDistanceEstimate: (data: {
    pickup_lat: number;
    pickup_lng: number;
    drop_lat: number;
    drop_lng: number;
  }) =>
    request<DistanceEstimateResponse>('/api/order/distance', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  calculateRoute: async (data: { origin: LatLng; destination: LatLng }): Promise<RouteCalculationResult> => {
    try {
      const res = await request<DistanceEstimateResponse>('/api/order/distance', {
        method: 'POST',
        body: JSON.stringify({
          pickup_lat: data.origin.lat,
          pickup_lng: data.origin.lng,
          drop_lat: data.destination.lat,
          drop_lng: data.destination.lng,
        }),
      });
      const distKm = res?.DistanceData?.distance_km ?? 0;
      const durMin = res?.DistanceData?.duration_min ?? 0;
      return {
        distanceKm: distKm,
        distanceMeters: Math.round(distKm * 1000),
        durationMinutes: durMin,
        durationSeconds: durMin * 60,
        path: null,
      };
    } catch {
      return {
        distanceKm: 0,
        distanceMeters: 0,
        durationMinutes: 0,
        durationSeconds: 0,
        path: null,
      };
    }
  },

  searchLocations: async (query: string): Promise<{ results: GeocodeResult[] }> => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=6&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      });
      if (!res.ok) return { results: [] };
      const data = (await res.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
        place_id?: number | string;
      }>;
      return {
        results: data.map((item) => ({
          placeId: String(item.place_id || `${item.lat},${item.lon}`),
          address: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
        })),
      };
    } catch {
      return { results: [] };
    }
  },

  getCategories: () => request<CategoriesResponse>('/api/order/categories'),

  getFareEstimate: (data: {
    cat_id: number;
    plat: number;
    plong: number;
    dlat: number;
    dlong: number;
    radius_km?: number;
  }) =>
    request<FareEstimateResponse>('/api/order/fare-estimate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  createOrder: (data: CreateOrderPayload) =>
    request<CreateOrderResponse>('/api/order/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

