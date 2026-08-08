import type { FastifyInstance } from 'fastify';
import { filtersFromRecord, queryView } from '@gitdocs/core';
import {
  ViewsQuerySchema,
  notFound,
  parseOrThrow,
  parseWhere,
  type PagePath,
  type ViewsResponse,
} from '@gitdocs/shared';
import { API_PREFIX, type RouteContext } from '../context.js';

export function registerViewRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store } = ctx.deps;

  app.get(`${API_PREFIX}/views`, async (request): Promise<ViewsResponse> => {
    const query = parseOrThrow(ViewsQuerySchema, request.query, 'query');
    const dir: PagePath = query.dir;

    const children = await store.listChildren(dir);
    if (children.length === 0 && (await store.getPageByPath(dir)) === null) {
      throw notFound(`No page at path ${dir}`);
    }

    // queryView is the one implementation of view semantics; the MCP server calls it too, and a
    // second copy here drifted from it on filtering, sorting and column order.
    return queryView(children, {
      dir,
      where: filtersFromRecord(parseWhere(query.where)),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      order: query.order ?? 'asc',
    });
  });
}
