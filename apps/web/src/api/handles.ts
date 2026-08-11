import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ChangeHandleBody,
  HandleChangeResponse,
  HandlePreviewResponse,
} from '@tablinum/shared';
import { ApiError, api } from './client';
import { invalidateContent } from './content';
import { qk } from './keys';

/**
 * Changing your handle.
 *
 * These sit apart from accounts.ts because a handle change is the one mutation that rewrites
 * other people's pages, so its cache work is unlike anything else there and reads better whole.
 */

/** How much text carries your handle today, so the panel can say what a change would rewrite. */
export function useHandlePreview(enabled = true): UseQueryResult<HandlePreviewResponse, ApiError> {
  return useQuery({
    queryKey: qk.handlePreview,
    queryFn: ({ signal }) => api.handlePreview(signal),
    enabled,
  });
}

export function useChangeHandle(): UseMutationResult<
  HandleChangeResponse,
  ApiError,
  ChangeHandleBody
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangeHandleBody) => api.changeHandle(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.authState });
      void client.invalidateQueries({ queryKey: qk.users });
      void client.invalidateQueries({ queryKey: qk.handlePreview });
      // Every page and comment that named the old handle now reads differently.
      invalidateContent(client);
      void client.invalidateQueries({ queryKey: qk.allComments });
    },
  });
}
