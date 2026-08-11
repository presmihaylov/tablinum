import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { CONTENT_DIR, DEFAULT_PAGE_PATH, DEFAULT_SPACE_SLUG } from '../env';
import { ContentRepo } from './content';
import { pristineWelcome } from './welcome';
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

/** Depth first, shallowest first: a parent is always deleted before its children. */
function byDepth(a: string, b: string): number {
  const depth = a.split('/').length - b.split('/').length;
  return depth === 0 ? a.localeCompare(b) : depth;
}

/** What the content directory holds once reset() is done, page files and space files only. */
const FRESH_FILES = [`${DEFAULT_SPACE_SLUG}/_space.yml`, `${DEFAULT_SPACE_SLUG}/index.md`];

/**
 * Keeps the default space first for the home route, which redirects to the first page of the
 * first space. Spaces sort by `order` and only then by name, and a space a spec makes carries
 * no order, so a leaked one named before "Docs" would otherwise win that redirect.
 */
const DEFAULT_SPACE_ORDER = 0;

/**
 * Long enough for a directory removal to show up, short enough that a real leak is reported
 * in seconds. The probe runs before the first sleep, so a clean tree pays nothing.
 */
const SETTLE_MS = 2_000;

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

  async updateSpace(
    slug: string,
    patch: { name?: string; icon?: string | null; order?: number | null },
  ): Promise<Space> {
    const body = await unwrap<{ space: Space }>(
      await this.request.patch(`${PREFIX}/spaces/${slug}`, { data: patch }),
    );
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

  /**
   * Put the content tree of this workspace back to the one space and one welcome page a fresh
   * server writes. Nothing else: extra workspaces, favorites, accounts and agents are outside
   * it, and a spec that makes one still removes it itself.
   *
   * Every page goes through the API, whatever space it sits in, because a page delete rebuilds
   * the index and updates the search database before it answers. Removing the files instead
   * would leave that to the content watcher, and the watcher drops any event for a file the
   * API itself wrote in the last five seconds (`recentWrites.consume` at
   * apps/server/src/wiring.ts:334, TTL at :28). A removal inside that window is swallowed for
   * good, and the page lives on in the index and in search.db pointing at a file that is gone.
   *
   * Only the space file needs the filesystem, because no endpoint deletes a space. That same
   * echo suppression eats the unlink, so nothing schedules a commit for it; the explicit
   * commit below stages the working tree with `git add -A` and closes that hole. `GET /spaces`
   * re-reads the directory on every call (`listSpaceSlugs`), so there is no cached space list
   * to go stale and nothing to wait for.
   */
  async reset(): Promise<void> {
    const gone = new Set<string>();
    const pages = [...(await this.listPages())].sort((a, b) => byDepth(a.path, b.path));
    // The home page keeps its id through every delete below, so the restore needs no re-read.
    let homeId = pages.find((page) => page.path === DEFAULT_PAGE_PATH)?.id;
    for (const page of pages) {
      if (page.path === DEFAULT_PAGE_PATH) continue;
      // A recursive delete already took every descendant with it. The server says which ones,
      // so a delete that removed nothing cannot make this skip a page that is still there.
      if (gone.has(page.path)) continue;
      for (const path of await this.deletePage(page.id, { recursive: true })) gone.add(path);
    }

    const spaces = await this.spaces();
    const extra = spaces.filter((space) => space.slug !== DEFAULT_SPACE_SLUG);
    for (const space of extra) {
      await rm(join(this.contentDir, space.slug), { recursive: true, force: true });
    }
    // Only when the filesystem was touched: on a clean tree this costs no request at all.
    if (extra.length > 0) await this.commit('e2e: reset the content tree');

    // A spec may have removed the space the server started with; put it back with its home page.
    const docs = spaces.find((space) => space.slug === DEFAULT_SPACE_SLUG);
    if (docs === undefined) {
      await this.createSpace({ slug: DEFAULT_SPACE_SLUG, name: 'Docs', order: DEFAULT_SPACE_ORDER });
      homeId = (await this.getPage(DEFAULT_PAGE_PATH))?.id;
    }
    // Only when it is not pinned yet: the server writes the space with no order, so this costs
    // one request on the first reset of a run and none after it.
    if (docs !== undefined && docs.order !== DEFAULT_SPACE_ORDER) {
      await this.updateSpace(DEFAULT_SPACE_SLUG, { order: DEFAULT_SPACE_ORDER });
    }

    // Unconditional. An untouched page costs nothing on disk: serializePreserving hands back
    // the original bytes and the store skips a write whose bytes already match, so this cannot
    // dirty the git tree.
    const restore = await pristineWelcome();
    if (homeId === undefined) await this.createPage({ path: DEFAULT_PAGE_PATH, ...restore });
    if (homeId !== undefined) await this.updatePage(homeId, restore);

    // Read the result off the disk, not back through the API. The API answers through the same
    // viewer filter that chose what to delete, so it would only agree with itself; a private
    // space owned by another account is invisible to it and would survive unnoticed.
    await expect
      .poll(() => this.ownedFiles(), {
        message: 'the content directory still holds files the reset should have removed',
        timeout: SETTLE_MS,
      })
      .toEqual(FRESH_FILES);
  }

  /**
   * The page files and space files in the content directory, sorted. Attachments are left out
   * because the home page survives a reset and may still own the ones a spec uploaded to it. A
   * deleted page takes its own with it, so nothing here can be orphaned.
   */
  private async ownedFiles(): Promise<string[]> {
    const files = await new ContentRepo(this.contentDir).list();
    return files.filter(
      (file) => !file.startsWith('_assets/') && (file.endsWith('.md') || file.endsWith('_space.yml')),
    );
  }
}
