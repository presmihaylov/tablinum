import type { PageId, PagePath, SearchQuery, ViewsQuery } from '@gitdocs/shared';

/** Every query key in the app. Keep the prefixes stable: invalidation matches on them. */
export const qk = {
  health: ['health'] as const,
  spaces: ['spaces'] as const,
  tree: ['tree'] as const,
  pages: ['pages'] as const,
  page: (id: PageId) => ['page', 'id', id] as const,
  pageByPath: (path: PagePath) => ['page', 'path', path] as const,
  search: (query: SearchQuery) => ['search', query.q, query.space ?? '', query.tag ?? ''] as const,
  backlinks: (id: PageId) => ['backlinks', id] as const,
  history: (id: PageId, limit?: number) => ['history', id, limit ?? 0] as const,
  revision: (id: PageId, sha: string) => ['revision', id, sha] as const,
  views: (query: ViewsQuery) =>
    ['views', query.dir, query.where ?? '', query.sort ?? '', query.order ?? 'asc'] as const,
  gitStatus: ['git', 'status'] as const,
};

/** Prefixes touched by any content mutation. */
export const contentPrefixes = [qk.tree, qk.pages, qk.spaces, ['page'], ['views'], ['search']];
