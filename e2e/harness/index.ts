export { BrowserContext, Locator, Page, newSession, type Box, type BrowserCookie, type ContextOptions, type FilePayload } from './browser';
export { Http, HttpResponse, type Cookie, type RequestOptions } from './http';
export { expect } from './expect';

import type { BrowserContext } from './browser';
import type { Cookie } from './http';

export interface StorageState {
  cookies: Cookie[];
  /** Accepted for the specs' empty state; sessions start with no local storage anyway. */
  origins?: unknown[];
}

/** What the `browser` fixture offers: a fresh, isolated session per call. */
export interface Browser {
  newContext(options?: { baseURL?: string; storageState?: StorageState }): Promise<BrowserContext>;
}
