import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readStored, writeStored } from './storage';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';
const MODES: ThemeMode[] = ['light', 'dark', 'system'];

interface ThemeContextValue {
  mode: ThemeMode;
  /** What is actually painted right now, after resolving `system`. */
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readMode(): ThemeMode {
  const stored = readStored<string>(STORAGE_KEY, 'system');
  return MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-theme');
      return;
    }
    root.setAttribute('data-theme', mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    writeStored(STORAGE_KEY, next);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  const toggle = useCallback(() => {
    setMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
