import { randomBytes } from 'node:crypto';
import { cp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { CONTENT_DIR, SEED_DIR } from '../env';
import type {
  AuthState,
  CreatePageInput,
  Favorite,
  GitStatus,
  Page,
  PageSummary,
  Space,
  SpaceTree,
  UpdatePageInput,
} from './types';

const PREFIX = '/api/v1';

/** A slug nothing else in the run can collide with, so specs never share a space. */
export function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

async function unwrap<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.url()} -> ${String(response.status())}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/**
 * Everything a spec needs from the REST API, over the browser session of the signed-in
 * admin. Seed with it, then drive the UI; asserting on git belongs to ContentRepo.
 */
export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    readonly contentDir: string = CONTENT_DIR,
  ) {}

  async authState(): Promise<AuthState> {
    return unwrap<AuthState>(await this.request.get(`${PREFIX}/auth/state`));
  }

  async tree(): Promise<SpaceTree[]> {
    const body = await unwrap<{ spaces: SpaceTree[] }>(await this.request.get(`${PREFIX}/tree`));
    return body.spaces;
  }

  async spaces(): Promise<Space[]> {
    const body = await unwrap<{ spaces: Space[] }>(await this.request.get(`${PREFIX}/spaces`));
    return body.spaces;
  }

  async createSpace(input: {
    slug: string;
    name?: string;
    icon?: string;
    order?: number;
    private?: boolean;
  }): Promise<Space> {
    const data = { name: input.slug, ...input };
    const body = await unwrap<{ space: Space }>(await this.request.post(`${PREFIX}/spaces`, { data }));
    return body.space;
  }

  /** A space nothing else touches, with its home page already written. */
  async createUniqueSpace(prefix = 'e2e'): Promise<Space> {
    return this.createSpace({ slug: uniqueSlug(prefix) });
  }

  async listPages(): Promise<PageSummary[]> {
    const body = await unwrap<{ pages: PageSummary[] }>(await this.request.get(`${PREFIX}/pages`));
    return body.pages;
  }

  async createPage(input: CreatePageInput): Promise<Page> {
    const body = await unwrap<{ page: Page }>(await this.request.post(`${PREFIX}/pages`, { data: input }));
    return body.page;
  }

  async updatePage(id: string, patch: UpdatePageInput): Promise<Page> {
    const body = await unwrap<{ page: Page }>(await this.request.patch(`${PREFIX}/pages/${id}`, { data: patch }));
    return body.page;
  }

  async getPage(path: string): Promise<Page | null> {
    const response = await this.request.get(`${PREFIX}/pages`, { params: { path } });
    if (response.status() === 404) return null;
    const body = await unwrap<{ page: Page }>(response);
    return body.page;
  }

  /** Give a page the starter database, the way the slash commands do. */
  async makeDatabase(id: string): Promise<Page> {
    const body = await unwrap<{ page: Page }>(
      await this.request.put(`${PREFIX}/pages/${id}/database`, { data: {} }),
    );
    return body.page;
  }

  /** Take the database off a page again. The rows are records inside it, so they go with it. */
  async removeDatabase(id: string): Promise<Page> {
    const body = await unwrap<{ page: Page }>(
      await this.request.delete(`${PREFIX}/pages/${id}/database`),
    );
    return body.page;
  }

  async deletePage(id: string, options: { recursive?: boolean } = {}): Promise<string[]> {
    const params: Record<string, string> = options.recursive === true ? { recursive: 'true' } : {};
    const body = await unwrap<{ deleted: string[] }>(
      await this.request.delete(`${PREFIX}/pages/${id}`, { params }),
    );
    return body.deleted;
  }

  /** The pins of the signed-in account. They live per person, so the token client has none. */
  async favorites(): Promise<Favorite[]> {
    const body = await unwrap<{ favorites: Favorite[] }>(await this.request.get(`${PREFIX}/favorites`));
    return body.favorites;
  }

  async addFavorite(id: string): Promise<Favorite> {
    const body = await unwrap<{ favorite: Favorite }>(await this.request.put(`${PREFIX}/favorites/${id}`));
    return body.favorite;
  }

  async removeFavorite(id: string): Promise<void> {
    await unwrap<{ ok: true }>(await this.request.delete(`${PREFIX}/favorites/${id}`));
  }

  async gitStatus(): Promise<GitStatus> {
    return unwrap<GitStatus>(await this.request.get(`${PREFIX}/git/status`));
  }

  /** Commit now instead of waiting for the debounced autocommit. */
  async commit(message?: string): Promise<string | null> {
    const data = message === undefined ? {} : { message };
    const body = await unwrap<{ sha: string | null }>(await this.request.post(`${PREFIX}/git/commit`, { data }));
    return body.sha;
  }

  /** Read the working tree back into both indexes, after a change made behind the server's back. */
  async rescan(): Promise<number> {
    const body = await unwrap<{ pages: number }>(await this.request.post(`${PREFIX}/rescan`));
    return body.pages;
  }

  /**
   * Put the content tree of this workspace back to the one a fresh server writes: take it away,
   * copy the seed over it, and tell the server to read the result. Nothing else is touched;
   * extra workspaces, favorites, accounts and agents live outside the content directory, and a
   * spec that makes one still removes it itself.
   *
   * The seed is the running server's own first tree, copied out before any spec had a chance to
   * change it (`captureSeed` in e2e/scripts/run-server.mjs). So this names no kind of content,
   * which is the point: an enumerated clean-up forgets whichever kind it was written before.
   *
   * The rescan is what makes the raw filesystem work safe. A removal the API did not do would
   * otherwise be left to the content watcher, and the watcher drops any event for a file the
   * API wrote in the last five seconds (`recentWrites.consume` at apps/server/src/wiring.ts).
   * A page inside that window would live on in the index and in search.db pointing at a file
   * that is gone.
   */
  async reset(): Promise<void> {
    for (const entry of await readdir(this.contentDir)) {
      // `.git` is the history, not the content. A reset rewrites the tree, never the history.
      if (entry === '.git') continue;
      await rm(join(this.contentDir, entry), { recursive: true, force: true });
    }
    await cp(SEED_DIR, this.contentDir, { recursive: true });

    await this.rescan();
    // The wipe bypassed the write path, so nothing scheduled a commit for it. This stages the
    // working tree with `git add -A`, which is the only thing that records the removals.
    await this.commit('e2e: reset the content tree');
  }
}
