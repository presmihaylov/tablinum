import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ASSETS_DIR,
  INDEX_BASENAME,
  PAGE_EXT,
  conflict,
  contentRev,
  depth,
  internal,
  isDescendantOf,
  mergeText,
  newPageId,
  notFound,
  pagePathToRelFile,
  parentPath,
  relFileToPagePath,
  saveConflict,
  spaceFileRelPath,
  spaceOf,
  validation,
} from '@tablinum/shared';
import { Mutex, RevHistory } from '@tablinum/core';
import type {
  Backlink,
  CreatePageBody,
  CreateSpaceBody,
  Frontmatter,
  Page,
  PageId,
  PagePath,
  PageSummary,
  Space,
  TreeNode,
  UpdatePageBody,
  UpdateSpaceBody,
} from '@tablinum/shared';
import type { ContentStore, ParsedPageFile, SpaceTree } from '../../src/deps.js';
import {
  parseFlatYaml,
  parsePageFile,
  serializeFlatYaml,
  type Scalar,
  serializeFrontmatter,
} from './frontmatter.js';

const INDEX_FILE = `${INDEX_BASENAME}${PAGE_EXT}`;

function toSummary(page: Page): PageSummary {
  const { markdown: _markdown, ...summary } = page;
  return summary;
}

function titleize(segment: string): string {
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isIndexRel(rel: string): boolean {
  return rel === INDEX_FILE || rel.endsWith(`/${INDEX_FILE}`);
}

function compareByOrderThenTitle(
  a: { order?: number; title: string },
  b: { order?: number; title: string },
): number {
  const left = a.order ?? Number.POSITIVE_INFINITY;
  const right = b.order ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;
  return a.title.localeCompare(b.title);
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort(compareByOrderThenTitle);
  for (const node of nodes) sortNodes(node.children);
}

function buildTree(pages: PageSummary[], space: string): TreeNode[] {
  const byPath = new Map<PagePath, TreeNode>();
  const roots: TreeNode[] = [];
  const inSpace = pages
    .filter((page) => page.space === space && depth(page.path) > 1)
    .sort((a, b) => depth(a.path) - depth(b.path));

  for (const page of inSpace) {
    const node: TreeNode = {
      id: page.id,
      path: page.path,
      title: page.title,
      icon: page.icon,
      order: page.order,
      children: [],
    };
    byPath.set(page.path, node);
    const parent = parentPath(page.path);
    const parentNode = parent === null ? undefined : byPath.get(parent);
    if (parentNode === undefined) {
      roots.push(node);
      continue;
    }
    parentNode.children.push(node);
  }

  sortNodes(roots);
  return roots;
}

/**
 * A real content store over a real directory of markdown files: the file layout, the
 * frontmatter, leaf/parent promotion and stable ids all behave as the contract describes.
 * It lets the server test suite exercise the API end to end on its own.
 */
export class FsContentStore implements ContentStore {
  readonly #idByFile = new Map<string, PageId>();
  readonly #writes = new Mutex();
  readonly #history = new RevHistory();

  constructor(readonly contentDir: string) {}

  async init(): Promise<void> {
    await mkdir(join(this.contentDir, ASSETS_DIR), { recursive: true });
  }

  async rebuild(): Promise<void> {
    // This store reads the disk on every call, so there is no index to rebuild. The id cache is
    // dropped anyway, because a pull can replace a file with a different page.
    this.#idByFile.clear();
  }

  async listSpaces(): Promise<Space[]> {
    const entries = await readdir(this.contentDir, { withFileTypes: true });
    const spaces: Space[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const file = join(this.contentDir, spaceFileRelPath(entry.name));
      const record = existsSync(file) ? parseFlatYaml(await readFile(file, 'utf8')) : {};
      const space: Space = {
        slug: entry.name,
        name: typeof record.name === 'string' ? record.name : entry.name,
      };
      if (typeof record.icon === 'string') space.icon = record.icon;
      if (typeof record.order === 'number') space.order = record.order;
      spaces.push(space);
    }
    spaces.sort((a, b) => compareByOrderThenTitle({ ...a, title: a.name }, { ...b, title: b.name }));
    return spaces;
  }

  async createSpace(input: CreateSpaceBody): Promise<Space> {
    const dir = join(this.contentDir, input.slug);
    if (existsSync(dir)) throw conflict(`Space ${input.slug} already exists`);
    await mkdir(dir, { recursive: true });

    const descriptor: Record<string, Scalar> = { name: input.name };
    if (input.icon !== undefined) descriptor.icon = input.icon;
    if (input.order !== undefined) descriptor.order = input.order;
    await writeFile(
      join(this.contentDir, spaceFileRelPath(input.slug)),
      serializeFlatYaml(descriptor),
      'utf8',
    );

    const now = new Date().toISOString();
    const home: Frontmatter = {
      id: newPageId(),
      title: input.name,
      created: now,
      updated: now,
    };
    if (input.icon !== undefined) home.icon = input.icon;
    await writeFile(join(dir, INDEX_FILE), serializeFrontmatter(home), 'utf8');

    const space: Space = { slug: input.slug, name: input.name };
    if (input.icon !== undefined) space.icon = input.icon;
    if (input.order !== undefined) space.order = input.order;
    return space;
  }

  async updateSpace(slug: string, patch: UpdateSpaceBody): Promise<Space> {
    const file = join(this.contentDir, spaceFileRelPath(slug));
    if (!existsSync(file)) throw notFound(`No space ${slug}`);
    const record = parseFlatYaml(await readFile(file, 'utf8'));

    const current: Space = {
      slug,
      name: typeof record.name === 'string' ? record.name : slug,
    };
    if (typeof record.icon === 'string') current.icon = record.icon;
    if (typeof record.order === 'number') current.order = record.order;

    const next: Space = { slug, name: patch.name ?? current.name };
    const icon = patch.icon === undefined ? current.icon : (patch.icon ?? undefined);
    if (icon !== undefined) next.icon = icon;
    const order = patch.order === undefined ? current.order : (patch.order ?? undefined);
    if (order !== undefined) next.order = order;

    const descriptor: Record<string, Scalar> = { name: next.name };
    if (next.icon !== undefined) descriptor.icon = next.icon;
    if (next.order !== undefined) descriptor.order = next.order;
    await writeFile(file, serializeFlatYaml(descriptor), 'utf8');
    return next;
  }

  async getTree(): Promise<SpaceTree[]> {
    const spaces = await this.listSpaces();
    const pages = await this.listPages();
    return spaces.map((space) => ({ ...space, tree: buildTree(pages, space.slug) }));
  }

  async listPages(): Promise<PageSummary[]> {
    return (await this.#allPages()).map(toSummary);
  }


  async getPageByPath(path: PagePath): Promise<Page | null> {
    const rel = this.#fileOf(path);
    return rel === null ? null : this.#read(rel);
  }

  async getPageById(id: PageId): Promise<Page | null> {
    for (const page of await this.#allPages()) {
      if (page.id === id) return page;
    }
    return null;
  }

  async createPage(input: CreatePageBody): Promise<Page> {
    if (this.#fileOf(input.path) !== null) {
      throw conflict(`A page already exists at ${input.path}`);
    }

    const parent = parentPath(input.path);
    if (parent === null && !existsSync(join(this.contentDir, input.path))) {
      throw notFound(`No space ${input.path}. Create the space first.`);
    }
    if (parent !== null) {
      const space = spaceOf(input.path);
      if (!existsSync(join(this.contentDir, space))) {
        throw notFound(`No space ${space}. Create the space first.`);
      }
      await this.#ensureAncestors(input.path);
    }

    const now = new Date().toISOString();
    const frontmatter: Frontmatter = {
      id: newPageId(),
      title: input.title,
      created: now,
      updated: now,
    };
    if (input.icon !== undefined) frontmatter.icon = input.icon;
    if (input.order !== undefined) frontmatter.order = input.order;

    const rel = pagePathToRelFile(input.path, parent === null);
    const abs = join(this.contentDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, serializeFrontmatter(frontmatter) + (input.markdown ?? ''), 'utf8');

    const page = await this.#read(rel);
    if (page === null) throw internal(`Failed to read back ${rel}`);
    return page;
  }

  /** Serialised like the real store, so a test can hold this double to the same promises. */
  async updatePage(id: PageId, patch: UpdatePageBody): Promise<Page> {
    return this.#writes.runExclusive(() => this.#updatePageUnlocked(id, patch));
  }

  async #updatePageUnlocked(id: PageId, patch: UpdatePageBody): Promise<Page> {
    const current = await this.getPageById(id);
    if (current === null) throw notFound(`No page with id ${id}`);
    const merged = this.#reconcile(id, patch, current);

    let rel = this.#fileOf(current.path);
    if (rel === null) throw notFound(`No file for page ${current.path}`);
    if (patch.path !== undefined && patch.path !== current.path) {
      rel = await this.#move(current, patch.path);
    }

    const page = await this.#read(rel);
    if (page === null) throw internal(`Failed to read back ${rel}`);

    const frontmatter: Frontmatter = {
      id: page.id,
      title: patch.title ?? page.title,
      created: page.created,
      updated: new Date().toISOString(),
    };

    const icon = patch.icon === null ? undefined : (patch.icon ?? page.icon);
    if (icon !== undefined) frontmatter.icon = icon;


    const order = patch.order === null ? undefined : (patch.order ?? page.order);
    if (order !== undefined) frontmatter.order = order;


    const markdown = merged ?? page.markdown;
    await writeFile(page.filePath, serializeFrontmatter(frontmatter) + markdown, 'utf8');

    const updated = await this.#read(rel);
    if (updated === null) throw internal(`Failed to read back ${rel}`);
    this.#history.record(id, updated.rev, updated.markdown);
    return updated;
  }

  /** The real store's rule: merge a stale edit when it can, refuse it when it genuinely clashes. */
  #reconcile(id: PageId, patch: UpdatePageBody, current: Page): string | null {
    if (patch.markdown === undefined) return null;
    if (patch.baseRev === undefined) return patch.markdown;

    this.#history.record(id, current.rev, current.markdown);
    if (patch.baseRev === current.rev) return patch.markdown;

    const base = this.#history.find(id, patch.baseRev);
    if (base !== null) {
      const result = mergeText(base, patch.markdown, current.markdown);
      if (result.clean) return result.text;
    }

    throw saveConflict('The page changed since this edit started', {
      markdown: current.markdown,
      rev: current.rev,
      updated: current.updated,
    });
  }

  async deletePage(id: PageId, recursive: boolean): Promise<PagePath[]> {
    const page = await this.getPageById(id);
    if (page === null) throw notFound(`No page with id ${id}`);

    const descendants = (await this.listPages()).filter((summary) =>
      isDescendantOf(summary.path, page.path),
    );
    if (descendants.length > 0 && !recursive) {
      throw conflict(
        `${page.path} has ${descendants.length} child page(s). Pass recursive=true to delete them.`,
      );
    }

    if (page.hasChildren) {
      await rm(join(this.contentDir, page.path), { recursive: true, force: true });
    } else {
      await rm(join(this.contentDir, pagePathToRelFile(page.path, false)), { force: true });
    }
    await this.#demoteIfEmpty(parentPath(page.path));

    return [page.path, ...descendants.map((summary) => summary.path)].sort();
  }

  async getBacklinks(id: PageId): Promise<Backlink[]> {
    const target = await this.getPageById(id);
    if (target === null) return [];
    const needles = [`[[${target.path}]]`, `[[${target.path}|`];
    const backlinks: Backlink[] = [];
    for (const page of await this.#allPages()) {
      if (page.id === id) continue;
      if (!needles.some((needle) => page.markdown.includes(needle))) continue;
      backlinks.push({ id: page.id, path: page.path, title: page.title });
    }
    return backlinks;
  }

  async reloadFile(relFile: string): Promise<Page | null> {
    return this.#read(relFile);
  }

  async forgetFile(relFile: string): Promise<PageId | null> {
    const id = this.#idByFile.get(relFile) ?? null;
    this.#idByFile.delete(relFile);
    return id;
  }

  parsePageFile(raw: string): ParsedPageFile {
    return parsePageFile(raw);
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  /** Mirrors the core store: a deep create fills in every ancestor that is missing. */
  async #ensureAncestors(target: PagePath): Promise<void> {
    const parts = target.split('/');
    for (let end = 1; end < parts.length; end += 1) {
      const ancestor = parts.slice(0, end).join('/') as PagePath;
      const file = this.#fileOf(ancestor);
      // The first child turns the ancestor from `foo.md` into `foo/index.md`.
      if (file !== null && !isIndexRel(file)) await this.#promote(ancestor);
      if (file !== null) continue;
      const now = new Date().toISOString();
      const frontmatter: Frontmatter = {
        id: newPageId(),
        title: titleize(parts[end - 1] ?? ancestor),
        created: now,
        updated: now,
      };
      const abs = join(this.contentDir, pagePathToRelFile(ancestor, true));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, serializeFrontmatter(frontmatter), 'utf8');
    }
  }

  #fileOf(path: PagePath): string | null {
    const leaf = pagePathToRelFile(path, false);
    if (existsSync(join(this.contentDir, leaf))) return leaf;
    const index = pagePathToRelFile(path, true);
    if (existsSync(join(this.contentDir, index))) return index;
    return null;
  }

  async #listFiles(relDir = ''): Promise<string[]> {
    const abs = relDir === '' ? this.contentDir : join(this.contentDir, relDir);
    const entries = await readdir(abs, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === ASSETS_DIR) continue;
        files.push(...(await this.#listFiles(rel)));
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(PAGE_EXT)) files.push(rel);
    }
    return files.sort();
  }

  async #allPages(): Promise<Page[]> {
    const pages: Page[] = [];
    for (const rel of await this.#listFiles()) {
      const page = await this.#read(rel);
      if (page !== null) pages.push(page);
    }
    return pages;
  }

  async #read(relFile: string): Promise<Page | null> {
    const abs = join(this.contentDir, relFile);
    let raw: string;
    try {
      raw = await readFile(abs, 'utf8');
    } catch {
      return null;
    }
    const { frontmatter, markdown } = parsePageFile(raw);
    const path = relFileToPagePath(relFile);
    this.#idByFile.set(relFile, frontmatter.id);

    const page: Page = {
      id: frontmatter.id,
      path,
      space: spaceOf(path),
      title: frontmatter.title,
      created: frontmatter.created,
      updated: frontmatter.updated,
      markdown,
      rev: contentRev(markdown),
      filePath: abs,
      hasChildren: isIndexRel(relFile),
    };
    if (frontmatter.icon !== undefined) page.icon = frontmatter.icon;
    if (frontmatter.order !== undefined) page.order = frontmatter.order;
    // Like the real store: every rev a caller can hold was read here, so this is where the
    // merge base is learnt.
    this.#history.record(page.id, page.rev, page.markdown);
    return page;
  }

  async #promote(path: PagePath): Promise<void> {
    const from = join(this.contentDir, pagePathToRelFile(path, false));
    const to = join(this.contentDir, pagePathToRelFile(path, true));
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  }

  /** Removing the last child turns `foo/index.md` back into `foo.md`. */
  async #demoteIfEmpty(path: PagePath | null): Promise<void> {
    if (path === null) return;
    if (depth(path) <= 1) return; // a space root always keeps its index.md
    const dir = join(this.contentDir, path);
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    const survivors = entries.filter((entry) => !(entry.isFile() && entry.name === INDEX_FILE));
    if (survivors.length > 0) return;
    if (!existsSync(join(dir, INDEX_FILE))) return;
    await rename(join(dir, INDEX_FILE), join(this.contentDir, pagePathToRelFile(path, false)));
    await rm(dir, { recursive: true, force: true });
  }

  async #move(current: Page, target: PagePath): Promise<string> {
    if (isDescendantOf(target, current.path)) {
      throw validation(`Cannot move ${current.path} inside itself`);
    }
    if (this.#fileOf(target) !== null) throw conflict(`A page already exists at ${target}`);

    const targetParent = parentPath(target);
    if (targetParent !== null) {
      const parentFile = this.#fileOf(targetParent);
      if (parentFile === null) throw notFound(`No parent page at ${targetParent}`);
      if (!isIndexRel(parentFile)) await this.#promote(targetParent);
    }

    const sourceParent = parentPath(current.path);
    const from = current.hasChildren
      ? join(this.contentDir, current.path)
      : join(this.contentDir, pagePathToRelFile(current.path, false));
    const to = current.hasChildren
      ? join(this.contentDir, target)
      : join(this.contentDir, pagePathToRelFile(target, false));

    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    await this.#demoteIfEmpty(sourceParent);

    return pagePathToRelFile(target, current.hasChildren);
  }
}
