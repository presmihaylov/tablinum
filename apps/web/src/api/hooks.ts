import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AssetResponse,
  BacklinksResponse,
  CreatePageBody,
  CreateSpaceBody,
  DeletePageResponse,
  GitCommitBody,
  GitCommitResponse,
  GitPullResponse,
  GitPushResponse,
  GitStatusResponse,
  HealthResponse,
  HistoryResponse,
  LoginBody,
  OkResponse,
  PageId,
  PageListResponse,
  PagePath,
  PageResponse,
  RevisionContentResponse,
  SearchQuery,
  SearchResponse,
  SpaceResponse,
  SpacesResponse,
  TreeResponse,
  UpdatePageBody,
  ViewsQuery,
  ViewsResponse,
} from '@gitdocs/shared';
import { ApiError, api } from './client';
import { contentPrefixes, qk } from './keys';

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

export function useHealth(): UseQueryResult<HealthResponse, ApiError> {
  return useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => api.health(signal),
    staleTime: 60_000,
  });
}

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

export function useViews(
  query: ViewsQuery | undefined,
): UseQueryResult<ViewsResponse, ApiError> {
  return useQuery({
    queryKey: qk.views(query ?? { dir: '' }),
    queryFn: ({ signal }) => {
      if (!query) throw new ApiError(400, 'VALIDATION', 'Missing view directory');
      return api.views(query, signal);
    },
    enabled: Boolean(query?.dir),
    placeholderData: keepPreviousData,
  });
}

export function useGitStatus(pollMs = 20_000): UseQueryResult<GitStatusResponse, ApiError> {
  return useQuery({
    queryKey: qk.gitStatus,
    queryFn: ({ signal }) => api.gitStatus(signal),
    refetchInterval: pollMs,
    staleTime: 5_000,
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
    onSuccess: () => invalidateContent(client),
  });
}

export function useCreateSpace(): UseMutationResult<SpaceResponse, ApiError, CreateSpaceBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSpaceBody) => api.createSpace(body),
    onSuccess: () => invalidateContent(client),
  });
}

export interface SyncResult {
  pulled: number;
  pushed: boolean;
}

/** Pull then push, in that order, as the sidebar Sync button requires. */
export function useGitSync(): UseMutationResult<SyncResult, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      const pull: GitPullResponse = await api.gitPull();
      const push: GitPushResponse = await api.gitPush();
      return { pulled: pull.pulled, pushed: push.pushed };
    },
    onSuccess: () => invalidateContent(client),
  });
}

export function useGitCommit(): UseMutationResult<GitCommitResponse, ApiError, GitCommitBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: GitCommitBody) => api.gitCommit(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.gitStatus });
    },
  });
}

export function useLogin(): UseMutationResult<OkResponse, ApiError, LoginBody> {
  return useMutation({ mutationFn: (body: LoginBody) => api.login(body) });
}

export function useLogout(): UseMutationResult<OkResponse, ApiError, void> {
  return useMutation({ mutationFn: () => api.logout() });
}

export interface UploadAssetVars {
  file: File;
  pageId?: PageId;
}

export function useUploadAsset(): UseMutationResult<AssetResponse, ApiError, UploadAssetVars> {
  return useMutation({ mutationFn: ({ file, pageId }: UploadAssetVars) => api.uploadAsset(file, pageId) });
}
