import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  GitCommitBody,
  GitCommitResponse,
  GitPullResponse,
  GitPushResponse,
  GitStatusResponse,
} from '@tablinum/shared';
import { ApiError, api } from './client';
import { invalidateContent } from './content';
import { qk } from './keys';

/**
 * The repo behind the workspace: what is uncommitted, and the sync and commit buttons.
 * A sync rewrites files under us, so it drops the content caches on the way out.
 */

export function useGitStatus(pollMs = 20_000): UseQueryResult<GitStatusResponse, ApiError> {
  return useQuery({
    queryKey: qk.gitStatus,
    queryFn: ({ signal }) => api.gitStatus(signal),
    refetchInterval: pollMs,
    staleTime: 5_000,
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
