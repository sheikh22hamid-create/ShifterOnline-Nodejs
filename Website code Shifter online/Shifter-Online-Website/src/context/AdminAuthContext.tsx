import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminApi, ADMIN_TOKEN_KEY, type AdminUser } from '../lib/adminApi';

interface AdminAuthContextValue {
  admin: AdminUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!token) {
      setIsLoading(false);
      return;
    }

    adminApi
      .me()
      .then(({ admin }) => setAdmin(admin))
      .catch(() => {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdmin(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, admin } = await adminApi.login({ email, password });
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    setAdmin(admin);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdmin(null);
  }, []);

  const value = useMemo(
    () => ({
      admin,
      isLoading,
      login,
      logout,
      isAuthenticated: !!admin,
    }),
    [admin, isLoading, login, logout]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  return ctx;
}
