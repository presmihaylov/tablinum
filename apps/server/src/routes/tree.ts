import type { FastifyInstance } from 'fastify';
import type { TreeResponse } from '@gitdocs/shared';
import { API_PREFIX, type RouteContext } from '../context.js';

export function registerTreeRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(`${API_PREFIX}/tree`, async (): Promise<TreeResponse> => {
    return { spaces: await ctx.deps.store.getTree() };
  });
}
