import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@tablinum/shared';
import { API_PREFIX, type RouteContext } from '../context.js';

/** The only endpoint that answers without credentials in every mode. */
export function registerHealthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(`${API_PREFIX}/health`, async (): Promise<HealthResponse> => {
    return { ok: true, version: ctx.version, contentDir: ctx.deps.config.contentDir };
  });
}
