import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { moveRowBefore } from '@tablinum/shared';
import type {
  AssetResponse,
  BacklinksResponse,
  CommentThreadResponse,
  CommentThreadsResponse,
  CreatePageBody,
  CreateRowBody,
  CreateSpaceBody,
  CreateThreadBody,
  Database,
  DatabaseResponse,
  DeleteCommentResponse,
  DeletePageResponse,
  FavoriteResponse,
  FavoritesResponse,
  HistoryResponse,
  OkResponse,
  PageId,
  PageListResponse,
  PagePath,
  PageResponse,
  ReplyBody,
  RescanResponse,
  RevisionContentResponse,
  RowProps,
  RowResponse,
  SearchQuery,
  SearchResponse,
  SpaceResponse,
  SpacesResponse,
  TreeResponse,
  UpdateCommentBody,
  UpdatePageBody,
  UpdateRowBody,
  UpdateSpaceBody,
} from '@tablinum/shared';
import { ApiError, api } from './client';
import { contentPrefixes, qk } from './keys';

/**
 * Everything the git repo holds: spaces, the page tree, pages, search, comments, favorites
 * and databases. `invalidateContent` lives here because these are the caches it drops, so git
 * and handles call in rather than repeat the prefix list.
 */

/** Drop every cached content query. Called after any write and after a sync. */
export function invalidateContent(client: QueryClient): void {
  for (const prefix of contentPrefixes) {
    void client.invalidateQueries({ queryKey: prefix });
  }
  void client.invalidateQueries({ queryKey: qk.gitStatus });
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export function useSpaces(): UseQueryResult<SpacesResponse, ApiError> {
  return useQuery({ queryKey: qk.spaces, queryFn: ({ signal }) => api.listSpaces(signal) });
}

export function useTree(): UseQueryResult<TreeResponse, ApiError> {
  return useQuery({ queryKey: qk.tree, queryFn: ({ signal }) => api.getTree(signal) });
}

export function usePageList(enabled = true): UseQueryResult<PageListResponse, ApiError> {
  return useQuery({
    queryKey: qk.pages,
    queryFn: ({ signal }) => api.listPages(signal),
    enabled,
  });
}

/** The page shown by the /p/* route. */
export function usePage(path: PagePath | undefined): UseQueryResult<PageResponse, ApiError> {
  return useQuery({
    queryKey: qk.pageByPath(path ?? ''),
    queryFn: ({ signal }) => {
      if (!path) throw new ApiError(400, 'VALIDATION', 'Missing page path');
      return api.getPageByPath(path, signal);
    },
    enabled: Boolean(path),
  });
}

export function usePageById(id: PageId | undefined): UseQueryResult<PageResponse, ApiError> {
  return useQuery({
    queryKey: qk.page(id ?? ''),
    queryFn: ({ signal }) => {
      if (!id) throw new ApiError(400, 'VALIDATION', 'Missing page id');
      return api.getPage(id, signal);
    },
    enabled: Boolean(id),
  });
}

export function useSearch(query: SearchQuery, enabled = true): UseQueryResult<SearchResponse, ApiError> {
  const active = enabled && query.q.trim().length > 0;
  return useQuery({
    queryKey: qk.search(query),
    queryFn: ({ signal }) => api.search({ ...query, q: query.q.trim() }, signal),
    enabled: active,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

export function useBacklinks(id: PageId | undefined): UseQueryResult<BacklinksResponse, ApiError> {
  return useQuery({
    queryKey: qk.backlinks(id ?? ''),
    queryFn: ({ signal }) => {
      if (!id) throw new ApiError(400, 'VALIDATION', 'Missing page id');
      return api.backlinks(id, signal);
    },
    enabled: Boolean(id),
  });
}

export function useHistory(
  id: PageId | undefined,
  limit = 25,
  enabled = true,
): UseQueryResult<HistoryResponse, ApiError> {
  return useQuery({
    queryKey: qk.history(id ?? '', limit),
    queryFn: ({ signal }) => {
      if (!id) throw new ApiError(400, 'VALIDATION', 'Missing page id');
      return api.history(id, { limit }, signal);
    },
    enabled: Boolean(id) && enabled,
  });
}

export function useRevision(
  id: PageId | undefined,
  sha: string | undefined,
): UseQueryResult<RevisionContentResponse, ApiError> {
  return useQuery({
    queryKey: qk.revision(id ?? '', sha ?? ''),
    queryFn: ({ signal }) => {
      if (!id || !sha) throw new ApiError(400, 'VALIDATION', 'Missing revision');
      return api.revision(id, sha, signal);
    },
    enabled: Boolean(id) && Boolean(sha),
    staleTime: Infinity,
  });
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

export interface UpdatePageVars {
  id: PageId;
  body: UpdatePageBody;
}

export function useUpdatePage(): UseMutationResult<PageResponse, ApiError, UpdatePageVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdatePageVars) => api.updatePage(id, body),
    onSuccess: (data) => {
      const previous = client.getQueryData<PageResponse>(qk.page(data.page.id));
      // Seed the caches directly so the open editor is never yanked back by a refetch.
      client.setQueryData(qk.page(data.page.id), data);
      client.setQueryData(qk.pageByPath(data.page.path), data);
      // A move leaves the old path cached, so the previous URL would keep serving the page.
      if (previous && previous.page.path !== data.page.path) {
        client.removeQueries({ queryKey: qk.pageByPath(previous.page.path) });
      }
      void client.invalidateQueries({ queryKey: qk.tree });
      void client.invalidateQueries({ queryKey: qk.pages });
      void client.invalidateQueries({ queryKey: ['views'] });
      void client.invalidateQueries({ queryKey: ['backlinks'] });
      void client.invalidateQueries({ queryKey: qk.gitStatus });
    },
  });
}

export function useCreatePage(): UseMutationResult<PageResponse, ApiError, CreatePageBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePageBody) => api.createPage(body),
    onSuccess: (data) => {
      client.setQueryData(qk.pageByPath(data.page.path), data);
      invalidateContent(client);
    },
  });
}

export interface DeletePageVars {
  id: PageId;
  recursive?: boolean;
}

export function useDeletePage(): UseMutationResult<DeletePageResponse, ApiError, DeletePageVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, recursive }: DeletePageVars) => api.deletePage(id, recursive ?? false),
    onSuccess: () => {
      invalidateContent(client);
      // The server drops the pins of a deleted page, so the bucket has to read them again.
      void client.invalidateQueries({ queryKey: qk.favorites });
    },
  });
}

export function useCreateSpace(): UseMutationResult<SpaceResponse, ApiError, CreateSpaceBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSpaceBody) => api.createSpace(body),
    onSuccess: () => invalidateContent(client),
  });
}

export interface UpdateSpaceVars {
  slug: string;
  body: UpdateSpaceBody;
}

export function useUpdateSpace(): UseMutationResult<SpaceResponse, ApiError, UpdateSpaceVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: UpdateSpaceVars) => api.updateSpace(slug, body),
    onSuccess: () => invalidateContent(client),
  });
}

// ---------------------------------------------------------------------------
// comments
// ---------------------------------------------------------------------------

/** Every thread on a page, resolved ones included: the panel decides what to show. */
export function useCommentThreads(
  id: PageId | undefined,
): UseQueryResult<CommentThreadsResponse, ApiError> {
  return useQuery({
    queryKey: qk.comments(id ?? ''),
    queryFn: ({ signal }) => {
      if (!id) throw new ApiError(400, 'VALIDATION', 'Missing page id');
      return api.comments(id, signal);
    },
    enabled: Boolean(id),
  });
}

export interface CreateThreadVars {
  pageId: PageId;
  body: CreateThreadBody;
}

export function useCreateThread(): UseMutationResult<CommentThreadResponse, ApiError, CreateThreadVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, body }: CreateThreadVars) => api.createThread(pageId, body),
    onSuccess: (_data, vars) => void client.invalidateQueries({ queryKey: qk.comments(vars.pageId) }),
  });
}

export interface ReplyVars {
  pageId: PageId;
  threadId: string;
  body: ReplyBody;
}

export function useReplyToThread(): UseMutationResult<CommentThreadResponse, ApiError, ReplyVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body }: ReplyVars) => api.replyToThread(threadId, body),
    onSuccess: (_data, vars) => void client.invalidateQueries({ queryKey: qk.comments(vars.pageId) }),
  });
}

export interface ResolveThreadVars {
  pageId: PageId;
  threadId: string;
  resolved: boolean;
}

export function useResolveThread(): UseMutationResult<CommentThreadResponse, ApiError, ResolveThreadVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, resolved }: ResolveThreadVars) =>
      api.resolveThread(threadId, { resolved }),
    onSuccess: (data, vars) => {
      const key = qk.comments(vars.pageId);
      // Seed from the response, or the card stays open until the refetch lands.
      client.setQueryData<CommentThreadsResponse>(key, (previous) =>
        previous === undefined
          ? previous
          : {
              ...previous,
              threads: previous.threads.map((thread) =>
                thread.id === data.thread.id ? data.thread : thread,
              ),
            },
      );
      void client.invalidateQueries({ queryKey: key });
    },
  });
}

export interface UpdateCommentVars {
  pageId: PageId;
  commentId: string;
  body: UpdateCommentBody;
}

export function useUpdateComment(): UseMutationResult<CommentThreadResponse, ApiError, UpdateCommentVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: UpdateCommentVars) => api.updateComment(commentId, body),
    onSuccess: (_data, vars) => void client.invalidateQueries({ queryKey: qk.comments(vars.pageId) }),
  });
}

export interface DeleteCommentVars {
  pageId: PageId;
  commentId: string;
}

export function useDeleteComment(): UseMutationResult<DeleteCommentResponse, ApiError, DeleteCommentVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId }: DeleteCommentVars) => api.deleteComment(commentId),
    onSuccess: (_data, vars) => void client.invalidateQueries({ queryKey: qk.comments(vars.pageId) }),
  });
}

// ---------------------------------------------------------------------------
// favorites
// ---------------------------------------------------------------------------

/** Every page this person pinned in this workspace, oldest pin first. */
export function useFavorites(): UseQueryResult<FavoritesResponse, ApiError> {
  return useQuery({ queryKey: qk.favorites, queryFn: ({ signal }) => api.favorites(signal) });
}

export function useAddFavorite(): UseMutationResult<FavoriteResponse, ApiError, PageId> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: PageId) => api.addFavorite(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.favorites }),
  });
}

export function useRemoveFavorite(): UseMutationResult<OkResponse, ApiError, PageId> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: PageId) => api.removeFavorite(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.favorites }),
  });
}

// ---------------------------------------------------------------------------
// databases
// ---------------------------------------------------------------------------

/** The schema and every row of a database page. */
export function useDatabase(id: PageId | undefined): UseQueryResult<DatabaseResponse, ApiError> {
  return useQuery({
    queryKey: qk.database(id ?? ''),
    queryFn: ({ signal }) => {
      if (!id) throw new ApiError(400, 'VALIDATION', 'Missing page id');
      return api.getDatabase(id, signal);
    },
    enabled: Boolean(id),
  });
}

export interface SetDatabaseVars {
  pageId: PageId;
  database?: Database;
  /** databaseRev() of the schema this edit was built from. Left out, the write replaces whole. */
  baseRev?: string;
  /** Cells to set in the same write, so a schema change and the rows it moves land together. */
  rows?: Record<string, RowProps>;
}

export function useSetDatabase(): UseMutationResult<PageResponse, ApiError, SetDatabaseVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, database, baseRev, rows }: SetDatabaseVars) =>
      api.setDatabase(pageId, database, baseRev, rows),
    onSuccess: (data, vars) => {
      // Seed the schema from the response so a renamed column does not flash its old name.
      const saved = data.page.database;
      const key = qk.database(vars.pageId);
      const previous = client.getQueryData<DatabaseResponse>(key);
      if (saved !== undefined && previous !== undefined) {
        client.setQueryData<DatabaseResponse>(key, { ...previous, database: saved });
      }
      void client.invalidateQueries({ queryKey: key });
      // A deleted column takes its threads with it on the server, so the count here is stale.
      void client.invalidateQueries({ queryKey: qk.comments(vars.pageId) });
      invalidateContent(client);
    },
  });
}

export function useRemoveDatabase(): UseMutationResult<PageResponse, ApiError, PageId> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pageId: PageId) => api.removeDatabase(pageId),
    onSuccess: (_data, pageId) => {
      void client.invalidateQueries({ queryKey: qk.database(pageId) });
      void client.invalidateQueries({ queryKey: qk.comments(pageId) });
      invalidateContent(client);
    },
  });
}

export interface CreateRowVars {
  pageId: PageId;
  body?: CreateRowBody;
}

export function useCreateRow(): UseMutationResult<RowResponse, ApiError, CreateRowVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, body }: CreateRowVars) => api.createRow(pageId, body ?? {}),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: qk.database(vars.pageId) });
      invalidateContent(client);
    },
  });
}

export interface UpdateRowVars {
  /** The database page the row lives in. A row is a record inside that page, not a page. */
  pageId: PageId;
  rowId: string;
  body: UpdateRowBody;
}

/**
 * Cell edits are applied to the cache before the request lands: a table where every keystroke
 * waits for a git commit feels broken.
 */
export function useUpdateRow(): UseMutationResult<RowResponse, ApiError, UpdateRowVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, rowId, body }: UpdateRowVars) => api.updateRow(pageId, rowId, body),
    onMutate: async (vars) => {
      const key = qk.database(vars.pageId);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<DatabaseResponse>(key);
      if (previous !== undefined) {
        const edited = previous.rows.map((row) =>
          row.id === vars.rowId
            ? {
                ...row,
                title: vars.body.title ?? row.title,
                props: { ...row.props, ...vars.body.props },
              }
            : row,
        );
        // A card dragged up its own stack has to stay where it was dropped, or it snaps back
        // to where it came from until the write lands.
        const before = vars.body.before;
        client.setQueryData<DatabaseResponse>(key, {
          ...previous,
          rows: before === undefined ? edited : moveRowBefore(edited, vars.rowId, before),
        });
      }
      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(qk.database(vars.pageId), context.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      void client.invalidateQueries({ queryKey: qk.database(vars.pageId) });
      invalidateContent(client);
    },
  });
}

export interface DeleteRowVars {
  pageId: PageId;
  rowId: string;
}

export function useDeleteRow(): UseMutationResult<OkResponse, ApiError, DeleteRowVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, rowId }: DeleteRowVars) => api.deleteRow(pageId, rowId),
    // The row leaves the table at once; a delete that waits for a commit reads as a dead click.
    onMutate: async (vars) => {
      const key = qk.database(vars.pageId);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<DatabaseResponse>(key);
      if (previous !== undefined) {
        client.setQueryData<DatabaseResponse>(key, {
          ...previous,
          rows: previous.rows.filter((row) => row.id !== vars.rowId),
        });
      }
      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(qk.database(vars.pageId), context.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      void client.invalidateQueries({ queryKey: qk.database(vars.pageId) });
      invalidateContent(client);
    },
  });
}

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------

export interface UploadAssetVars {
  file: File;
  pageId?: PageId;
  /** Write over the attachment of the same name rather than taking a free one beside it. */
  replace?: boolean;
}

export function useUploadAsset(): UseMutationResult<AssetResponse, ApiError, UploadAssetVars> {
  return useMutation({
    mutationFn: ({ file, pageId, replace }: UploadAssetVars) =>
      api.uploadAsset(file, pageId, replace),
  });
}

// ---------------------------------------------------------------------------
// rescan
// ---------------------------------------------------------------------------

/**
 * Read the content directory back into the page index and the search index, then collect the
 * attachments of pages that are gone. For a directory something outside tablinum rewrote.
 *
 * Every cached content query describes the tree as it was before, so all of them drop.
 */
export function useRescanWorkspace(): UseMutationResult<RescanResponse, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.rescan(),
    onSuccess: () => invalidateContent(client),
  });
}
