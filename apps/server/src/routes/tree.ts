import type { FastifyInstance } from 'fastify';
import type { TreeResponse } from '@gitdocs/shared';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';

export function registerTreeRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(`${API_PREFIX}/tree`, async (request): Promise<TreeResponse> => {
    const { store } = await partsOf(ctx, request);
    return { spaces: await store.getTree() };
  });
}
