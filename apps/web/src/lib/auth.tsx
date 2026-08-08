import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onUnauthorized } from '../api/client';

interface AuthContextValue {
  /** True once any request has come back 401: the shell is replaced by the login screen. */
  loginRequired: boolean;
  markAuthenticated: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [loginRequired, setLoginRequired] = useState(false);

  useEffect(() => onUnauthorized(() => setLoginRequired(true)), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loginRequired,
      markAuthenticated: () => {
        setLoginRequired(false);
        void client.invalidateQueries();
      },
    }),
    [loginRequired, client],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
