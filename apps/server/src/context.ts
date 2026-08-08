import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from './deps.js';
import type { Wiring } from './wiring.js';

/** Everything a route module needs. Passed explicitly so nothing is decorated globally. */
export interface RouteContext {
  deps: ServerDeps;
  wiring: Wiring;
  version: string;
}

/** Prefix every endpoint in the contract lives under. */
export const API_PREFIX = '/api/v1';

// Keeps buildApp()'s signature free of extra return values while still letting the bootstrap
// reach the Wiring the routes use, which is what the filesystem watcher must share.
const CONTEXTS = new WeakMap<FastifyInstance, RouteContext>();

export function rememberContext(app: FastifyInstance, ctx: RouteContext): void {
  CONTEXTS.set(app, ctx);
}

/** The context buildApp() built for this instance, or null for a foreign instance. */
export function contextOf(app: FastifyInstance): RouteContext | null {
  return CONTEXTS.get(app) ?? null;
}
