import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateSpaceBodySchema,
  SpaceSlugSchema,
  UpdateSpaceBodySchema,
  parseOrThrow,
  spaceFileRelPath,
  unauthorized,
  type SpaceResponse,
  type SpacesResponse,
} from '@tablinum/shared';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';
import { viewerOf } from '../private.js';

const SlugParamsSchema = z.object({ slug: SpaceSlugSchema });

export function registerSpaceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(`${API_PREFIX}/spaces`, async (request): Promise<SpacesResponse> => {
    const { store } = await partsOf(ctx, request);
    return { spaces: await store.listSpaces() };
  });

  app.post(`${API_PREFIX}/spaces`, async (request): Promise<SpaceResponse> => {
    const { store, git, live, wiring } = await partsOf(ctx, request);
    const body = parseOrThrow(CreateSpaceBodySchema, request.body, 'space');

    const owner = body.private === true ? viewerOf(request) : null;
    if (body.private === true && owner === null) {
      throw unauthorized('Only a signed-in person can have a private space');
    }
    // The exclude line goes in first. Written afterwards, there would be a moment where the
    // debounced autocommit could stage the space file and put the slug in the history for good.
    if (owner !== null) await git.excludePath(body.slug);

    const space = await store.createSpace(body, owner ?? undefined);
    // The open sockets learn about the new space before its home page is announced on them.
    if (owner !== null) await live.spacesChanged();

    // The store gives every new space a home page; index and commit it with the space file.
    const home = await store.getPageByPath(space.slug);
    await wiring.recordMutation({
      files: [spaceFileRelPath(space.slug)],
      pages: home ? [home] : [],
      message: `Create space ${space.slug}`,
    });
    return { space };
  });

  app.patch(`${API_PREFIX}/spaces/:slug`, async (request): Promise<SpaceResponse> => {
    const { store, wiring } = await partsOf(ctx, request);
    const { slug } = parseOrThrow(SlugParamsSchema, request.params, 'params');
    const body = parseOrThrow(UpdateSpaceBodySchema, request.body, 'space');
    const space = await store.updateSpace(slug, body);
    await wiring.recordMutation({
      files: [spaceFileRelPath(space.slug)],
      message: `Update space ${space.slug}`,
    });
    return { space };
  });
}
