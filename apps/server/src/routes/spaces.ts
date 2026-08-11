import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateSpaceBodySchema,
  DeleteSpaceQuerySchema,
  SpaceSlugSchema,
  UpdateSpaceBodySchema,
  notFound,
  parseOrThrow,
  spaceFileRelPath,
  unauthorized,
  type DeleteSpaceResponse,
  type SpaceResponse,
  type SpacesResponse,
} from '@tablinum/shared';
import { requireAdmin } from '../auth.js';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';
import { viewerOf } from '../private.js';
import { pageFileVariants } from '../wiring.js';

const SlugParamsSchema = z.object({ slug: SpaceSlugSchema });

/** Where the pages of a deleted space went. There is no soft delete, so git is the only copy. */
function recoveryNote(slug: string, wasPrivate: boolean): string {
  if (wasPrivate) {
    return `A private space is kept out of git, so no commit holds ${slug}. The files are gone.`;
  }
  return `Every page was a file in git. Find them again with: git log --diff-filter=D -- ${slug}/`;
}

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

  app.delete(`${API_PREFIX}/spaces/:slug`, async (request): Promise<DeleteSpaceResponse> => {
    // A space delete takes every page in it, so it asks for more than an ordinary session.
    requireAdmin(request);
    const { record, store, wiring, live } = await partsOf(ctx, request);
    const { slug } = parseOrThrow(SlugParamsSchema, request.params, 'params');
    const query = parseOrThrow(DeleteSpaceQuerySchema, request.query, 'query');

    // Read first: afterwards neither the owner nor the page ids are anywhere to be found.
    const space = (await store.listSpaces()).find((candidate) => candidate.slug === slug);
    if (space === undefined) throw notFound(`No space ${slug}`);
    const victims = (await store.listPages()).filter((page) => page.space === slug);

    const files = new Set<string>([spaceFileRelPath(slug)]);
    for (const victim of victims) {
      for (const variant of pageFileVariants(victim.path)) files.add(variant);
    }
    wiring.markWritten(files);

    const deleted = await store.deleteSpace(slug, query.recursive === true);

    // Comments and pins live in the account database, so no foreign key takes them with the files.
    const victimIds = victims.map((victim) => victim.id);
    ctx.deps.accounts.deleteThreadsForPages(record.id, victimIds);
    ctx.deps.accounts.deleteFavoritesForPages(record.id, victimIds);
    for (const victimId of victimIds) ctx.cursors.clearPage(request.workspace.id, victimId);

    // `removedSpaces` is what drops the `.git/info/exclude` line a private space was created with.
    await wiring.recordMutation({
      removedIds: victimIds,
      removedPaths: deleted,
      removedSpaces: [slug],
      files: [...files],
      message: `Delete space ${slug}`,
    });
    await live.spacesChanged();

    const wasPrivate = space.owner !== undefined;
    return {
      slug,
      deleted,
      recoverable: !wasPrivate,
      recovery: recoveryNote(slug, wasPrivate),
    };
  });
}
