const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class AdminApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const ADMIN_TOKEN_KEY = 'shifter_admin_token';

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);

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
    throw new AdminApiError(
      `Unable to connect to backend server at ${API_URL} (${msg}). Please ensure the website backend server is running on port 4000.`,
      503
    );
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new AdminApiError(
      body?.message ?? body?.msg ?? 'Something went wrong. Please try again.',
      res.status
    );
  }

  return body as T;
}

export type UserStatus = 'Pending' | 'Completed';

export interface AdminUser {
  email: string;
  role: 'admin';
  name: string;
}

export interface WebsiteUser {
  id: string;
  name: string;
  email: string | null;
  mobile: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AdminStats {
  totalUsers: number;
  pendingUsers: number;
  completedUsers: number;
  todayUsers: number;
}

export interface UsersResponse {
  users: WebsiteUser[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CreateUserInput {
  name: string;
  mobile: string;
  email?: string;
  password: string;
  status?: UserStatus;
}

export interface UpdateUserInput {
  name: string;
  mobile: string;
  email?: string;
  status: UserStatus;
  password?: string;
}

export const adminApi = {
  login: (data: { email: string; password: string }) =>
    adminRequest<{ token: string; admin: AdminUser }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  me: () => adminRequest<{ admin: AdminUser }>('/api/admin/me'),

  getStats: () => adminRequest<AdminStats>('/api/admin/stats'),

  getUsers: (params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    if (params?.status && params.status !== 'All') query.set('status', params.status);
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.sortOrder) query.set('sortOrder', params.sortOrder);

    const qs = query.toString();
    return adminRequest<UsersResponse>(`/api/admin/users${qs ? `?${qs}` : ''}`);
  },

  getUserById: (id: string) => adminRequest<{ user: WebsiteUser }>(`/api/admin/users/${id}`),

  createUser: (data: CreateUserInput) =>
    adminRequest<{ message: string; user: WebsiteUser }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (id: string, data: UpdateUserInput) =>
    adminRequest<{ message: string; user: WebsiteUser }>(`/api/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  updateUserStatus: (id: string, status: UserStatus) =>
    adminRequest<{ message: string; user: WebsiteUser }>(`/api/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  deleteUser: (id: string) =>
    adminRequest<{ message: string }>(`/api/admin/users/${id}`, {
      method: 'DELETE',
    }),
};
