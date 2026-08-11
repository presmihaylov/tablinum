import type { FastifyInstance } from 'fastify';
import { SearchQuerySchema, parseOrThrow, spaceOf, type SearchResponse } from '@tablinum/shared';
import { API_PREFIX, rawPartsOf, type RouteContext } from '../context.js';
import { hiddenSpacesFor, viewerOf } from '../private.js';

const DEFAULT_SEARCH_LIMIT = 20;

export function registerSearchRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(`${API_PREFIX}/search`, async (request): Promise<SearchResponse> => {
    // The unguarded store on purpose: the hidden set is exactly what the guard would remove.
    const { search, store } = await rawPartsOf(ctx, request);
    const query = parseOrThrow(SearchQuerySchema, request.query, 'search query');
    const hits = await search.search(query.q, {
      space: query.space,
      limit: query.limit ?? DEFAULT_SEARCH_LIMIT,
      fields: query.fields,
    });
    // One index holds every page in the workspace, private ones included, so the hits are
    // filtered here rather than at write time.
    const hidden = await hiddenSpacesFor(store, viewerOf(request));
    return { hits: hits.filter((hit) => !hidden.has(spaceOf(hit.path))) };
  });
}
