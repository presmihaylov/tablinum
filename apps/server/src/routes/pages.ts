import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreatePageBodySchema,
  DeletePageQuerySchema,
  HistoryQuerySchema,
  PagesQuerySchema,
  SPACE_FILE,
  SetCursorBodySchema,
  UpdatePageBodySchema,
  assertValidPagePath,
  isDescendantOf,
  notFound,
  parentPath,
  parseOrThrow,
  replacePathPrefix,
  segments,
  type CursorResponse,
  type PagePath,
  type BacklinksResponse,
  type DeletePageResponse,
  type HistoryResponse,
  type Page,
  type PageId,
  type PageListResponse,
  type PageResponse,
  type RevisionContentResponse,
} from '@tablinum/shared';
import { writerOf } from '../auth.js';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';
import { clampedTo, ownerKey } from '../cursors.js';
import { agentOf, clientOf, type LiveHub } from '../live.js';
import type { ContentStore } from '../deps.js';
import { contentRelPath, pageFileVariants } from '../wiring.js';

const DEFAULT_HISTORY_LIMIT = 50;

const IdParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Every file a write to `pagePath` could touch: the page itself in either form, each ancestor
 * in either form (a write promotes them), and the space descriptor. Marked before the store
 * runs, because the watcher can see the file land while the store is still awaiting.
 */
function plannedFiles(pagePath: PagePath): string[] {
  const out = new Set<string>();
  for (const path of [...ancestorPaths(pagePath), pagePath]) {
    for (const variant of pageFileVariants(path)) out.add(variant);
  }
  out.add(`${segments(pagePath)[0] ?? ''}/${SPACE_FILE}`);
  return [...out];
}

/** Every page above `pagePath`, outermost first. */
function ancestorPaths(pagePath: PagePath): PagePath[] {
  const parts = segments(pagePath);
  const out: PagePath[] = [];
  for (let end = 1; end < parts.length; end += 1) {
    out.push(assertValidPagePath(parts.slice(0, end).join('/')));
  }
  return out;
}

const RevisionParamsSchema = z.object({
  id: z.string().min(1),
  sha: z.string().regex(/^[0-9a-fA-F]{4,64}$/, 'Expected a git object id in hexadecimal'),
});

/** The page behind an id, or a 404. Takes the store, because it is per workspace. */
async function requirePageIn(store: ContentStore, id: PageId): Promise<Page> {
  const page = await store.getPageById(id);
  if (page === null) throw notFound(`No page with id ${id}`);
  return page;
}

/**
 * Sit an agent on the page it just worked on, so the people reading it see it arrive.
 * A person needs none of this: a browser announces itself over the live socket.
 */
function seatAgent(live: LiveHub, request: FastifyRequest, path: PagePath, editing: boolean): void {
  const agent = agentOf(request);
  if (agent === null) return;
  live.noteAgent(agent, path, editing);
}

export function registerPageRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(
    `${API_PREFIX}/pages`,
    async (request): Promise<PageResponse | PageListResponse> => {
      const { store, live } = await partsOf(ctx, request);
      const query = parseOrThrow(PagesQuerySchema, request.query, 'query');
      if (query.path === undefined) return { pages: await store.listPages() };
      const page = await store.getPageByPath(query.path);
      if (page === null) throw notFound(`No page at path ${query.path}`);
      seatAgent(live, request, page.path, false);
      return { page };
    },
  );

  app.get(`${API_PREFIX}/pages/:id`, async (request): Promise<PageResponse> => {
    const { store, live } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const page = await requirePageIn(store, id);
    seatAgent(live, request, page.path, false);
    return { page };
  });

  app.post(`${API_PREFIX}/pages`, async (request, reply): Promise<PageResponse> => {
    const { store, wiring, live } = await partsOf(ctx, request);
    const body = parseOrThrow(CreatePageBodySchema, request.body, 'page');
    wiring.markWritten(plannedFiles(body.path));
    const page = await store.createPage(body);

    const files = new Set(pageFileVariants(page.path));
    const affected: Page[] = [page];

    // A deep create writes every missing ancestor, and the first child moves an existing
    // ancestor from `foo.md` to `foo/index.md`, so each one has to be indexed too.
    for (const ancestor of ancestorPaths(page.path)) {
      for (const variant of pageFileVariants(ancestor)) files.add(variant);
      const ancestorPage = await store.getPageByPath(ancestor);
      if (ancestorPage !== null) affected.push(ancestorPage);
    }

    // The seat comes before the broadcast, so the presence chip and the new text land together.
    seatAgent(live, request, page.path, true);
    await wiring.recordMutation({
      pages: affected,
      files: [...files],
      message: `Create ${page.path}`,
      by: clientOf(request),
      agent: agentOf(request),
    });
    ctx.mentions.pageSaved({ page, before: null, by: writerOf(request) });

    reply.status(201);
    return { page };
  });

  app.patch(`${API_PREFIX}/pages/:id`, async (request): Promise<PageResponse> => {
    const { store, wiring, live } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const patch = parseOrThrow(UpdatePageBodySchema, request.body, 'patch');
    const before = await requirePageIn(store, id);
    wiring.markWritten(plannedFiles(before.path));
    if (patch.path !== undefined) wiring.markWritten(plannedFiles(patch.path));
    const page = await store.updatePage(id, patch);

    const files = new Set([...pageFileVariants(before.path), ...pageFileVariants(page.path)]);
    const affected = new Map<PageId, Page>([[page.id, page]]);

    if (page.path !== before.path) {
      await collectMoveFallout(store, before.path, page.path, files, affected);
    }

    seatAgent(live, request, page.path, true);
    await wiring.recordMutation({
      pages: [...affected.values()],
      files: [...files],
      message: page.path === before.path ? `Update ${page.path}` : `Move ${before.path} to ${page.path}`,
      by: clientOf(request),
      agent: agentOf(request),
      ...(page.path === before.path ? {} : { removedPaths: [before.path] }),
    });
    ctx.mentions.pageSaved({ page, before: before.markdown, by: writerOf(request) });

    return { page };
  });

  /** A move rewrites every descendant path and can promote or demote either parent. */
  async function collectMoveFallout(
    store: ContentStore,
    fromPath: string,
    toPath: string,
    files: Set<string>,
    affected: Map<PageId, Page>,
  ): Promise<void> {
    for (const parent of [parentPath(fromPath), parentPath(toPath)]) {
      if (parent === null) continue;
      for (const variant of pageFileVariants(parent)) files.add(variant);
      const parentPage = await store.getPageByPath(parent);
      if (parentPage !== null) affected.set(parentPage.id, parentPage);
    }

    for (const summary of await store.listPages()) {
      if (!isDescendantOf(summary.path, toPath)) continue;
      for (const variant of pageFileVariants(summary.path)) files.add(variant);
      for (const variant of pageFileVariants(replacePathPrefix(summary.path, toPath, fromPath))) {
        files.add(variant);
      }
      const moved = await store.getPageById(summary.id);
      if (moved !== null) affected.set(moved.id, moved);
    }
  }

  app.delete(`${API_PREFIX}/pages/:id`, async (request): Promise<DeletePageResponse> => {
    const { record, store, wiring, live } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const query = parseOrThrow(DeletePageQuerySchema, request.query, 'query');
    const page = await requirePageIn(store, id);

    // Collect the victims before the delete: afterwards their ids are gone from the store.
    const summaries = await store.listPages();
    const victims = summaries.filter(
      (summary) => summary.id === id || isDescendantOf(summary.path, page.path),
    );

    for (const victim of victims) wiring.markWritten(plannedFiles(victim.path));
    const deleted = await store.deletePage(id, query.recursive === true);

    // Comments and pins live in the account database, so no foreign key takes them with the file.
    const victimIds = victims.map((victim) => victim.id);
    ctx.deps.accounts.deleteThreadsForPages(record.id, victimIds);
    ctx.deps.accounts.deleteFavoritesForPages(record.id, victimIds);
    for (const victimId of victimIds) ctx.cursors.clearPage(request.workspace.id, victimId);

    const files = new Set<string>();
    for (const victim of victims) {
      for (const variant of pageFileVariants(victim.path)) files.add(variant);
    }
    for (const path of deleted) {
      for (const variant of pageFileVariants(path)) files.add(variant);
    }

    // Removing the last child demotes the parent back to a leaf file.
    const affected: Page[] = [];
    const parent = parentPath(page.path);
    if (parent !== null) {
      for (const variant of pageFileVariants(parent)) files.add(variant);
      const parentPage = await store.getPageByPath(parent);
      if (parentPage !== null) affected.push(parentPage);
    }

    await wiring.recordMutation({
      pages: affected,
      removedIds: victims.map((victim) => victim.id),
      removedPaths: deleted,
      files: [...files],
      message: `Delete ${page.path}`,
      by: clientOf(request),
      agent: agentOf(request),
    });
    // The page it was on may be one of these, and there is nothing left to sit on.
    const caller = agentOf(request);
    if (caller !== null) live.dropAgent(caller.id);

    return { deleted };
  });

  app.get(`${API_PREFIX}/pages/:id/cursor`, async (request): Promise<CursorResponse> => {
    const { store } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const page = await requirePageIn(store, id);
    const held = ctx.cursors.get(ownerKey(request.principal), request.workspace.id, page.id);
    return { cursor: held === null ? null : clampedTo(held, page.markdown) };
  });

  app.put(`${API_PREFIX}/pages/:id/cursor`, async (request): Promise<CursorResponse> => {
    const { store, live } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const body = parseOrThrow(SetCursorBodySchema, request.body, 'cursor');
    const page = await requirePageIn(store, id);

    ctx.cursors.sweep();
    const cursor = ctx.cursors.set(
      ownerKey(request.principal),
      request.workspace.id,
      page,
      { anchor: body.anchor, head: body.head ?? body.anchor },
    );

    // A caret on screen is the point of this: people watch an agent work rather than find out
    // afterwards. Seating it first keeps the presence chip and the caret in step.
    seatAgent(live, request, page.path, false);
    const agent = agentOf(request);
    if (agent !== null) live.agentCaret(agent, page.path, cursor.anchor, cursor.head);

    return { cursor };
  });

  app.get(`${API_PREFIX}/pages/:id/backlinks`, async (request): Promise<BacklinksResponse> => {
    const { store } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    await requirePageIn(store, id);
    return { backlinks: await store.getBacklinks(id) };
  });

  app.get(`${API_PREFIX}/pages/:id/history`, async (request): Promise<HistoryResponse> => {
    const { store, git } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const query = parseOrThrow(HistoryQuerySchema, request.query, 'query');
    const page = await requirePageIn(store, id);
    const relFile = contentRelPath(store.contentDir, page.filePath);
    return { revisions: await git.history(relFile, query.limit ?? DEFAULT_HISTORY_LIMIT) };
  });

  app.get(
    `${API_PREFIX}/pages/:id/revisions/:sha`,
    async (request): Promise<RevisionContentResponse> => {
      const { store, git } = await partsOf(ctx, request);
      const { id, sha } = parseOrThrow(RevisionParamsSchema, request.params, 'params');
      const page = await requirePageIn(store, id);
      const relFile = contentRelPath(store.contentDir, page.filePath);
      const raw = await git.readFileAt(relFile, sha);
      if (raw === null) throw notFound(`Revision ${sha} does not contain ${page.path}`);
      const parsed = store.parsePageFile(raw);
      return { markdown: parsed.markdown, frontmatter: parsed.frontmatter };
    },
  );
}
