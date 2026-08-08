import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  url: URL;
  body: unknown;
}

export type RouteHandler = (url: URL, body: unknown) => unknown;
export type RouteValue = RouteHandler | Record<string, unknown>;
/** Keys look like `GET /api/v1/tree`. */
export type Routes = Record<string, RouteValue>;

export interface MockServer {
  calls: RecordedCall[];
  restore: () => void;
}

const ORIGIN = 'http://localhost';

function parseBody(init: RequestInit): unknown {
  if (typeof init.body !== 'string') return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

function targetOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload ?? null), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Replaces global fetch with an in-memory router. Call `restore()` when done. */
export function installFetch(routes: Routes): MockServer {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;

  const impl: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(targetOf(input), ORIGIN);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = parseBody(init);
    calls.push({ method, url, body });

    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) {
      return json({ error: { code: 'NOT_FOUND', message: `No route for ${method} ${url.pathname}` } }, 404);
    }
    const payload = typeof route === 'function' ? route(url, body) : route;
    return json(payload);
  };

  globalThis.fetch = vi.fn(impl);
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
