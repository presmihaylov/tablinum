import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  url: URL;
  body: unknown;
  /** Lower-case names, so a test can look for one without guessing the case. */
  headers: Record<string, string>;
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
  // An upload arrives as it was built, so a test can look at the parts.
  if (init.body instanceof FormData) return init.body;
  if (typeof init.body !== 'string') return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

function headersOf(init: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init.headers ?? {}).forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
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

/** A refusal in the shape the API sends, for a route that must not answer 200. */
export function fail(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** Replaces global fetch with an in-memory router. Call `restore()` when done. */
export function installFetch(routes: Routes): MockServer {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;

  const impl: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(targetOf(input), ORIGIN);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = parseBody(init);
    calls.push({ method, url, body, headers: headersOf(init) });

    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) {
      return json({ error: { code: 'NOT_FOUND', message: `No route for ${method} ${url.pathname}` } }, 404);
    }
    const payload = typeof route === 'function' ? route(url, body) : route;
    // A handler may hand back a whole Response, which is how a test asks for a refusal.
    return payload instanceof Response ? payload : json(payload);
  };

  globalThis.fetch = vi.fn(impl);
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
