import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'gitdocs.';

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or private mode: preferences simply do not persist */
  }
}

/** useState that survives a reload. */
export function usePersistedState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, initial));

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        writeStored(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  useEffect(() => {
    setValue(readStored(key, initial));
    // Re-reading on key change is the point; `initial` is only a fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, update];
}
