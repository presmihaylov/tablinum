import type { FastifyInstance } from 'fastify';
import {
  CreateSpaceBodySchema,
  parseOrThrow,
  spaceFileRelPath,
  type SpaceResponse,
  type SpacesResponse,
} from '@gitdocs/shared';
import { API_PREFIX, type RouteContext } from '../context.js';

export function registerSpaceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store } = ctx.deps;

  app.get(`${API_PREFIX}/spaces`, async (): Promise<SpacesResponse> => {
    return { spaces: await store.listSpaces() };
  });

  app.post(`${API_PREFIX}/spaces`, async (request): Promise<SpaceResponse> => {
    const body = parseOrThrow(CreateSpaceBodySchema, request.body, 'space');
    const space = await store.createSpace(body);
    await ctx.wiring.recordMutation({
      files: [spaceFileRelPath(space.slug)],
      message: `Create space ${space.slug}`,
    });
    return { space };
  });
}
