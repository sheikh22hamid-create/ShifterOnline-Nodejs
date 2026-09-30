const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('shifter_token');

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new ApiError(`Unable to connect to server (${msg}).`, 503);
  }

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
  mobile: string;
  email?: string;
  status?: string;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface SignupPayload {
  name: string;
  mobile: string;
  email?: string;
  password: string;
}

export interface LoginPayload {
  identifier: string;
  password: string;
}

export const api = {
  signup: (data: SignupPayload) =>
    request<AuthResponse>('/api/auth/signup', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: LoginPayload | { identifier?: string; email?: string; mobile?: string; password: string }) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  me: () => request<{ user: AuthUser }>('/api/auth/me'),

  sendContactMessage: (data: {
    name: string;
    email: string;
    phone?: string;
    subject?: string;
    message: string;
  }) => request<{ message: string }>('/api/contact', { method: 'POST', body: JSON.stringify(data) }),
};
