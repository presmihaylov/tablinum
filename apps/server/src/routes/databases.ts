import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateRowBodySchema,
  RowIdSchema,
  SetDatabaseBodySchema,
  UpdateRowBodySchema,
  notFound,
  parseOrThrow,
  starterDatabase,
  type DatabaseResponse,
  type OkResponse,
  type Page,
  type PageId,
  type PageResponse,
  type RowResponse,
} from '@tablinum/shared';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';
import { agentOf, clientOf } from '../live.js';
import type { ContentStore } from '../deps.js';
import { pageFileVariants } from '../wiring.js';

const IdParamsSchema = z.object({ id: z.string().min(1) });
const RowParamsSchema = z.object({ id: z.string().min(1), rowId: RowIdSchema });

/**
 * Databases. The schema and the rows both live in the database page's frontmatter, so every
 * endpoint here writes exactly one file and goes through the same commit path as an edit made
 * in the editor.
 */

async function requirePageIn(store: ContentStore, id: PageId): Promise<Page> {
  const page = await store.getPageById(id);
  if (page === null) throw notFound(`No page with id ${id}`);
  return page;
}

export function registerDatabaseRoutes(app: FastifyInstance, ctx: RouteContext): void {
  /** Commit the one page the write touched. */
  async function commit(request: FastifyRequest, page: Page, message: string): Promise<void> {
    const { wiring } = await partsOf(ctx, request);
    await wiring.recordMutation({
      pages: [page],
      files: pageFileVariants(page.path),
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
    // the slash commands send.
    const body =
      request.body === undefined || request.body === null || Object.keys(request.body).length === 0
        ? { database: starterDatabase() }
        : parseOrThrow(SetDatabaseBodySchema, request.body, 'database');

    wiring.markWritten(pageFileVariants(before.path));
    const page = await store.setDatabase(id, body.database);
    await commit(request, page, `Update the database on ${page.path}`);
    return { page };
  });

  /** Make it a plain page again. The rows are records inside the file, so they go with it. */
  app.delete(`${API_PREFIX}/pages/:id/database`, async (request): Promise<PageResponse> => {
    const { store, wiring } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const before = await requirePageIn(store, id);
    wiring.markWritten(pageFileVariants(before.path));
    const page = await store.removeDatabase(id);
    await commit(request, page, `Remove the database on ${page.path}`);
    return { page };
  });

  app.post(`${API_PREFIX}/pages/:id/database/rows`, async (request, reply): Promise<RowResponse> => {
    const { store, wiring } = await partsOf(ctx, request);
    const { id } = parseOrThrow(IdParamsSchema, request.params, 'params');
    const body = parseOrThrow(CreateRowBodySchema, request.body ?? {}, 'row');
    const before = await requirePageIn(store, id);
    wiring.markWritten(pageFileVariants(before.path));

    const row = await store.createRow(id, body);
    const page = await requirePageIn(store, id);
    await commit(request, page, `Add a row to ${page.path}`);
    reply.status(201);
    return { row };
  });

  /** Edit the cells of one row, its title, or both. */
  app.patch(
    `${API_PREFIX}/pages/:id/database/rows/:rowId`,
    async (request): Promise<RowResponse> => {
      const { store, wiring } = await partsOf(ctx, request);
      const { id, rowId } = parseOrThrow(RowParamsSchema, request.params, 'params');
      const body = parseOrThrow(UpdateRowBodySchema, request.body, 'row');
      const before = await requirePageIn(store, id);
      wiring.markWritten(pageFileVariants(before.path));

      const row = await store.updateRow(id, rowId, body);
      const page = await requirePageIn(store, id);
      await commit(request, page, `Update a row on ${page.path}`);
      return { row };
    },
  );

  app.delete(
    `${API_PREFIX}/pages/:id/database/rows/:rowId`,
    async (request): Promise<OkResponse> => {
      const { store, wiring } = await partsOf(ctx, request);
      const { id, rowId } = parseOrThrow(RowParamsSchema, request.params, 'params');
      const before = await requirePageIn(store, id);
      wiring.markWritten(pageFileVariants(before.path));

      await store.deleteRow(id, rowId);
      const page = await requirePageIn(store, id);
      await commit(request, page, `Delete a row on ${page.path}`);
      return { ok: true };
    },
  );
}
