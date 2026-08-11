import type { PageId, PagePath, SearchQuery } from '@tablinum/shared';

/** The prefix every comment thread hangs off. Named once so no caller writes it out again. */
const COMMENTS = ['comments'] as const;

/** Every query key in the app. Keep the prefixes stable: invalidation matches on them. */
export const qk = {
  health: ['health'] as const,
  authState: ['auth', 'state'] as const,
  users: ['users'] as const,
  invites: ['invites'] as const,
  agents: ['agents'] as const,
  webhookSigning: ['webhook-signing'] as const,
  emoji: ['emoji'] as const,
  workspaces: ['workspaces'] as const,
  workspaceMembers: (id: string) => ['workspaces', id, 'members'] as const,
  slack: ['me', 'slack'] as const,
  handlePreview: ['me', 'handle'] as const,
  invitePreview: (token: string) => ['invite', token] as const,
  spaces: ['spaces'] as const,
  tree: ['tree'] as const,
  pages: ['pages'] as const,
  page: (id: PageId) => ['page', 'id', id] as const,
  pageByPath: (path: PagePath) => ['page', 'path', path] as const,
  search: (query: SearchQuery) => ['search', query.q, query.space ?? ''] as const,
  backlinks: (id: PageId) => ['backlinks', id] as const,
  comments: (id: PageId) => [...COMMENTS, id] as const,
  /** Every thread on every page. A handle rename changes text inside them all. */
  allComments: COMMENTS,
  favorites: ['favorites'] as const,
  database: (id: PageId) => ['database', id] as const,
  history: (id: PageId, limit?: number) => ['history', id, limit ?? 0] as const,
  revision: (id: PageId, sha: string) => ['revision', id, sha] as const,
  gitStatus: ['git', 'status'] as const,
};

/** Prefixes touched by any content mutation. */
export const contentPrefixes = [qk.tree, qk.pages, qk.spaces, ['page'], ['search'], ['database']];
