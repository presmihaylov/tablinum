import { CLIENT_HEADER, WORKSPACE_HEADER } from '@tablinum/shared';
import type {
  AgentResponse,
  AgentsResponse,
  AgentTokenResponse,
  AssetResponse,
  AuthResponse,
  AuthStateResponse,
  AvatarResponse,
  BacklinksResponse,
  ConflictInfo,
  ConnectSlackBody,
  CreatePageBody,
  CreateSpaceBody,
  CustomEmojiListResponse,
  CustomEmojiResponse,
  DeletePageResponse,
  ErrorBody,
  ErrorCode,
  GitCommitBody,
  GitCommitResponse,
  GitConflictResponse,
  GitPullResponse,
  GitPushResponse,
  GitResolveBody,
  GitResolveResponse,
  GitStatusResponse,
  HealthResponse,
  ChangePasswordBody,
  CreateAgentBody,
  CreateInviteBody,
  HistoryQuery,
  HistoryResponse,
  InvitePreviewResponse,
  InviteResponse,
  InvitesResponse,
  LoginBody,
  MeResponse,
  OkResponse,
  PageId,
  PageListResponse,
  PagePath,
  PageResponse,
  RegisterBody,
  RevisionContentResponse,
  SearchQuery,
  SearchResponse,
  SetupBody,
  SlackStateResponse,
  SpaceResponse,
  SpacesResponse,
  TreeResponse,
  UpdateAgentBody,
  UpdateMeBody,
  UpdatePageBody,
  UpdateSpaceBody,
  UpdateUserBody,
  UserResponse,
  UsersResponse,
  AddWorkspaceMemberBody,
  CreateWorkspaceBody,
  UpdateWorkspaceBody,
  UpdateWorkspaceMemberBody,
  WorkspaceMembersResponse,
  WorkspaceResponse,
  WorkspacesResponse,
} from '@tablinum/shared';
import { currentWorkspace } from '../lib/currentWorkspace';
import { myClientId } from '../lib/identity';

export const API_BASE = '/api/v1';

/** A non-2xx REST response, carrying the contract's machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  /** On a save conflict, the copy the server holds. The caller merges it and retries. */
  readonly info: ConflictInfo | null;

  constructor(status: number, code: ErrorCode, message: string, info: ConflictInfo | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.info = info;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** A 409 that carries the server's copy of the page. */
export function saveConflictOf(err: unknown): ConflictInfo | null {
  if (!isApiError(err) || err.code !== 'CONFLICT') return null;
  return err.info;
}

// ---------------------------------------------------------------------------
// session expiry signal
// ---------------------------------------------------------------------------

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Subscribe to 401s from any request. Returns an unsubscribe function. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function signalUnauthorized(): void {
  for (const listener of [...unauthorizedListeners]) listener();
}

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | undefined | null;
type QueryInput = Record<string, QueryValue>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  query?: QueryInput;
  signal?: AbortSignal;
  /** Login itself returns 401 for a wrong password; that must not trip the session gate. */
  ignoreUnauthorized?: boolean;
}

function buildUrl(pathname: string, query?: QueryInput): string {
  if (!query) return `${API_BASE}${pathname}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  if (qs.length === 0) return `${API_BASE}${pathname}`;
  return `${API_BASE}${pathname}?${qs}`;
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const envelope = (value as { error?: unknown }).error;
  if (typeof envelope !== 'object' || envelope === null) return false;
  const { code, message } = envelope as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

function fallbackCode(status: number): ErrorCode {
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 400) return 'VALIDATION';
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 502) return 'GIT_ERROR';
  return 'INTERNAL';
}

function readInfo(value: unknown): ConflictInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const { markdown, rev, updated } = value as Record<string, unknown>;
  if (typeof markdown !== 'string' || typeof rev !== 'string' || typeof updated !== 'string') return null;
  return { markdown, rev, updated };
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (isErrorBody(payload)) {
    return new ApiError(
      response.status,
      payload.error.code,
      payload.error.message,
      readInfo(payload.error.info),
    );
  }
  return new ApiError(response.status, fallbackCode(response.status), response.statusText || 'Request failed');
}

async function request<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
  // Names the tab. The live channel echoes it back, so this tab ignores its own change.
  const headers: Record<string, string> = { Accept: 'application/json', [CLIENT_HEADER]: myClientId() };
  // Every request says which workspace it is about. Without it the server picks the first one.
  const workspace = currentWorkspace();
  if (workspace !== null) headers[WORKSPACE_HEADER] = workspace;
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    signal: options.signal,
  };

  if (options.form) init.body = options.form;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  init.headers = headers;

  let response: Response;
  try {
    response = await fetch(buildUrl(pathname, options.query), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'INTERNAL', 'Cannot reach the tablinum server.');
  }

  if (response.status === 401 && !options.ignoreUnauthorized) signalUnauthorized();
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json();
  return data as T;
}

// ---------------------------------------------------------------------------
// endpoints - one function per line of the frozen contract
// ---------------------------------------------------------------------------

export const api = {
  health: (signal?: AbortSignal): Promise<HealthResponse> => request('/health', { signal }),

  /** Public: the sign-in screen asks this before it knows which form to draw. */
  authState: (signal?: AbortSignal): Promise<AuthStateResponse> =>
    request('/auth/state', { signal, ignoreUnauthorized: true }),

  login: (body: LoginBody): Promise<AuthResponse> =>
    request('/auth/login', { method: 'POST', body, ignoreUnauthorized: true }),

  logout: (): Promise<OkResponse> => request('/auth/logout', { method: 'POST' }),

  setup: (body: SetupBody): Promise<AuthResponse> =>
    request('/auth/setup', { method: 'POST', body }),

  invitePreview: (token: string, signal?: AbortSignal): Promise<InvitePreviewResponse> =>
    request(`/auth/invite/${encodeURIComponent(token)}`, { signal, ignoreUnauthorized: true }),

  register: (body: RegisterBody): Promise<AuthResponse> =>
    request('/auth/register', { method: 'POST', body, ignoreUnauthorized: true }),

  me: (signal?: AbortSignal): Promise<MeResponse> => request('/me', { signal }),

  updateMe: (body: UpdateMeBody): Promise<UserResponse> =>
    request('/me', { method: 'PATCH', body }),

  changePassword: (body: ChangePasswordBody): Promise<OkResponse> =>
    request('/me/password', { method: 'POST', body, ignoreUnauthorized: true }),

  uploadAvatar: (file: File): Promise<AvatarResponse> => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request('/me/avatar', { method: 'POST', form });
  },

  removeAvatar: (): Promise<OkResponse> => request('/me/avatar', { method: 'DELETE' }),

  slackState: (signal?: AbortSignal): Promise<SlackStateResponse> => request('/me/slack', { signal }),

  connectSlack: (body: ConnectSlackBody): Promise<SlackStateResponse> =>
    request('/me/slack', { method: 'POST', body }),

  disconnectSlack: (): Promise<SlackStateResponse> => request('/me/slack', { method: 'DELETE' }),

  listUsers: (signal?: AbortSignal): Promise<UsersResponse> => request('/users', { signal }),

  updateUser: (id: string, body: UpdateUserBody): Promise<UserResponse> =>
    request(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

  deleteUser: (id: string): Promise<OkResponse> =>
    request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listInvites: (signal?: AbortSignal): Promise<InvitesResponse> => request('/invites', { signal }),

  createInvite: (body: CreateInviteBody): Promise<InviteResponse> =>
    request('/invites', { method: 'POST', body }),

  revokeInvite: (id: string): Promise<OkResponse> =>
    request(`/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listAgents: (signal?: AbortSignal): Promise<AgentsResponse> => request('/agents', { signal }),

  createAgent: (body: CreateAgentBody): Promise<AgentTokenResponse> =>
    request('/agents', { method: 'POST', body }),

  updateAgent: (id: string, body: UpdateAgentBody): Promise<AgentResponse> =>
    request(`/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

  deleteAgent: (id: string): Promise<OkResponse> =>
    request(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  rotateAgentToken: (id: string): Promise<AgentTokenResponse> =>
    request(`/agents/${encodeURIComponent(id)}/token`, { method: 'POST' }),

  listEmoji: (signal?: AbortSignal): Promise<CustomEmojiListResponse> => request('/emoji', { signal }),

  uploadEmoji: (shortcode: string, file: File): Promise<CustomEmojiResponse> => {
    const form = new FormData();
    form.append('shortcode', shortcode);
    form.append('file', file, file.name);
    return request('/emoji', { method: 'POST', form });
  },

  deleteEmoji: (id: string): Promise<OkResponse> =>
    request(`/emoji/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listSpaces: (signal?: AbortSignal): Promise<SpacesResponse> => request('/spaces', { signal }),

  createSpace: (body: CreateSpaceBody): Promise<SpaceResponse> =>
    request('/spaces', { method: 'POST', body }),

  updateSpace: (slug: string, body: UpdateSpaceBody): Promise<SpaceResponse> =>
    request(`/spaces/${encodeURIComponent(slug)}`, { method: 'PATCH', body }),

  getTree: (signal?: AbortSignal): Promise<TreeResponse> => request('/tree', { signal }),

  getPageByPath: (path: PagePath, signal?: AbortSignal): Promise<PageResponse> =>
    request('/pages', { query: { path }, signal }),

  listPages: (signal?: AbortSignal): Promise<PageListResponse> => request('/pages', { signal }),

  getPage: (id: PageId, signal?: AbortSignal): Promise<PageResponse> =>
    request(`/pages/${encodeURIComponent(id)}`, { signal }),

  createPage: (body: CreatePageBody): Promise<PageResponse> =>
    request('/pages', { method: 'POST', body }),

  updatePage: (id: PageId, body: UpdatePageBody): Promise<PageResponse> =>
    request(`/pages/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

  deletePage: (id: PageId, recursive = false): Promise<DeletePageResponse> =>
    request(`/pages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      query: recursive ? { recursive: 'true' } : undefined,
    }),

  search: (query: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> =>
    request('/search', {
      query: { q: query.q, space: query.space, limit: query.limit },
      signal,
    }),

  backlinks: (id: PageId, signal?: AbortSignal): Promise<BacklinksResponse> =>
    request(`/pages/${encodeURIComponent(id)}/backlinks`, { signal }),

  history: (id: PageId, query: HistoryQuery = {}, signal?: AbortSignal): Promise<HistoryResponse> =>
    request(`/pages/${encodeURIComponent(id)}/history`, { query: { limit: query.limit }, signal }),

  revision: (id: PageId, sha: string, signal?: AbortSignal): Promise<RevisionContentResponse> =>
    request(`/pages/${encodeURIComponent(id)}/revisions/${encodeURIComponent(sha)}`, { signal }),


  gitStatus: (signal?: AbortSignal): Promise<GitStatusResponse> => request('/git/status', { signal }),

  gitPull: (): Promise<GitPullResponse> => request('/git/pull', { method: 'POST' }),

  gitPush: (): Promise<GitPushResponse> => request('/git/push', { method: 'POST' }),

  gitCommit: (body: GitCommitBody = {}): Promise<GitCommitResponse> =>
    request('/git/commit', { method: 'POST', body }),

  gitConflict: (signal?: AbortSignal): Promise<GitConflictResponse> =>
    request('/git/conflict', { signal }),

  gitResolve: (body: GitResolveBody): Promise<GitResolveResponse> =>
    request('/git/resolve', { method: 'POST', body }),

  listWorkspaces: (signal?: AbortSignal): Promise<WorkspacesResponse> =>
    request('/workspaces', { signal }),

  createWorkspace: (body: CreateWorkspaceBody): Promise<WorkspaceResponse> =>
    request('/workspaces', { method: 'POST', body }),

  updateWorkspace: (id: string, body: UpdateWorkspaceBody): Promise<WorkspaceResponse> =>
    request(`/workspaces/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

  deleteWorkspace: (id: string): Promise<OkResponse> =>
    request(`/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  workspaceMembers: (id: string, signal?: AbortSignal): Promise<WorkspaceMembersResponse> =>
    request(`/workspaces/${encodeURIComponent(id)}/members`, { signal }),

  addWorkspaceMember: (id: string, body: AddWorkspaceMemberBody): Promise<OkResponse> =>
    request(`/workspaces/${encodeURIComponent(id)}/members`, { method: 'POST', body }),

  updateWorkspaceMember: (
    id: string,
    userId: string,
    body: UpdateWorkspaceMemberBody,
  ): Promise<OkResponse> =>
    request(
      `/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body },
    ),

  removeWorkspaceMember: (id: string, userId: string): Promise<OkResponse> =>
    request(`/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),

  /** Where the browser downloads the zip from. A plain link, so the file never enters memory. */
  workspaceExportUrl: (id: string): string =>
    `${API_BASE}/workspaces/${encodeURIComponent(id)}/export`,

  importWorkspace: (file: File, name?: string): Promise<WorkspaceResponse> => {
    const form = new FormData();
    if (name !== undefined && name.length > 0) form.append('name', name);
    form.append('file', file, file.name);
    return request('/workspaces/import', { method: 'POST', form });
  },

  // `replace` writes over the file of the same name instead of taking a free one beside it.
  uploadAsset: (file: File, pageId?: PageId, replace = false): Promise<AssetResponse> => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (pageId) form.append('pageId', pageId);
    if (replace) form.append('replace', 'true');
    return request('/assets', { method: 'POST', form });
  },
} as const;

export type Api = typeof api;
