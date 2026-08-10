import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateRowBodySchema,
  SetDatabaseBodySchema,
  UpdateRowBodySchema,
  notFound,
  parentPath,
  parseOrThrow,
  segments,
  starterDatabase,
  type DatabaseResponse,
  type Page,
  type PageId,
  type PagePath,
  type PageResponse,
  type RowResponse,
} from '@tablinum/shared';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';
import { agentOf, clientOf } from '../live.js';
import type { ContentStore } from '../deps.js';
import { pageFileVariants } from '../wiring.js';

const IdParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Databases. The schema lives in the database page's frontmatter and every row is one of its
 * child pages, so each endpoint here is a page write and goes through the same commit path as
 * an edit made in the editor.
 */

/** Every file a write under `pagePath` can touch: the page itself and each of its ancestors. */
function plannedFiles(pagePath: PagePath): string[] {
  const out = new Set<string>();
  const parts = segments(pagePath);
  for (let end = 1; end <= parts.length; end += 1) {
    for (const variant of pageFileVariants(parts.slice(0, end).join('/'))) out.add(variant);
  }
  return [...out];
}

async function requirePageIn(store: ContentStore, id: PageId): Promise<Page> {
  const page = await store.getPageById(id);
  if (page === null) throw notFound(`No page with id ${id}`);
  return page;
}

export function registerDatabaseRoutes(app: FastifyInstance, ctx: RouteContext): void {
  /** Commit one page write, plus the parent whose file the write may have promoted. */
  async function commit(
    ctx2: RouteContext,
    request: FastifyRequest,
    page: Page,
    message: string,
  ): Promise<void> {
    const { store, wiring } = await partsOf(ctx2, request);
    const files = new Set(pageFileVariants(page.path));
    const pages: Page[] = [page];
    const parent = parentPath(page.path);
    if (parent !== null) {
      for (const variant of pageFileVariants(parent)) files.add(variant);
      const parentPage = await store.getPageByPath(parent);
      if (parentPage !== null) pages.push(parentPage);
    }
    await wiring.recordMutation({
      pages,
      files: [...files],
      message,
      by: clientOf(request),
      agent: agentOf(request),
    });
  }

  app.get(`${API_PREFIX}/pages/:id/database`, async (request): Promise<DatabaseResponse> => {
    const { store } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const found = await store.getDatabase(id);
    return { database: found.database, rows: found.rows };
  });

  /** Turn a page into a database, or replace the schema and views of one that already is. */
  app.put(`${API_PREFIX}/pages/:id/database`, async (request): Promise<PageResponse> => {
    const { store, wiring } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const before = await requirePageIn(store, id);
    // An empty body turns a plain page into a database with the starter schema, which is what
    // the "Turn into a database" button sends.
    const body =
      request.body === undefined || request.body === null || Object.keys(request.body).length === 0
        ? { database: starterDatabase() }
        : parseOrThrow(SetDatabaseBodySchema, request.body, 'database');

    wiring.markWritten(plannedFiles(before.path));
    const page = await store.setDatabase(id, body.database);
    await commit(ctx, request, page, `Update the database on ${page.path}`);
    return { page };
  });

  /** Make it a plain page again. The rows stay: they were child pages all along. */
  app.delete(`${API_PREFIX}/pages/:id/database`, async (request): Promise<PageResponse> => {
    const { store, wiring } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const before = await requirePageIn(store, id);
    wiring.markWritten(plannedFiles(before.path));
    const page = await store.removeDatabase(id);
    await commit(ctx, request, page, `Remove the database on ${page.path}`);
    return { page };
  });

  app.post(`${API_PREFIX}/pages/:id/database/rows`, async (request, reply): Promise<RowResponse> => {
    const { store, wiring } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const body = parseOrThrow(CreateRowBodySchema, request.body ?? {}, 'row');
    const database = await requirePageIn(store, id);
    wiring.markWritten(plannedFiles(`${database.path}/x`));

    const row = await store.createRow(id, body);
    const page = await requirePageIn(store, row.id);
    await commit(ctx, request, page, `Create ${page.path}`);
    reply.status(201);
    return { row };
  });

  /** Edit the cells of one row. The row's own page body is edited through the page endpoints. */
  app.patch(`${API_PREFIX}/pages/:id/row`, async (request): Promise<RowResponse> => {
    const { store, wiring } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const body = parseOrThrow(UpdateRowBodySchema, request.body, 'row');
    const before = await requirePageIn(store, id);
    wiring.markWritten(plannedFiles(before.path));

    const row = await store.updateRow(id, body);
    const page = await requirePageIn(store, row.id);
    await commit(ctx, request, page, `Update ${page.path}`);
    return { row };
  });
}
