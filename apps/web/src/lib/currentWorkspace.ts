import { WORKSPACE_COOKIE } from '@gitdocs/shared';
import { readStored, writeStored } from './storage';

/**
 * Which workspace this tab is looking at.
 *
 * It lives outside React because the API client reads it on every request, and it is mirrored
 * into a cookie because an `<img>` in a page fetches its file with no header of its own.
 */

const KEY = 'workspace';

let current: string | null = readStored<string | null>(KEY, null);

export function currentWorkspace(): string | null {
  return current;
}

export function setCurrentWorkspace(slug: string | null): void {
  current = slug;
  writeStored(KEY, slug);
  writeCookie(slug);
}

function writeCookie(slug: string | null): void {
  const age = slug === null ? 0 : 31536000;
  const value = slug === null ? '' : encodeURIComponent(slug);
  try {
    document.cookie = `${WORKSPACE_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${age}`;
  } catch {
    /* no document in a worker, and a missing cookie only costs a fallback */
  }
}
