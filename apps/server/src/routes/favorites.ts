import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  PageIdSchema,
  notFound,
  parseOrThrow,
  unauthorized,
  type Account,
  type FavoriteResponse,
  type FavoritesResponse,
  type OkResponse,
  type PageId,
} from '@tablinum/shared';
import { requireAccount } from '../auth.js';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';

const FavoriteParamsSchema = z.object({ pageId: PageIdSchema });

/**
 * Whose pins, and where.
 *
 * A favorite belongs to a person, so an agent token and an operator credential have none: both
 * are refused rather than handed somebody else's list. The workspace hook already refused a
 * workspace the caller cannot open; this is the second lock behind it.
 */
function pinnerFor(
  ctx: RouteContext,
  request: FastifyRequest,
): { account: Account; workspaceId: string } {
  const account = requireAccount(request);
  const workspaceId = request.workspace.id;
  if (request.principal.admin) return { account, workspaceId };
  const allowed = ctx.deps.accounts.listWorkspacesFor(account.id);
  if (!allowed.some((one) => one.id === workspaceId)) {
    throw unauthorized('You are not in this workspace');
  }
  return { account, workspaceId };
}

/** The page a pin is about, or a 404. A page in another workspace is simply not there. */
async function requirePageId(
  ctx: RouteContext,
  request: FastifyRequest,
  id: string,
): Promise<PageId> {
  const { store } = await partsOf(ctx, request);
  const page = await store.getPageById(id);
  if (page === null) throw notFound(`No page with id ${id}`);
  return page.id;
}

export function registerFavoriteRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { accounts } = ctx.deps;

  app.get(`${API_PREFIX}/favorites`, async (request): Promise<FavoritesResponse> => {
    const { account, workspaceId } = pinnerFor(ctx, request);
    return { favorites: accounts.listFavorites(workspaceId, account.id) };
  });

  app.put(`${API_PREFIX}/favorites/:pageId`, async (request): Promise<FavoriteResponse> => {
    const { account, workspaceId } = pinnerFor(ctx, request);
    const { pageId } = parseOrThrow(FavoriteParamsSchema, request.params, 'page id');
    const known = await requirePageId(ctx, request, pageId);
    return { favorite: accounts.addFavorite(workspaceId, account.id, known) };
  });

  /** Idempotent: unpinning a page that was never pinned is not an error. */
  app.delete(`${API_PREFIX}/favorites/:pageId`, async (request): Promise<OkResponse> => {
    const { account, workspaceId } = pinnerFor(ctx, request);
    const { pageId } = parseOrThrow(FavoriteParamsSchema, request.params, 'page id');
    accounts.removeFavorite(workspaceId, account.id, pageId);
    return { ok: true };
  });
}
