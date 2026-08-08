import {
  baseName,
  parentPath,
  type Frontmatter,
  type PageId,
  type PagePath,
} from '@gitdocs/shared';
import { parse } from './frontmatter.js';
import { readTextOrNull, statOrNull } from './fs-utils.js';
import { consoleLogger, type Logger } from './logger.js';
import { scanPageFiles, type ScannedPageFile } from './scan.js';

/** A page as the index knows it: everything except the markdown body. */
export interface IndexedPage {
  id: PageId;
  path: PagePath;
  filePath: string;
  relFile: string;
  isIndex: boolean;
  hasChildren: boolean;
  frontmatter: Frontmatter;
  /** True when the file on disk is missing information the store had to invent. */
  repaired: boolean;
}

export interface IndexMapOptions {
  contentDir: string;
  logger?: Logger;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  frontmatter: Frontmatter;
  repaired: boolean;
}

/**
 * In-memory map from page id to file. Rebuilt by scanning the content tree; a stat cache keeps
 * repeated rebuilds cheap while still picking up edits made outside the app.
 */
export class IndexMap {
  readonly contentDir: string;
  readonly #logger: Logger;
  readonly #byId = new Map<PageId, IndexedPage>();
  readonly #byPath = new Map<PagePath, IndexedPage>();
  readonly #cache = new Map<string, CacheEntry>();
  #ordered: IndexedPage[] = [];
  #built = false;
  #duplicateIds: PageId[] = [];

  constructor(options: IndexMapOptions) {
    this.contentDir = options.contentDir;
    this.#logger = options.logger ?? consoleLogger;
  }

  get built(): boolean {
    return this.#built;
  }

  get size(): number {
    return this.#ordered.length;
  }

  /** Page ids that appeared more than once during the last rebuild. */
  get duplicateIds(): readonly PageId[] {
    return this.#duplicateIds;
  }

  markStale(): void {
    this.#built = false;
  }

  async ensureBuilt(): Promise<void> {
    if (this.#built) return;
    await this.rebuild();
  }

  async rebuild(): Promise<void> {
    const files = await scanPageFiles(this.contentDir);
    const parents = new Set<PagePath>();
    for (const file of files) {
      const parent = parentPath(file.path);
      if (parent !== null) parents.add(parent);
    }

    this.#byId.clear();
    this.#byPath.clear();
    this.#duplicateIds = [];
    const ordered: IndexedPage[] = [];
    const seenFiles = new Set<string>();

    for (const file of files) {
      const entry = await this.#load(file);
      if (entry === null) continue;
      seenFiles.add(file.filePath);

      // A shadowed file is dropped outright. Leaving it in `ordered` would show a page the API
      // cannot read, update or delete, because every lookup goes through the id and path maps.
      const clash = this.#byPath.get(file.path);
      if (clash !== undefined) {
        this.#logger.warn(
          `Duplicate page path ${file.path}: keeping ${clash.relFile}, ignoring ${file.relFile}`,
        );
        continue;
      }
      const existing = this.#byId.get(entry.frontmatter.id);
      if (existing !== undefined) {
        this.#duplicateIds.push(entry.frontmatter.id);
        this.#logger.warn(
          `Duplicate page id ${entry.frontmatter.id}: keeping ${existing.relFile}, ignoring ${file.relFile}`,
        );
        continue;
      }

      const page: IndexedPage = {
        id: entry.frontmatter.id,
        path: file.path,
        filePath: file.filePath,
        relFile: file.relFile,
        isIndex: file.isIndex,
        hasChildren: parents.has(file.path),
        frontmatter: entry.frontmatter,
        repaired: entry.repaired,
      };
      ordered.push(page);
      this.#byPath.set(page.path, page);
      this.#byId.set(page.id, page);
    }

    for (const key of [...this.#cache.keys()]) {
      if (!seenFiles.has(key)) this.#cache.delete(key);
    }

    this.#ordered = ordered;
    this.#built = true;
  }

  async #load(file: ScannedPageFile): Promise<CacheEntry | null> {
    const stats = await statOrNull(file.filePath);
    if (stats === null) return null;
    const cached = this.#cache.get(file.filePath);
    if (cached !== undefined && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached;
    }
    const raw = await readTextOrNull(file.filePath);
    if (raw === null) return null;
    const parsed = parse(raw, { filename: baseName(file.path) });
    if (parsed.blockBroken) {
      this.#logger.warn(
        `Frontmatter of ${file.relFile} is not valid YAML: recovered what could be read, leaving the file untouched`,
      );
    }
    const entry: CacheEntry = {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      frontmatter: parsed.frontmatter,
      repaired: parsed.repaired,
    };
    this.#cache.set(file.filePath, entry);
    return entry;
  }

  byId(id: PageId): IndexedPage | undefined {
    return this.#byId.get(id);
  }

  byPath(pagePath: PagePath): IndexedPage | undefined {
    return this.#byPath.get(pagePath);
  }

  filePathById(id: PageId): string | undefined {
    return this.#byId.get(id)?.filePath;
  }

  has(pagePath: PagePath): boolean {
    return this.#byPath.has(pagePath);
  }

  /** Every indexed page, sorted by path. */
  all(): IndexedPage[] {
    return [...this.#ordered];
  }

  childrenOf(pagePath: PagePath): IndexedPage[] {
    return this.#ordered.filter((page) => parentPath(page.path) === pagePath);
  }

  descendantsOf(pagePath: PagePath): IndexedPage[] {
    const prefix = `${pagePath}/`;
    return this.#ordered.filter((page) => page.path.startsWith(prefix));
  }

  /** Drop the stat cache. Used when files may have changed without changing size or mtime. */
  clearCache(): void {
    this.#cache.clear();
  }
}
