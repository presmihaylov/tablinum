import type { FastifyInstance } from 'fastify';
import {
  GitCommitBodySchema,
  GitResolveBodySchema,
  PAGE_EXT,
  isValidPagePath,
  mergeText,
  parseOrThrow,
  relFileToPagePath,
  type ConflictFile,
  type GitCommitResponse,
  type GitConflictResponse,
  type GitPullResponse,
  type GitPushResponse,
  type GitResolveResponse,
  type GitStatusResponse,
  type PagePath,
} from '@gitdocs/shared';
import { API_PREFIX, type RouteContext } from '../context.js';

/** Labels that end up inside the conflict markers of an unmergeable file. */
const OURS_LABEL = 'local';
const THEIRS_LABEL = 'remote';

export function registerGitRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { git, store } = ctx.deps;

  /** The page a repo-relative file holds, when it holds one. */
  function pagePathOf(file: string): PagePath | null {
    if (!file.toLowerCase().endsWith(PAGE_EXT)) return null;
    const candidate = relFileToPagePath(file);
    return isValidPagePath(candidate) ? candidate : null;
  }

  function titleOf(raw: string): string | null {
    if (raw.length === 0) return null;
    try {
      return store.parsePageFile(raw).frontmatter.title;
    } catch {
      return null;
    }
  }

  app.get(`${API_PREFIX}/git/status`, async (): Promise<GitStatusResponse> => {
    return { status: await git.status() };
  });

  /** Push every page a pull rewrote to the tabs that have it open. */
  async function announcePulledPages(files: string[]): Promise<void> {
    for (const file of files) {
      const pagePath = pagePathOf(file);
      if (pagePath === null) continue;
      const page = await store.getPageByPath(pagePath);
      if (page !== null) ctx.live.pageChanged(page, 'pull', null);
    }
  }

  app.post(`${API_PREFIX}/git/pull`, async (): Promise<GitPullResponse> => {
    const { status, pulled, files } = await git.pull();
    // A pull rewrites arbitrary files, so rescan instead of guessing which. The store must go
    // first: reindexAll reads through it, and its index still describes the pre-pull tree.
    if (pulled > 0) {
      await ctx.deps.store.rebuild();
      await ctx.wiring.reindexAll();
      await announcePulledPages(files);
    }
    ctx.live.gitChanged(status);
    return { status, pulled };
  });

  app.post(`${API_PREFIX}/git/push`, async (): Promise<GitPushResponse> => {
    const result = await git.push();
    ctx.live.gitChanged(result.status);
    return result;
  });

  app.post(`${API_PREFIX}/git/commit`, async (request): Promise<GitCommitResponse> => {
    const body = parseOrThrow(GitCommitBodySchema, request.body ?? {}, 'commit body');
    return { sha: await git.commit(body.message) };
  });

  /**
   * Everything the conflict UI needs: the three versions of each file plus a best-effort
   * three-way merge. `clean` says whether that merge needs a human at all.
   */
  app.get(`${API_PREFIX}/git/conflict`, async (): Promise<GitConflictResponse> => {
    const status = await git.status();
    if (status.conflict === null) return { conflict: null, files: [] };

    const versions = await git.conflictVersions();
    const files: ConflictFile[] = versions.map((entry) => {
      const merge = mergeText(entry.base, entry.local, entry.remote, {
        ours: OURS_LABEL,
        theirs: THEIRS_LABEL,
      });
      return {
        file: entry.file,
        path: pagePathOf(entry.file),
        title: titleOf(entry.local) ?? titleOf(entry.remote),
        local: entry.local,
        remote: entry.remote,
        base: entry.base,
        merged: merge.text,
        clean: merge.clean,
      };
    });
    return { conflict: status.conflict, files };
  });

  app.post(`${API_PREFIX}/git/resolve`, async (request): Promise<GitResolveResponse> => {
    const body = parseOrThrow(GitResolveBodySchema, request.body, 'resolution');
    const resolved = await git.resolveConflict(body.files, body.message);

    // The resolution rewrote the working tree behind the store's back.
    await ctx.deps.store.rebuild();
    await ctx.wiring.reindexAll();
    await announcePulledPages(resolved);

    const status = await git.status();
    ctx.live.gitChanged(status);
    return { status, resolved };
  });
}
