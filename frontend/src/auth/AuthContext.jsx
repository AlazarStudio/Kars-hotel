import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';
import * as superAdminApi from '../api/superadmin';
import { setAccessToken, setImpersonatingFlag } from '../api/client';

const AuthContext = createContext(null);

const STATUS = Object.freeze({
  LOADING: 'loading',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(STATUS.LOADING);
  const [impersonatedTenant, setImpersonatedTenant] = useState(null);

  // On mount: try refresh with the httpOnly cookie, then /me.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await authApi.refresh();
        const profile = await authApi.me();
        if (!cancelled) { setUser(profile); setStatus(STATUS.AUTHENTICATED); }
      } catch {
        if (!cancelled) { setUser(null); setStatus(STATUS.UNAUTHENTICATED); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (payload) => {
    const data = await authApi.login(payload);
    setUser(data.user);
    setStatus(STATUS.AUTHENTICATED);
    return data;
  }, []);

  const registerTenant = useCallback(async (payload) => {
    const data = await authApi.registerTenant(payload);
    const profile = await authApi.me();
    setUser(profile);
    setStatus(STATUS.AUTHENTICATED);
    return { ...data, profile };
  }, []);

  const logout = useCallback(async () => {
    setImpersonatingFlag(false);
    try { await authApi.logout(); } finally {
      setAccessToken(null);
      setUser(null);
      setImpersonatedTenant(null);
      setStatus(STATUS.UNAUTHENTICATED);
    }
  }, []);

  const hasPermission = useCallback(
    (code) => !!user && Array.isArray(user.permissions) && user.permissions.includes(code),
    [user],
  );

  /**
   * Start impersonating: swap access token to tenant owner's token.
   * IMPORTANT: we set the impersonating flag BEFORE changing the token
   * so the 401 interceptor never auto-refreshes (which would rotate the
   * admin's refresh cookie and make exit impossible).
   */
  const impersonate = useCallback(async (tenant) => {
    const result = await superAdminApi.impersonate(tenant.id);
    setImpersonatingFlag(true);        // block auto-refresh from this point
    setAccessToken(result.accessToken);
    setImpersonatedTenant(tenant);
  }, []);

  /**
   * Exit impersonation: clear the flag first, then restore admin token
   * via the still-intact httpOnly refresh cookie.
   */
  const exitImpersonation = useCallback(async () => {
    setImpersonatingFlag(false);       // re-enable auto-refresh BEFORE refreshing
    try {
      await authApi.refresh();         // uses admin's refresh cookie → new admin token
      const profile = await authApi.me();
      setUser(profile);
    } finally {
      setImpersonatedTenant(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      login,
      registerTenant,
      logout,
      hasPermission,
      impersonatedTenant,
      impersonate,
      exitImpersonation,
      isSuperAdmin: user?.isSuperAdmin === true,
      isImpersonating: impersonatedTenant !== null,
    }),
    [user, status, login, registerTenant, logout, hasPermission, impersonatedTenant, impersonate, exitImpersonation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export const AUTH_STATUS = STATUS;
