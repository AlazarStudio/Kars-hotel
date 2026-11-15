import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

export const AUTH_STATUS = Object.freeze({
  LOADING: 'loading',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
  // Вход вкладки сменился или кончился — работа в ней остановлена (api/session-refresh.js).
  STOPPED: 'stopped',
});

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
