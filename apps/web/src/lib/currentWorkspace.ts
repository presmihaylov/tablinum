import { WORKSPACE_COOKIE } from '@tablinum/shared';
import { readStored, writeStored } from './storage';

/**
 * Which workspace this tab is looking at, as an id. The server takes a slug too, so a value a
 * previous build stored still resolves, but a slug changes on a rename and an id never does.
 *
 * It lives outside React because the API client reads it on every request, and it is mirrored
 * into a cookie because an `<img>` in a page fetches its file with no header of its own.
 */

const KEY = 'workspace';

let current: string | null = readStored<string | null>(KEY, null);

export function currentWorkspace(): string | null {
  return current;
}

export function setCurrentWorkspace(key: string | null): void {
  current = key;
  writeStored(KEY, key);
  writeCookie(key);
}

function writeCookie(key: string | null): void {
  const age = key === null ? 0 : 31536000;
  const value = key === null ? '' : encodeURIComponent(key);
  try {
    document.cookie = `${WORKSPACE_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${age}`;
  } catch {
    /* no document in a worker, and a missing cookie only costs a fallback */
  }
}
