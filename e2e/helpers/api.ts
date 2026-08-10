import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { CONTENT_DIR, DEFAULT_PAGE_PATH, DEFAULT_SPACE_SLUG } from '../env';
import type {
  AuthState,
  CreatePageInput,
  GitStatus,
  Page,
  PageSummary,
  Space,
  SpaceTree,
  UpdatePageInput,
} from './types';

const PREFIX = '/api/v1';

/** The state a fresh content directory is in, restored by reset(). */
const WELCOME_TITLE = 'Welcome';
const WELCOME_MARKDOWN = 'This page is the starting point of the e2e content repository.\n';

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

  async createSpace(input: { slug: string; name?: string; icon?: string; order?: number }): Promise<Space> {
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
   * Put the server back where a fresh one starts: one space, one welcome page, nothing else.
   * Extra spaces have no delete endpoint, so their directories go from disk and the content
   * watcher re-indexes; the poll at the end waits for that to land.
   */
  async reset(): Promise<void> {
    const spaces = await this.spaces();
    for (const space of spaces) {
      if (space.slug === DEFAULT_SPACE_SLUG) continue;
      await rm(join(this.contentDir, space.slug), { recursive: true, force: true });
    }
    // A spec may have removed the space the server started with; put it back with its home page.
    if (!spaces.some((space) => space.slug === DEFAULT_SPACE_SLUG)) {
      await this.createSpace({ slug: DEFAULT_SPACE_SLUG, name: 'Docs' });
    }

    const deleted: string[] = [];
    const pages = [...(await this.listPages())].sort((a, b) => byDepth(a.path, b.path));
    for (const page of pages) {
      if (page.path === DEFAULT_PAGE_PATH) continue;
      if (page.space !== DEFAULT_SPACE_SLUG) continue;
      // A recursive delete already took every descendant with it.
      if (deleted.some((parent) => page.path.startsWith(`${parent}/`))) continue;
      await this.deletePage(page.id, { recursive: true });
      deleted.push(page.path);
    }

    await expect
      .poll(async () => (await this.spaces()).map((space) => space.slug), {
        message: 'extra spaces were not removed from the content directory',
      })
      .toEqual([DEFAULT_SPACE_SLUG]);

    await expect
      .poll(async () => (await this.listPages()).map((page) => page.path).sort(), {
        message: 'pages were still indexed after the reset',
      })
      .toEqual([DEFAULT_PAGE_PATH]);

    const home = await this.getPage(DEFAULT_PAGE_PATH);
    if (home !== null) {
      await this.updatePage(home.id, { title: WELCOME_TITLE, markdown: WELCOME_MARKDOWN });
    }
  }
}
