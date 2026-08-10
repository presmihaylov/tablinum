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
  AgentResponse,
  AgentsResponse,
  AgentTokenResponse,
  AssetResponse,
  AuthResponse,
  AuthStateResponse,
  AvatarResponse,
  BacklinksResponse,
  CommentThreadResponse,
  CommentThreadsResponse,
  ConnectSlackBody,
  CreatePageBody,
  CreateRowBody,
  CreateSpaceBody,
  CreateThreadBody,
  CustomEmojiListResponse,
  CustomEmojiResponse,
  Database,
  DatabaseResponse,
  DeleteCommentResponse,
  DeletePageResponse,
  FavoriteResponse,
  FavoritesResponse,
  GitCommitBody,
  GitCommitResponse,
  GitPullResponse,
  GitPushResponse,
  GitStatusResponse,
  HealthResponse,
  ChangePasswordBody,
  CreateAgentBody,
  CreateInviteBody,
  HistoryResponse,
  InvitePreviewResponse,
  InviteResponse,
  InvitesResponse,
  LoginBody,
  OkResponse,
  PageId,
  PageListResponse,
  PagePath,
  PageResponse,
  ReplyBody,
  RevisionContentResponse,
  RegisterBody,
  RowResponse,
  SearchQuery,
  SearchResponse,
  SetupBody,
  SlackStateResponse,
  SpaceResponse,
  SpacesResponse,
  TreeResponse,
  UpdateAgentBody,
  UpdateCommentBody,
  UpdateMeBody,
  UpdatePageBody,
  UpdateRowBody,
  UpdateSpaceBody,
  UpdateUserBody,
  UserResponse,
  UsersResponse,
  CreateWorkspaceBody,
  UpdateWorkspaceBody,
  WorkspaceMembersResponse,
  WorkspaceResponse,
  WorkspaceRole,
  WorkspacesResponse,
} from '@tablinum/shared';
import { setCustomEmoji } from '../lib/customEmoji';
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

export function useLogin(): UseMutationResult<AuthResponse, ApiError, LoginBody> {
  return useMutation({ mutationFn: (body: LoginBody) => api.login(body) });
}

export function useLogout(): UseMutationResult<OkResponse, ApiError, void> {
  return useMutation({ mutationFn: () => api.logout() });
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
}

export function useSetDatabase(): UseMutationResult<PageResponse, ApiError, SetDatabaseVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, database }: SetDatabaseVars) => api.setDatabase(pageId, database),
    onSuccess: (data, vars) => {
      // Seed the schema from the response so a renamed column does not flash its old name.
      const saved = data.page.database;
      const key = qk.database(vars.pageId);
      const previous = client.getQueryData<DatabaseResponse>(key);
      if (saved !== undefined && previous !== undefined) {
        client.setQueryData<DatabaseResponse>(key, { ...previous, database: saved });
      }
      void client.invalidateQueries({ queryKey: key });
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
        client.setQueryData<DatabaseResponse>(key, {
          ...previous,
          rows: previous.rows.map((row) =>
            row.id === vars.rowId
              ? {
                  ...row,
                  title: vars.body.title ?? row.title,
                  props: { ...row.props, ...vars.body.props },
                }
              : row,
          ),
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
// accounts
// ---------------------------------------------------------------------------

/** Who is signed in and which sign-in form this server needs. Public, so it never 401s. */
export function useAuthState(): UseQueryResult<AuthStateResponse, ApiError> {
  return useQuery({
    queryKey: qk.authState,
    queryFn: ({ signal }) => api.authState(signal),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Claim a fresh server. Nothing is invalidated here on purpose: the caller shows the
 * first-workspace step next, and a refreshed auth state would swap the shell in under it.
 */
export function useSetup(): UseMutationResult<AuthResponse, ApiError, SetupBody> {
  return useMutation({ mutationFn: (body: SetupBody) => api.setup(body) });
}

export function useRegister(): UseMutationResult<AuthResponse, ApiError, RegisterBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterBody) => api.register(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.authState }),
  });
}

export function useInvitePreview(token: string | undefined): UseQueryResult<InvitePreviewResponse, ApiError> {
  return useQuery({
    queryKey: qk.invitePreview(token ?? ''),
    queryFn: ({ signal }) => api.invitePreview(token ?? '', signal),
    enabled: token !== undefined && token.length > 0,
    retry: false,
  });
}

export function useUpdateMe(): UseMutationResult<UserResponse, ApiError, UpdateMeBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeBody) => api.updateMe(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.authState });
      void client.invalidateQueries({ queryKey: qk.users });
    },
  });
}

export function useChangePassword(): UseMutationResult<OkResponse, ApiError, ChangePasswordBody> {
  return useMutation({ mutationFn: (body: ChangePasswordBody) => api.changePassword(body) });
}

export function useUploadAvatar(): UseMutationResult<AvatarResponse, ApiError, File> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadAvatar(file),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.authState });
      void client.invalidateQueries({ queryKey: qk.users });
    },
  });
}

export function useRemoveAvatar(): UseMutationResult<OkResponse, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.removeAvatar(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.authState });
      void client.invalidateQueries({ queryKey: qk.users });
    },
  });
}

export function useSlackState(enabled = true): UseQueryResult<SlackStateResponse, ApiError> {
  return useQuery({
    queryKey: qk.slack,
    queryFn: ({ signal }) => api.slackState(signal),
    enabled,
  });
}

export function useConnectSlack(): UseMutationResult<SlackStateResponse, ApiError, ConnectSlackBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ConnectSlackBody) => api.connectSlack(body),
    onSuccess: (data) => client.setQueryData(qk.slack, data),
  });
}

export function useDisconnectSlack(): UseMutationResult<SlackStateResponse, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.disconnectSlack(),
    onSuccess: (data) => client.setQueryData(qk.slack, data),
  });
}

export function useUsers(enabled = true): UseQueryResult<UsersResponse, ApiError> {
  return useQuery({
    queryKey: qk.users,
    queryFn: ({ signal }) => api.listUsers(signal),
    enabled,
  });
}

export interface UpdateUserVars {
  id: string;
  patch: UpdateUserBody;
}

export function useUpdateUser(): UseMutationResult<UserResponse, ApiError, UpdateUserVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateUserVars) => api.updateUser(id, patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.users }),
  });
}

export function useDeleteUser(): UseMutationResult<OkResponse, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.users }),
  });
}

export function useInvites(enabled = true): UseQueryResult<InvitesResponse, ApiError> {
  return useQuery({
    queryKey: qk.invites,
    queryFn: ({ signal }) => api.listInvites(signal),
    enabled,
  });
}

export function useCreateInvite(): UseMutationResult<InviteResponse, ApiError, CreateInviteBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInviteBody) => api.createInvite(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.invites }),
  });
}

export function useRevokeInvite(): UseMutationResult<OkResponse, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeInvite(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.invites }),
  });
}

export function useAgents(enabled = true): UseQueryResult<AgentsResponse, ApiError> {
  return useQuery({
    queryKey: qk.agents,
    queryFn: ({ signal }) => api.listAgents(signal),
    enabled,
  });
}

export function useCreateAgent(): UseMutationResult<AgentTokenResponse, ApiError, CreateAgentBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgentBody) => api.createAgent(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.agents }),
  });
}

export interface UpdateAgentVars {
  id: string;
  patch: UpdateAgentBody;
}

export function useUpdateAgent(): UseMutationResult<AgentResponse, ApiError, UpdateAgentVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentVars) => api.updateAgent(id, patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.agents }),
  });
}

export function useDeleteAgent(): UseMutationResult<OkResponse, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAgent(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.agents }),
  });
}

export function useRotateAgentToken(): UseMutationResult<AgentTokenResponse, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rotateAgentToken(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.agents }),
  });
}

// ---------------------------------------------------------------------------
// custom emoji
// ---------------------------------------------------------------------------

/**
 * The custom emoji set. The query fills the module registry as the answer lands, because the
 * markdown parser reads it outside React and must not wait for an effect to run.
 */
export function useCustomEmoji(): UseQueryResult<CustomEmojiListResponse, ApiError> {
  return useQuery({
    queryKey: qk.emoji,
    queryFn: async ({ signal }) => {
      const response = await api.listEmoji(signal);
      setCustomEmoji(response.emoji);
      return response;
    },
  });
}

export interface UploadEmojiVars {
  shortcode: string;
  file: File;
}

export function useUploadEmoji(): UseMutationResult<CustomEmojiResponse, ApiError, UploadEmojiVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ shortcode, file }: UploadEmojiVars) => api.uploadEmoji(shortcode, file),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.emoji }),
  });
}

export function useDeleteEmoji(): UseMutationResult<OkResponse, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteEmoji(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.emoji }),
  });
}

// ---------------------------------------------------------------------------
// workspaces
// ---------------------------------------------------------------------------

export function useWorkspaces(): UseQueryResult<WorkspacesResponse, ApiError> {
  return useQuery({
    queryKey: qk.workspaces,
    queryFn: ({ signal }) => api.listWorkspaces(signal),
    staleTime: 60_000,
  });
}

export function useCreateWorkspace(): UseMutationResult<WorkspaceResponse, ApiError, CreateWorkspaceBody> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspaceBody) => api.createWorkspace(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export interface UpdateWorkspaceVars {
  id: string;
  patch: UpdateWorkspaceBody;
}

export function useUpdateWorkspace(): UseMutationResult<WorkspaceResponse, ApiError, UpdateWorkspaceVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateWorkspaceVars) => api.updateWorkspace(id, patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export function useDeleteWorkspace(): UseMutationResult<OkResponse, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export interface ImportWorkspaceVars {
  file: File;
  name?: string;
}

export function useImportWorkspace(): UseMutationResult<WorkspaceResponse, ApiError, ImportWorkspaceVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, name }: ImportWorkspaceVars) => api.importWorkspace(file, name),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export function useWorkspaceMembers(
  id: string | null,
): UseQueryResult<WorkspaceMembersResponse, ApiError> {
  return useQuery({
    queryKey: qk.workspaceMembers(id ?? ''),
    queryFn: ({ signal }) => api.workspaceMembers(id ?? '', signal),
    enabled: id !== null,
  });
}

export interface WorkspaceMemberVars {
  id: string;
  userId: string;
  role?: WorkspaceRole;
}

export function useAddWorkspaceMember(): UseMutationResult<OkResponse, ApiError, WorkspaceMemberVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId, role }: WorkspaceMemberVars) =>
      api.addWorkspaceMember(id, { userId, ...(role === undefined ? {} : { role }) }),
    onSuccess: (_data, vars) =>
      void client.invalidateQueries({ queryKey: qk.workspaceMembers(vars.id) }),
  });
}

/** Changes the role of somebody already in the workspace. */
export function useSetWorkspaceMemberRole(): UseMutationResult<
  OkResponse,
  ApiError,
  WorkspaceMemberVars & { role: WorkspaceRole }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId, role }: WorkspaceMemberVars & { role: WorkspaceRole }) =>
      api.updateWorkspaceMember(id, userId, { role }),
    onSuccess: (_data, vars) =>
      void client.invalidateQueries({ queryKey: qk.workspaceMembers(vars.id) }),
  });
}

export function useRemoveWorkspaceMember(): UseMutationResult<OkResponse, ApiError, WorkspaceMemberVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: WorkspaceMemberVars) => api.removeWorkspaceMember(id, userId),
    onSuccess: (_data, vars) =>
      void client.invalidateQueries({ queryKey: qk.workspaceMembers(vars.id) }),
  });
}

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
