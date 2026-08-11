import type { FastifyRequest } from 'fastify';
import { notFound, spaceOf, type PagePath, type PageId, type Space } from '@tablinum/shared';
import type {
  Backlink,
  CreatePageBody,
  CreateRowBody,
  CreateSpaceBody,
  Database,
  DbRow,
  Page,
  PageSummary,
  RowProps,
  UpdatePageBody,
  UpdateRowBody,
  UpdateSpaceBody,
} from '@tablinum/shared';
import type { ContentStore, OrphanedAssets, ParsedPageFile, SpaceTree } from './deps.js';

/**
 * Private spaces.
 *
 * A space with an `owner` in its `_space.yml` belongs to one person. Nobody else sees it, not
 * even an admin: "private" that an admin can read is not private. An agent token is not a
 * person at all, so it sees only the public spaces.
 *
 * Enforcement sits in one wrapper around the content store rather than in each route. Every
 * route reads content through `partsOf()`, so wrapping there covers the routes that exist and
 * the ones written later, which a per-route check would not.
 *
 * A hidden space answers NOT_FOUND, never FORBIDDEN. Saying "you may not open this" would
 * confirm the space exists, and the slug alone can be the secret.
 */

/** Who is looking. Null for an agent token or a public request: neither is a person. */
export function viewerOf(request: FastifyRequest): string | null {
  return request.principal.account?.id ?? null;
}

/** True when a space with this owner is visible to this viewer. */
export function visibleTo(owner: string | undefined, viewer: string | null): boolean {
  if (owner === undefined) return true;
  return viewer !== null && owner === viewer;
}

/** Every private space as slug -> owner. Public spaces are left out. */
export async function privateSpacesOf(store: ContentStore): Promise<Map<string, string>> {
  const owned = new Map<string, string>();
  for (const space of await store.listSpaces()) {
    if (space.owner !== undefined) owned.set(space.slug, space.owner);
  }
  return owned;
}

/** The slugs this viewer must not see. Empty for a workspace with no private space in it. */
export async function hiddenSpacesFor(store: ContentStore, viewer: string | null): Promise<Set<string>> {
  const spaces = await store.listSpaces();
  return new Set(spaces.filter((space) => !visibleTo(space.owner, viewer)).map((space) => space.slug));
}

/** The store as one viewer sees it. Returns the store itself when nothing is private. */
export function guardPrivateSpaces(store: ContentStore, viewer: string | null): ContentStore {
  return new PrivateContentStore(store, viewer);
}

class PrivateContentStore implements ContentStore {
  constructor(
    private readonly inner: ContentStore,
    private readonly viewer: string | null,
  ) {}

  get contentDir(): string {
    return this.inner.contentDir;
  }

  // Read every time rather than caching: a space created during this request must be visible
  // to the rest of it, and listSpaces() is already what every tree read costs.
  async #hidden(): Promise<Set<string>> {
    return hiddenSpacesFor(this.inner, this.viewer);
  }

  async #refuseHiddenSpace(slug: string): Promise<void> {
    if ((await this.#hidden()).has(slug)) throw notFound(`No space ${slug}`);
  }

  async #refuseHiddenPath(path: PagePath): Promise<void> {
    await this.#refuseHiddenSpace(spaceOf(path));
  }

  /** Make a page in a hidden space look absent before the inner store is asked about it. */
  async #refuseHiddenPage(id: PageId): Promise<void> {
    const page = await this.inner.getPageById(id);
    if (page === null) return; // Let the inner call produce the ordinary "no such page".
    await this.#refuseHiddenPath(page.path);
  }

  init(): Promise<void> {
    return this.inner.init();
  }

  rebuild(): Promise<void> {
    return this.inner.rebuild();
  }

  async listSpaces(): Promise<Space[]> {
    const spaces = await this.inner.listSpaces();
    return spaces.filter((space) => visibleTo(space.owner, this.viewer));
  }

  createSpace(input: CreateSpaceBody, owner?: string): Promise<Space> {
    return this.inner.createSpace(input, owner);
  }

  async updateSpace(slug: string, patch: UpdateSpaceBody): Promise<Space> {
    await this.#refuseHiddenSpace(slug);
    return this.inner.updateSpace(slug, patch);
  }

  async deleteSpace(slug: string, recursive: boolean): Promise<PagePath[]> {
    await this.#refuseHiddenSpace(slug);
    return this.inner.deleteSpace(slug, recursive);
  }

  async getTree(): Promise<SpaceTree[]> {
    const tree = await this.inner.getTree();
    return tree.filter((space) => visibleTo(space.owner, this.viewer));
  }

  async listPages(): Promise<PageSummary[]> {
    const hidden = await this.#hidden();
    const pages = await this.inner.listPages();
    return pages.filter((page) => !hidden.has(spaceOf(page.path)));
  }

  async getPageByPath(path: PagePath): Promise<Page | null> {
    if ((await this.#hidden()).has(spaceOf(path))) return null;
    return this.inner.getPageByPath(path);
  }

  async getPageById(id: PageId): Promise<Page | null> {
    const page = await this.inner.getPageById(id);
    if (page === null) return null;
    return (await this.#hidden()).has(spaceOf(page.path)) ? null : page;
  }

  async createPage(input: CreatePageBody): Promise<Page> {
    await this.#refuseHiddenPath(input.path);
    return this.inner.createPage(input);
  }

  async updatePage(id: PageId, patch: UpdatePageBody): Promise<Page> {
    await this.#refuseHiddenPage(id);
    // A move names a second space, and that one has to be visible too.
    if (patch.path !== undefined) await this.#refuseHiddenPath(patch.path);
    return this.inner.updatePage(id, patch);
  }

  async deletePage(id: PageId, recursive: boolean): Promise<PagePath[]> {
    await this.#refuseHiddenPage(id);
    return this.inner.deletePage(id, recursive);
  }

  // No filter: the page is already gone, so there is no space left to decide visibility from.
  removeOrphanedAssets(pageIds: Iterable<PageId>): Promise<OrphanedAssets> {
    return this.inner.removeOrphanedAssets(pageIds);
  }

  async getBacklinks(id: PageId): Promise<Backlink[]> {
    await this.#refuseHiddenPage(id);
    const hidden = await this.#hidden();
    // A private page may link to a public one, so the list itself is filtered as well.
    return (await this.inner.getBacklinks(id)).filter((link) => !hidden.has(spaceOf(link.path)));
  }

  reloadFile(relFile: string): Promise<Page | null> {
    return this.inner.reloadFile(relFile);
  }

  forgetFile(relFile: string): Promise<PageId | null> {
    return this.inner.forgetFile(relFile);
  }

  parsePageFile(raw: string): ParsedPageFile {
    return this.inner.parsePageFile(raw);
  }

  async getDatabase(id: PageId): Promise<{ page: Page; database: Database; rows: DbRow[] }> {
    await this.#refuseHiddenPage(id);
    return this.inner.getDatabase(id);
  }

  async setDatabase(
    id: PageId,
    database: Database,
    baseRev?: string,
    rows?: Record<string, RowProps>,
  ): Promise<Page> {
    await this.#refuseHiddenPage(id);
    return this.inner.setDatabase(id, database, baseRev, rows);
  }

  async removeDatabase(id: PageId): Promise<Page> {
    await this.#refuseHiddenPage(id);
    return this.inner.removeDatabase(id);
  }

  async createRow(id: PageId, input: CreateRowBody): Promise<DbRow> {
    await this.#refuseHiddenPage(id);
    return this.inner.createRow(id, input);
  }

  async updateRow(id: PageId, rowId: string, patch: UpdateRowBody): Promise<DbRow> {
    await this.#refuseHiddenPage(id);
    return this.inner.updateRow(id, rowId, patch);
  }

  async deleteRow(id: PageId, rowId: string): Promise<void> {
    await this.#refuseHiddenPage(id);
    return this.inner.deleteRow(id, rowId);
  }
}
