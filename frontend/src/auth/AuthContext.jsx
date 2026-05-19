import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';
import { setAccessToken } from '../api/client';

const AuthContext = createContext(null);

const STATUS = Object.freeze({
  LOADING: 'loading',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(STATUS.LOADING);

  // On mount, try refreshing using the httpOnly cookie. If it works → fetch /me.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await authApi.refresh();
        const profile = await authApi.me();
        if (!cancelled) {
          setUser(profile);
          setStatus(STATUS.AUTHENTICATED);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setStatus(STATUS.UNAUTHENTICATED);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (payload) => {
    const data = await authApi.login(payload);
    setUser(data.user);
    setStatus(STATUS.AUTHENTICATED);
    return data;
  }, []);

  const registerTenant = useCallback(async (payload) => {
    const data = await authApi.registerTenant(payload);
    // After register we have token but not the full profile — fetch it.
    const profile = await authApi.me();
    setUser(profile);
    setStatus(STATUS.AUTHENTICATED);
    return { ...data, profile };
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus(STATUS.UNAUTHENTICATED);
    }
  }, []);

  const hasPermission = useCallback(
    (code) => !!user && Array.isArray(user.permissions) && user.permissions.includes(code),
    [user],
  );

  const value = useMemo(
    () => ({ user, status, login, registerTenant, logout, hasPermission }),
    [user, status, login, registerTenant, logout, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export const AUTH_STATUS = STATUS;
