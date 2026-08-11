import type { FastifyInstance } from 'fastify';
import type { RescanResponse } from '@tablinum/shared';
import { requireWorkspaceAdmin } from '../auth.js';
import { API_PREFIX, rawPartsOf, type RouteContext } from '../context.js';
import { rescanWorkspace } from '../workspaces.js';

export function registerRescanRoutes(app: FastifyInstance, ctx: RouteContext): void {
  /**
   * Read the working tree back into both indexes, then collect the attachments of pages that
   * are gone. For an operator who rewrote the content directory from outside the server: a
   * restore from a backup, a script, or a checkout of another branch.
   *
   * Admin of this workspace, and nothing weaker. A rescan parses every page file and rewrites
   * the whole search index, so an open one would be a free way to pin the CPU; and the sweep
   * deletes files, which must never happen except on somebody's explicit request.
   *
   * The unfiltered parts, because this belongs to no one viewer: the search index covers the
   * private spaces too, and rebuilding it from a filtered store would empty them out of it.
   */
  app.post(`${API_PREFIX}/rescan`, async (request): Promise<RescanResponse> => {
    // Before the workspace is opened: opening one that is still closed inits its repo and
    // indexes every page in it, and a caller who may not ask for that must not pay for it.
    requireWorkspaceAdmin(ctx.deps.accounts, request, request.workspace);
    const parts = await rawPartsOf(ctx, request);

    const result = await rescanWorkspace(parts);
    request.log.info(
      { workspace: parts.record.slug, pages: result.pages, assets: result.removedAssets.length },
      'rescanned the content directory',
    );
    return result;
  });
}
