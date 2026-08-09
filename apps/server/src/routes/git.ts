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
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';
import type { ContentStore } from '../deps.js';
import type { WorkspaceParts } from '../workspaces.js';

/** Labels that end up inside the conflict markers of an unmergeable file. */
const OURS_LABEL = 'local';
const THEIRS_LABEL = 'remote';

/** The page a repo-relative file holds, when it holds one. */
function pagePathOf(file: string): PagePath | null {
  if (!file.toLowerCase().endsWith(PAGE_EXT)) return null;
  const candidate = relFileToPagePath(file);
  return isValidPagePath(candidate) ? candidate : null;
}

function titleOf(store: ContentStore, raw: string): string | null {
  if (raw.length === 0) return null;
  try {
    return store.parsePageFile(raw).frontmatter.title;
  } catch {
    return null;
  }
}

export function registerGitRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(`${API_PREFIX}/git/status`, async (request): Promise<GitStatusResponse> => {
    const { git } = await partsOf(ctx, request);
    return { status: await git.status() };
  });

  /** Push every page a pull rewrote to the tabs that have it open. */
  async function announcePulledPages(parts: WorkspaceParts, files: string[]): Promise<void> {
    for (const file of files) {
      const pagePath = pagePathOf(file);
      if (pagePath === null) continue;
      const page = await parts.store.getPageByPath(pagePath);
      if (page !== null) parts.live.pageChanged(page, 'pull', null);
    }
  }

  app.post(`${API_PREFIX}/git/pull`, async (request): Promise<GitPullResponse> => {
    const parts = await partsOf(ctx, request);
    const { status, pulled, files } = await parts.git.pull();
    // A pull rewrites arbitrary files, so rescan instead of guessing which. The store must go
    // first: reindexAll reads through it, and its index still describes the pre-pull tree.
    if (pulled > 0) {
      await parts.store.rebuild();
      await parts.wiring.reindexAll();
      await announcePulledPages(parts, files);
    }
    parts.live.gitChanged(status);
    return { status, pulled };
  });

  app.post(`${API_PREFIX}/git/push`, async (request): Promise<GitPushResponse> => {
    const parts = await partsOf(ctx, request);
    const result = await parts.git.push();
    parts.live.gitChanged(result.status);
    return result;
  });

  app.post(`${API_PREFIX}/git/commit`, async (request): Promise<GitCommitResponse> => {
    const { git } = await partsOf(ctx, request);
    const body = parseOrThrow(GitCommitBodySchema, request.body ?? {}, 'commit body');
    return { sha: await git.commit(body.message) };
  });

  /**
   * Everything the conflict UI needs: the three versions of each file plus a best-effort
   * three-way merge. `clean` says whether that merge needs a human at all.
   */
  app.get(`${API_PREFIX}/git/conflict`, async (request): Promise<GitConflictResponse> => {
    const { git, store } = await partsOf(ctx, request);
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
        title: titleOf(store, entry.local) ?? titleOf(store, entry.remote),
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
    const parts = await partsOf(ctx, request);
    const body = parseOrThrow(GitResolveBodySchema, request.body, 'resolution');
    const resolved = await parts.git.resolveConflict(body.files, body.message);

    // The resolution rewrote the working tree behind the store's back.
    await parts.store.rebuild();
    await parts.wiring.reindexAll();
    await announcePulledPages(parts, resolved);

    const status = await parts.git.status();
    parts.live.gitChanged(status);
    return { status, resolved };
  });
}
