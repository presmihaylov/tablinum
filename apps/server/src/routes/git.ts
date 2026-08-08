import type { FastifyInstance } from 'fastify';
import {
  GitCommitBodySchema,
  parseOrThrow,
  type GitCommitResponse,
  type GitPullResponse,
  type GitPushResponse,
  type GitStatusResponse,
} from '@gitdocs/shared';
import { API_PREFIX, type RouteContext } from '../context.js';

export function registerGitRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { git } = ctx.deps;

  app.get(`${API_PREFIX}/git/status`, async (): Promise<GitStatusResponse> => {
    return { status: await git.status() };
  });

  app.post(`${API_PREFIX}/git/pull`, async (): Promise<GitPullResponse> => {
    const result = await git.pull();
    // A pull rewrites arbitrary files, so rescan instead of guessing which. The store must go
    // first: reindexAll reads through it, and its index still describes the pre-pull tree.
    if (result.pulled > 0) {
      await ctx.deps.store.rebuild();
      await ctx.wiring.reindexAll();
    }
    return result;
  });

  app.post(`${API_PREFIX}/git/push`, async (): Promise<GitPushResponse> => {
    return git.push();
  });

  app.post(`${API_PREFIX}/git/commit`, async (request): Promise<GitCommitResponse> => {
    const body = parseOrThrow(GitCommitBodySchema, request.body ?? {}, 'commit body');
    return { sha: await git.commit(body.message) };
  });
}
