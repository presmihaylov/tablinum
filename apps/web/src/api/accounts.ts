import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AgentResponse,
  AgentsResponse,
  AgentTokenResponse,
  AuthResponse,
  AuthStateResponse,
  AvatarResponse,
  ChangePasswordBody,
  ConnectSlackBody,
  CreateAgentBody,
  CreateInviteBody,
  CreateWorkspaceBody,
  CustomEmojiListResponse,
  CustomEmojiResponse,
  HealthResponse,
  InvitePreviewResponse,
  InviteResponse,
  InvitesResponse,
  LoginBody,
  OkResponse,
  RegisterBody,
  SetupBody,
  SlackStateResponse,
  UpdateAgentBody,
  UpdateMeBody,
  UpdateUserBody,
  UpdateWorkspaceBody,
  UserResponse,
  UsersResponse,
  WebhookSigningResponse,
  WorkspaceMembersResponse,
  WorkspaceResponse,
  WorkspaceRole,
  WorkspacesResponse,
} from '@tablinum/shared';
import { setCustomEmoji } from '../lib/customEmoji';
import { ApiError, api } from './client';
import { qk } from './keys';

/**
 * Who you are and who else is here: the session, your own profile, the people, the agents,
 * the custom emoji and the workspaces they all belong to. Nothing here reads a page.
 */

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

/** Asks the server, not the account. It lives here because no other domain claims it. */
export function useHealth(): UseQueryResult<HealthResponse, ApiError> {
  return useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => api.health(signal),
    staleTime: 60_000,
  });
}

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

export function useLogin(): UseMutationResult<AuthResponse, ApiError, LoginBody> {
  return useMutation({ mutationFn: (body: LoginBody) => api.login(body) });
}

export function useLogout(): UseMutationResult<OkResponse, ApiError, void> {
  return useMutation({ mutationFn: () => api.logout() });
}

export function useInvitePreview(token: string | undefined): UseQueryResult<InvitePreviewResponse, ApiError> {
  return useQuery({
    queryKey: qk.invitePreview(token ?? ''),
    queryFn: ({ signal }) => api.invitePreview(token ?? '', signal),
    enabled: token !== undefined && token.length > 0,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// me
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// agents
// ---------------------------------------------------------------------------

export function useAgents(enabled = true): UseQueryResult<AgentsResponse, ApiError> {
  return useQuery({
    queryKey: qk.agents,
    queryFn: ({ signal }) => api.listAgents(signal),
    enabled,
  });
}

/** How agent webhooks are signed. Answers `enabled: false` while no secret is configured. */
export function useWebhookSigning(enabled = true): UseQueryResult<WebhookSigningResponse, ApiError> {
  return useQuery({
    queryKey: qk.webhookSigning,
    queryFn: ({ signal }) => api.webhookSigning(signal),
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

export interface AgentAvatarVars {
  id: string;
  file: File;
}

export function useUploadAgentAvatar(): UseMutationResult<AvatarResponse, ApiError, AgentAvatarVars> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: AgentAvatarVars) => api.uploadAgentAvatar(id, file),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.agents }),
  });
}

export function useRemoveAgentAvatar(): UseMutationResult<OkResponse, ApiError, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeAgentAvatar(id),
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
