import type { FastifyInstance } from 'fastify';
import { SearchQuerySchema, parseOrThrow, type SearchResponse } from '@gitdocs/shared';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';

const DEFAULT_SEARCH_LIMIT = 20;

export function registerSearchRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(`${API_PREFIX}/search`, async (request): Promise<SearchResponse> => {
    const { search } = await partsOf(ctx, request);
    const query = parseOrThrow(SearchQuerySchema, request.query, 'search query');
    const hits = await search.search(query.q, {
      space: query.space,
      limit: query.limit ?? DEFAULT_SEARCH_LIMIT,
    });
    return { hits };
  });
}
