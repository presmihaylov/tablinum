import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ChangeHandleBody,
  HandleChangeResponse,
  HandlePreviewResponse,
} from '@tablinum/shared';
import { ApiError, api } from './client';
import { invalidateContent } from './hooks';
import { qk } from './keys';

/**
 * Changing a handle, your own or somebody else's.
 *
 * These sit apart from hooks.ts because a handle change is the one mutation that rewrites other
 * people's pages, so its cache work is unlike anything else in there and reads better whole.
 */

/** How much text carries your handle today, so the panel can say what a change would rewrite. */
export function useHandlePreview(enabled = true): UseQueryResult<HandlePreviewResponse, ApiError> {
  return useQuery({
    queryKey: qk.handlePreview,
    queryFn: ({ signal }) => api.handlePreview(signal),
    enabled,
  });
}

/**
 * The same count for somebody else, for an admin about to rename them.
 *
 * A preview reads every page of every open workspace, so it is asked for one person at a time:
 * `id` is null until an admin opens a row, and the roster never fans this out over everybody.
 */
export function useUserHandlePreview(
  id: string | null,
): UseQueryResult<HandlePreviewResponse, ApiError> {
  return useQuery({
    queryKey: qk.userHandlePreview(id ?? ''),
    queryFn: ({ signal }) => api.userHandlePreview(id ?? '', signal),
    enabled: id !== null,
  });
}

/** Everything a rename makes stale, whoever it was for. */
function invalidateAfterRename(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: qk.authState });
  // Prefix match, so this covers qk.userHandlePreview(id) for everybody as well.
  void client.invalidateQueries({ queryKey: qk.users });
  void client.invalidateQueries({ queryKey: qk.handlePreview });
  // Every page and comment that named the old handle now reads differently.
  invalidateContent(client);
  void client.invalidateQueries({ queryKey: qk.allComments });
}

export function useChangeHandle(): UseMutationResult<
  HandleChangeResponse,
  ApiError,
  ChangeHandleBody
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangeHandleBody) => api.changeHandle(body),
    onSuccess: () => invalidateAfterRename(client),
  });
}

export interface ChangeUserHandleVars {
  id: string;
  body: ChangeHandleBody;
}

export function useChangeUserHandle(): UseMutationResult<
  HandleChangeResponse,
  ApiError,
  ChangeUserHandleVars
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: ChangeUserHandleVars) => api.changeUserHandle(id, body),
    onSuccess: () => invalidateAfterRename(client),
  });
}
