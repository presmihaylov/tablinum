import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Account } from '@tablinum/shared';
import { onUnauthorized } from '../api/client';
import { useAuthState } from '../api/hooks';
import { setAccountIdentity } from './identity';

interface AuthContextValue {
  /** True once any request has come back 401: the shell is replaced by the login screen. */
  loginRequired: boolean;
  markAuthenticated: () => void;
  /** The signed-in account. Null means the login screen, because every session names somebody. */
  user: Account | null;
  /** True while nobody has claimed the server, so this visitor creates the first admin. */
  setupRequired: boolean;
  /** False until the first /auth/state answer lands. */
  ready: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [loginRequired, setLoginRequired] = useState(false);
  const state = useAuthState();

  useEffect(() => onUnauthorized(() => setLoginRequired(true)), []);

  const user = state.data?.user ?? null;

  // Set during render, not in an effect: a child's effect runs first, and the live channel
  // says hello from a child effect.
  setAccountIdentity(user);

  const value = useMemo<AuthContextValue>(
    () => ({
      loginRequired,
      markAuthenticated: () => {
        setLoginRequired(false);
        void client.invalidateQueries();
      },
      user,
      setupRequired: state.data?.setupRequired ?? false,
      ready: state.data !== undefined,
    }),
    [loginRequired, client, user, state.data],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
