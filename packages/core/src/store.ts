import path from 'node:path';
import {
  CreatePageBodySchema,
  DatabaseSchema,
  databaseRev,
  mergeDatabases,
  INDEX_BASENAME,
  MAX_ROWS,
  PAGE_EXT,
  NewSpaceSlugSchema,
  SpaceFileSchema,
  SpaceSlugSchema,
  UpdatePageBodySchema,
  UpdateSpaceBodySchema,
  assertValidPagePath,
  assetRelPath,
  assetUrl,
  baseName,
  coerceProps,
  coerceValue,
  conflict,
  contentRev,
  depth,
  isDescendantOf,
  isPageId,
  mergeText,
  moveRowBefore,
  newPageId,
  newRow,
  notFound,
  pagePathToRelFile,
  parentPath,
  parseOrThrow,
  saveConflict,
  segments,
  spaceFileRelPath,
  spaceOf,
  UNTITLED_ROW,
  validation,
  type Backlink,
  type Database,
  type DbRow,
  type Frontmatter,
  type Page,
  type PageId,
  type PagePath,
  type PageSummary,
  type RowProps,
  type Space,
  type TreeNode,
  type UpdateSpaceBody,
} from '@tablinum/shared';
import {
  frontmatterEqual,
  normalizeBody,
  normalizeIcon,
  parse,
  serialize,
  serializePreserving,
  titleize,
  type ParsedFile,
} from './frontmatter.js';
import {
  ensureDir,
  isDirectory,
  isMissingError,
  pathExists,
  readDirNames,
  readTextOrNull,
  removeDirIfEmpty,
  removeFile,
  rename,
  resolveInside,
  writeBytes,
  writeText,
} from './fs-utils.js';
import { IndexMap, type IndexedPage } from './index-map.js';
import { buildBacklinkIndex, createPageResolver, resolveWikilinks, type LinkedPage } from './links.js';
import { consoleLogger, type Logger } from './logger.js';
import { Mutex } from './mutex.js';
import { RevHistory } from './rev-history.js';
import { listSpaceSlugs } from './scan.js';
import { parseSpaceFile, serializeSpaceFile } from './space-file.js';

const INDEX_FILE = `${INDEX_BASENAME}${PAGE_EXT}`;

/**
 * How many schema revisions per page stay mergeable. A schema edit is a click, not a keystroke,
 * so a handful covers every burst a person or a room of people produces.
 */
const SCHEMA_HISTORY_DEPTH = 16;

export const DEFAULT_SPACE_SLUG = 'docs';
export const DEFAULT_SPACE_NAME = 'Docs';
export const WELCOME_TITLE = 'Welcome';

export const WELCOME_MARKDOWN = `# Welcome to tablinum

This page lives at \`docs/index.md\` in your content repository. Every page here is a markdown
file with YAML frontmatter, and every edit is a commit.

## Write

- Type \`/\` on an empty line to insert a block.
- Drag a page in the sidebar to move it or to change its order.
- Link to another page with \`[[docs/welcome]]\`.

## Automate

The same content is available over the REST API under \`/api/v1\` and over MCP. Edits made in the
editor, through the API, or straight in the git repository all land in the same history.
`;

export interface ContentStoreOptions {
  /** Absolute path of the content repository. */
  contentDir: string;
  logger?: Logger;
  /** Clock, injectable so tests get stable timestamps. */
  now?: () => Date;
  /** Write the starter space into an empty directory. A new workspace brings its own. */
  starter?: boolean;
}

export interface SpaceTree extends Space {
  tree: TreeNode[];
}

export interface CreatePageInput {
  path: PagePath;
  title: string;
  markdown?: string;
  icon?: string;
  order?: number;
}

export interface UpdatePageInput {
  title?: string;
  markdown?: string;
  /** null clears the icon. */
  icon?: string | null;
  /** null clears the manual sort order. */
  order?: number | null;
  /** A new path moves or renames the page and carries its children along. */
  path?: PagePath;
  /** Revision the edit started from. Set it to make a body edit fail on a stale copy. */
  baseRev?: string;
}

interface NewPageFields {
  icon?: string;
  order?: number;
}

export interface CreateRowInput {
  title?: string;
  props?: Record<string, unknown>;
}

export interface UpdateRowInput {
  props?: Record<string, unknown>;
  title?: string;
  /** Where the row lands: in front of this row, or at the end when null. Absent leaves it. */
  before?: string | null;
}


/** Overrides for the home page a new space is created with. */
interface SpaceHome {
  title: string;
  markdown: string;
}

/** Everything a new space carries besides its slug and its name. */
export interface CreateSpaceOptions {
  icon?: string;
  order?: number;
  /**
   * The user id this space belongs to. A space with an owner is private: only that person sees
   * it, and the git layer excludes its directory so the files never reach a remote.
   */
  owner?: string;
}

function compareSpaces(a: Space, b: Space): number {
  const left = a.order ?? Number.POSITIVE_INFINITY;
  const right = b.order ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left < right ? -1 : 1;
  const byName = a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  const left = a.order ?? Number.POSITIVE_INFINITY;
  const right = b.order ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left < right ? -1 : 1;
  const byTitle = a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' });
  if (byTitle !== 0) return byTitle;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort(compareNodes);
  for (const node of nodes) sortTree(node.children);
  return nodes;
}

function toNode(page: IndexedPage): TreeNode {
  const node: TreeNode = {
    id: page.id,
    path: page.path,
    title: page.frontmatter.title,
    children: [],
  };
  if (page.frontmatter.icon !== undefined) node.icon = page.frontmatter.icon;
  if (page.frontmatter.order !== undefined) node.order = page.frontmatter.order;
  return node;
}

/** Nest a flat page list. A page whose parent is missing becomes a root of its own. */
function buildTree(pages: readonly IndexedPage[]): TreeNode[] {
  const nodes = new Map<PagePath, TreeNode>();
  for (const page of pages) nodes.set(page.path, toNode(page));
  const roots: TreeNode[] = [];
  const ordered = [...pages].sort((a, b) => depth(a.path) - depth(b.path));
  for (const page of ordered) {
    const node = nodes.get(page.path);
    if (node === undefined) continue;
    const parent = parentPath(page.path);
    const parentNode = parent === null ? undefined : nodes.get(parent);
    if (parentNode === undefined) {
      roots.push(node);
      continue;
    }
    parentNode.children.push(node);
  }
  return sortTree(roots);
}

/** An absent patch keeps the icon, null clears it, and a string replaces it. */
function patchedIcon(current: string | undefined, patch: string | null | undefined): string | undefined {
  if (patch === undefined) return current;
  if (patch === null) return undefined;
  return normalizeIcon(patch) ?? undefined;
}

/**
 * The rows a caller sees. A property can be renamed, retyped or removed after a cell was
 * written, so every cell is read back through the schema that is in force now.
 */
function rowsFor(database: Database, rows: readonly DbRow[] | undefined): DbRow[] {
  return (rows ?? []).map((row) => ({ ...row, props: coerceProps(database.properties, row.props) }));
}

function toSummary(page: IndexedPage): PageSummary {
  const frontmatter = page.frontmatter;
  const summary: PageSummary = {
    id: page.id,
    path: page.path,
    space: spaceOf(page.path),
    title: frontmatter.title,
    created: frontmatter.created,
    updated: frontmatter.updated,
    filePath: page.filePath,
    hasChildren: page.hasChildren,
  };
  if (frontmatter.icon !== undefined) summary.icon = frontmatter.icon;
  if (frontmatter.order !== undefined) summary.order = frontmatter.order;
  return summary;
}

/**
 * The content store. Every page is a markdown file with YAML frontmatter under `contentDir`;
 * nothing else holds state, so an agent editing the files directly and a person editing in the
 * browser see exactly the same content.
 */
export class ContentStore {
  readonly contentDir: string;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #starter: boolean;
  readonly #index: IndexMap;
  // Fastify serves requests concurrently and every write below is a chain of awaits, so two
  // requests would otherwise interleave between the "is this free" check and the write.
  readonly #writes = new Mutex();
  readonly #history = new RevHistory();
  // A schema is small and a click storm is short, so a shallow memory is enough to merge one.
  readonly #schemas = new RevHistory(SCHEMA_HISTORY_DEPTH);

  constructor(options: ContentStoreOptions) {
    const dir = options.contentDir;
    if (typeof dir !== 'string' || dir.length === 0) throw validation('contentDir is required');
    if (!path.isAbsolute(dir)) {
      throw validation(`contentDir must be an absolute path, got ${JSON.stringify(dir)}`);
    }
    this.contentDir = path.resolve(dir);
    this.#logger = options.logger ?? consoleLogger;
    this.#now = options.now ?? ((): Date => new Date());
    this.#starter = options.starter ?? true;
    this.#index = new IndexMap({ contentDir: this.contentDir, logger: this.#logger });
  }

  /** The id index. Read-only for callers; the store keeps it fresh. */
  get index(): IndexMap {
    return this.#index;
  }

  #nowIso(): string {
    return this.#now().toISOString();
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create the content directory and, when it is empty and `starter` is on, a starter space with
   * a welcome page.
   */
  async init(): Promise<void> {
    await this.#writes.runExclusive(async () => {
      await ensureDir(this.contentDir);
      await this.#index.rebuild();
      await this.#persistRepairs();
      if (!this.#starter || this.#index.size > 0) return;
      const slugs = await listSpaceSlugs(this.contentDir);
      if (slugs.length > 0) return;
      await this.#createSpaceUnlocked(DEFAULT_SPACE_SLUG, DEFAULT_SPACE_NAME, {}, {
        title: WELCOME_TITLE,
        markdown: WELCOME_MARKDOWN,
      });
    });
  }

  /** Re-scan the content directory. Call this after an external edit. */
  async rebuild(): Promise<void> {
    await this.#writes.runExclusive(async () => {
      await this.#index.rebuild();
      await this.#persistRepairs();
    });
  }

  /**
   * Write invented frontmatter back to any file that lacked it. Without this the generated id
   * only lives in memory, so a hand-written .md file gets a different id after every restart
   * and every link, bookmark and index row that names it goes stale.
   */
  async #persistRepairs(): Promise<void> {
    const broken = this.#index.all().filter((record) => record.repaired);
    if (broken.length === 0) return;

    for (const record of broken) {
      try {
        const raw = await readTextOrNull(record.filePath);
        if (raw === null) continue;
        const parsed = parse(raw, {
          filename: baseName(record.path),
          now: this.#now(),
          fallbackId: record.id,
        });
        await writeText(record.filePath, serialize(parsed.frontmatter, parsed.body));
      } catch (err) {
        this.#logger.warn(`Could not repair frontmatter in ${record.relFile}: ${String(err)}`);
      }
    }

    this.#index.clearCache();
    await this.#index.rebuild();
  }

  /** Mark the index stale so the next read re-scans. */
  markStale(): void {
    this.#index.markStale();
  }

  // -------------------------------------------------------------------------
  // spaces
  // -------------------------------------------------------------------------

  async listSpaces(): Promise<Space[]> {
    const slugs = await listSpaceSlugs(this.contentDir);
    const spaces: Space[] = [];
    for (const slug of slugs) {
      const text = await readTextOrNull(path.join(this.contentDir, spaceFileRelPath(slug)));
      spaces.push(parseSpaceFile(text, slug));
    }
    return spaces.sort(compareSpaces);
  }

  async getSpace(slug: string): Promise<Space> {
    const validSlug = parseOrThrow(SpaceSlugSchema, slug, 'space slug');
    if (!(await isDirectory(path.join(this.contentDir, validSlug)))) {
      throw notFound(`No space ${validSlug}`);
    }
    const text = await readTextOrNull(path.join(this.contentDir, spaceFileRelPath(validSlug)));
    return parseSpaceFile(text, validSlug);
  }

  async createSpace(slug: string, name: string, options: CreateSpaceOptions = {}): Promise<Space> {
    return this.#writes.runExclusive(() => this.#createSpaceUnlocked(slug, name, options));
  }

  async #createSpaceUnlocked(
    slug: string,
    name: string,
    options: CreateSpaceOptions = {},
    home?: SpaceHome,
  ): Promise<Space> {
    const { icon, order, owner } = options;
    const validSlug = parseOrThrow(NewSpaceSlugSchema, slug, 'space slug');
    const details = parseOrThrow(SpaceFileSchema, { name, icon, order, owner }, 'space');
    const file = path.join(this.contentDir, spaceFileRelPath(validSlug));
    if (await pathExists(file)) throw conflict(`Space already exists: ${validSlug}`);
    const space: Space = { slug: validSlug, name: details.name };
    if (details.icon !== undefined) space.icon = details.icon;
    if (details.order !== undefined) space.order = details.order;
    if (details.owner !== undefined) space.owner = details.owner;
    await writeText(file, serializeSpaceFile(space));

    // A space with no page cannot be opened, so it gets its home page in the same write.
    if (!(await this.#pageFileExists(validSlug))) {
      const fields: NewPageFields = {};
      if (space.icon !== undefined) fields.icon = space.icon;
      await this.#writeNewPage(validSlug, home?.title ?? space.name, home?.markdown ?? '', true, fields);
    }

    this.#index.markStale();
    return space;
  }

  async updateSpace(slug: string, patch: UpdateSpaceBody): Promise<Space> {
    return this.#writes.runExclusive(() => this.#updateSpaceUnlocked(slug, patch));
  }

  async #updateSpaceUnlocked(slug: string, patch: UpdateSpaceBody): Promise<Space> {
    const body = parseOrThrow(UpdateSpaceBodySchema, patch, 'space');
    const current = await this.getSpace(slug);
    const next: Space = { slug: current.slug, name: body.name ?? current.name };

    const icon = patchedIcon(current.icon, body.icon);
    if (icon !== undefined) next.icon = icon;
    const order = body.order === undefined ? current.order : (body.order ?? undefined);
    if (order !== undefined) next.order = order;
    // Ownership is set once, at creation. A rename must never turn a private space public.
    if (current.owner !== undefined) next.owner = current.owner;

    await writeText(path.join(this.contentDir, spaceFileRelPath(next.slug)), serializeSpaceFile(next));
    this.#index.markStale();
    return next;
  }

  async #ensureSpace(slug: string): Promise<void> {
    const file = path.join(this.contentDir, spaceFileRelPath(slug));
    if (await pathExists(file)) return;
    await writeText(file, serializeSpaceFile({ slug, name: titleize(slug) }));
  }

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  async getTree(): Promise<SpaceTree[]> {
    await this.#index.ensureBuilt();
    const spaces = await this.listSpaces();
    const bySpace = new Map<string, IndexedPage[]>();
    for (const page of this.#index.all()) {
      const slug = spaceOf(page.path);
      const bucket = bySpace.get(slug);
      if (bucket === undefined) bySpace.set(slug, [page]);
      else bucket.push(page);
    }
    return spaces.map((space) => ({ ...space, tree: buildTree(bySpace.get(space.slug) ?? []) }));
  }

  async listPages(): Promise<PageSummary[]> {
    await this.#index.ensureBuilt();
    return this.#index.all().map(toSummary);
  }

  async getPageByPath(pagePath: PagePath): Promise<Page> {
    const valid = assertValidPagePath(pagePath);
    await this.#index.ensureBuilt();
    const record = this.#index.byPath(valid);
    if (record === undefined) throw notFound(`No page at path ${valid}`);
    return this.#readPage(record);
  }

  async getPageById(id: PageId): Promise<Page> {
    await this.#index.ensureBuilt();
    const record = this.#index.byId(id);
    if (record === undefined) throw notFound(`No page with id ${id}`);
    return this.#readPage(record);
  }

  async pageExists(pagePath: PagePath): Promise<boolean> {
    await this.#index.ensureBuilt();
    return this.#index.has(pagePath);
  }

  async #readParsed(record: IndexedPage): Promise<ParsedFile> {
    const raw = await readTextOrNull(record.filePath);
    if (raw === null) {
      this.#index.markStale();
      throw notFound(`Page file is gone: ${record.relFile}`);
    }
    return parse(raw, {
      filename: baseName(record.path),
      now: this.#now(),
      fallbackId: record.id,
    });
  }

  async #readPage(record: IndexedPage): Promise<Page> {
    const parsed = await this.#readParsed(record);
    const rev = contentRev(parsed.body);
    // Every rev a caller can hold came through here, so this is where the merge base is learnt.
    this.#history.record(record.id, rev, parsed.body);
    const page: Page = {
      ...toSummary({ ...record, frontmatter: parsed.frontmatter }),
      markdown: parsed.body,
      rev,
    };
    if (parsed.frontmatter.db !== undefined) page.database = parsed.frontmatter.db;
    return page;
  }

  async #pageById(id: PageId): Promise<Page> {
    const record = this.#index.byId(id);
    if (record === undefined) throw notFound(`No page with id ${id}`);
    return this.#readPage(record);
  }

  // -------------------------------------------------------------------------
  // writes
  // -------------------------------------------------------------------------

  /** File a page lives in. Depth-1 pages own their space directory, so they are always an index. */
  #relFileFor(pagePath: PagePath, hasChildren: boolean): string {
    return pagePathToRelFile(pagePath, hasChildren || depth(pagePath) === 1);
  }

  async #pageFileExists(pagePath: PagePath): Promise<boolean> {
    if (await pathExists(path.join(this.contentDir, `${pagePath}${PAGE_EXT}`))) return true;
    return pathExists(path.join(this.contentDir, pagePath, INDEX_FILE));
  }

  async #writeNewPage(
    pagePath: PagePath,
    title: string,
    markdown: string,
    hasChildren: boolean,
    fields: NewPageFields = {},
  ): Promise<string> {
    const now = this.#nowIso();
    const frontmatter: Frontmatter = { id: newPageId(), title, created: now, updated: now };
    if (fields.icon !== undefined) frontmatter.icon = fields.icon;
    if (fields.order !== undefined) frontmatter.order = fields.order;
    const file = path.join(this.contentDir, this.#relFileFor(pagePath, hasChildren));
    await writeText(file, serialize(frontmatter, markdown));
    this.#index.markStale();
    return file;
  }

  /** Turn `foo.md` into `foo/index.md` so the page can hold children. */
  async #promoteLeaf(pagePath: PagePath): Promise<void> {
    if (depth(pagePath) < 2) return;
    const leaf = path.join(this.contentDir, `${pagePath}${PAGE_EXT}`);
    if (!(await pathExists(leaf))) return;
    const target = path.join(this.contentDir, pagePath, INDEX_FILE);
    if (await pathExists(target)) throw conflict(`Both ${pagePath}.md and ${pagePath}/index.md exist`);
    try {
      await rename(leaf, target);
    } catch (error) {
      // Something outside this process promoted the same leaf first. The end state is the one
      // we wanted, so carry on rather than failing a write that has nothing left to do.
      if (!isMissingError(error) || !(await pathExists(target))) throw error;
    }
    this.#index.markStale();
  }

  /** Turn `foo/index.md` back into `foo.md` once the last child is gone. */
  async #demoteIfEmpty(pagePath: PagePath | null): Promise<void> {
    if (pagePath === null) return;
    if (depth(pagePath) < 2) return; // a space home page always keeps its directory
    const dir = path.join(this.contentDir, pagePath);
    if (!(await isDirectory(dir))) return;
    const names = await readDirNames(dir);
    if (names.length === 0) {
      await removeDirIfEmpty(this.contentDir, dir);
      await this.#demoteIfEmpty(parentPath(pagePath));
      return;
    }
    if (names.length !== 1 || names[0] !== INDEX_FILE) return;
    const leaf = path.join(this.contentDir, `${pagePath}${PAGE_EXT}`);
    if (await pathExists(leaf)) return;
    await rename(path.join(dir, INDEX_FILE), leaf);
    await removeDirIfEmpty(this.contentDir, dir);
    this.#index.markStale();
    await this.#demoteIfEmpty(parentPath(pagePath));
  }

  /** Make sure every ancestor of `target` exists and can hold children. */
  async #ensureAncestors(target: PagePath): Promise<void> {
    const parts = segments(target);
    for (let end = 1; end < parts.length; end += 1) {
      const ancestor = parts.slice(0, end).join('/');
      await this.#promoteLeaf(ancestor);
      if (await this.#pageFileExists(ancestor)) continue;
      await this.#writeNewPage(ancestor, titleize(baseName(ancestor)), '', true);
    }
  }

  async #assertPathFree(target: PagePath): Promise<void> {
    if (this.#index.has(target)) throw conflict(`A page already exists at ${target}`);
    if (await this.#pageFileExists(target)) throw conflict(`A file already exists at ${target}`);
  }

  async createPage(input: CreatePageInput): Promise<Page> {
    return this.#writes.runExclusive(() => this.#createPageUnlocked(input));
  }

  async #createPageUnlocked(input: CreatePageInput): Promise<Page> {
    const body = parseOrThrow(CreatePageBodySchema, input, 'page');
    const target = assertValidPagePath(body.path);
    await this.#index.ensureBuilt();
    await this.#assertPathFree(target);

    await this.#ensureSpace(spaceOf(target));
    await this.#ensureAncestors(target);

    const fields: NewPageFields = {};
    const icon = body.icon === undefined ? null : normalizeIcon(body.icon);
    if (icon !== null) fields.icon = icon;
    if (body.order !== undefined) fields.order = body.order;

    const file = await this.#writeNewPage(target, body.title, body.markdown ?? '', false, fields);
    await this.#index.rebuild();
    const record = this.#index.byPath(target);
    if (record === undefined) {
      // The scanner and the path validator disagreed about this name. Do not leave a file the
      // API can never see, delete or re-create.
      await removeFile(file);
      this.#index.markStale();
      throw validation(`Page path cannot be stored on disk: ${target}`);
    }
    return this.#readPage(record);
  }

  async updatePage(id: PageId, patch: UpdatePageInput): Promise<Page> {
    return this.#writes.runExclusive(() => this.#updatePageUnlocked(id, patch));
  }

  async #updatePageUnlocked(id: PageId, patch: UpdatePageInput): Promise<Page> {
    const body = parseOrThrow(UpdatePageBodySchema, patch, 'page update');
    await this.#index.ensureBuilt();
    const record = this.#index.byId(id);
    if (record === undefined) throw notFound(`No page with id ${id}`);
    const current = await this.#readParsed(record);
    const reconciled = this.#reconcileBody(id, body, current);

    const next: Frontmatter = { ...current.frontmatter };
    if (body.title !== undefined) next.title = body.title;
    if (body.icon === null) delete next.icon;
    if (typeof body.icon === 'string') {
      const icon = normalizeIcon(body.icon);
      if (icon === null) delete next.icon;
      if (icon !== null) next.icon = icon;
    }
    if (body.order === null) delete next.order;
    if (typeof body.order === 'number') next.order = body.order;

    const nextBody = reconciled ?? current.body;
    const wantsMove = body.path !== undefined && body.path !== record.path;
    const fieldsChanged = !frontmatterEqual(current.frontmatter, next);
    const changed = fieldsChanged || nextBody !== current.body || wantsMove;
    if (changed) next.updated = this.#nowIso();

    let filePath = record.filePath;
    if (wantsMove && body.path !== undefined) filePath = await this.#movePage(record, body.path);

    const content = serializePreserving(current, next, nextBody);
    if (content !== current.raw || filePath !== record.filePath) {
      await writeText(filePath, content);
    }
    await this.#index.rebuild();
    const saved = await this.#pageById(id);
    this.#history.record(id, saved.rev, saved.markdown);
    return saved;
  }

  /**
   * Settle a body edit against whatever is on disk now. Returns the text to write, or null when
   * the edit does not touch the body.
   *
   * A stale `baseRev` used to be refused outright. That is what made ten people typing into a
   * storm of 409s: every writer but one was rejected on every keystroke, and the retry produced
   * another write, which stole the next writer's base in turn. When the server still holds the
   * text that `baseRev` named it can merge the two edits itself, which is what the browser was
   * being asked to do anyway. Only a genuine overlap is refused.
   */
  #reconcileBody(id: PageId, body: UpdatePageInput, current: ParsedFile): string | null {
    if (body.markdown === undefined) return null;
    const incoming = normalizeBody(body.markdown);
    if (body.baseRev === undefined) return incoming;

    const rev = contentRev(current.body);
    // Remember the state we are about to compare against, and the one a refusal hands back.
    // Without this a client that retries on the rev from its own 409 can never be merged, so
    // the retry conflicts again, which is the loop that produced the storm.
    this.#history.record(id, rev, current.body);
    if (body.baseRev === rev) return incoming;

    const base = this.#history.find(id, body.baseRev);
    if (base !== null) {
      const merged = mergeText(base, incoming, current.body);
      if (merged.clean) return normalizeBody(merged.text);
    }

    throw saveConflict('The page changed since this edit started', {
      markdown: current.body,
      rev,
      updated: current.frontmatter.updated,
    });
  }

  /** Move a page and, when it has children, its whole subtree. Returns the new file path. */
  async #movePage(record: IndexedPage, targetRaw: PagePath): Promise<string> {
    const target = assertValidPagePath(targetRaw, 'target path');
    if (target === record.path) return record.filePath;
    if (isDescendantOf(target, record.path)) {
      throw conflict(`Cannot move ${record.path} into its own descendant ${target}`);
    }
    if (depth(record.path) === 1) {
      throw conflict(`${record.path} is a space home page and cannot be moved`);
    }
    await this.#assertPathFree(target);

    const movesDirectory = record.isIndex;
    const to = movesDirectory
      ? path.join(this.contentDir, target)
      : path.join(this.contentDir, this.#relFileFor(target, false));
    // Check the destination before anything is written. Creating the space first would make
    // this check fail against the store's own `_space.yml` and leave a phantom space behind.
    if (await pathExists(to)) {
      throw conflict(`A ${movesDirectory ? 'directory' : 'file'} already exists at ${target}`);
    }

    const space = spaceOf(target);
    // Promoting a subtree to a new top-level space renames the directory into place, so its
    // `_space.yml` can only be written afterwards.
    const spaceIsDestination = movesDirectory && space === target;
    if (!spaceIsDestination) await this.#ensureSpace(space);
    await this.#ensureAncestors(target);

    const oldParent = parentPath(record.path);
    const from = movesDirectory ? path.join(this.contentDir, record.path) : record.filePath;
    await rename(from, to);
    if (spaceIsDestination) await this.#ensureSpace(space);
    this.#index.markStale();
    await this.#demoteIfEmpty(oldParent);
    return movesDirectory ? path.join(to, INDEX_FILE) : to;
  }

  async deletePage(id: PageId, recursive = false): Promise<PagePath[]> {
    return this.#writes.runExclusive(() => this.#deletePageUnlocked(id, recursive));
  }

  async #deletePageUnlocked(id: PageId, recursive: boolean): Promise<PagePath[]> {
    await this.#index.ensureBuilt();
    const record = this.#index.byId(id);
    if (record === undefined) throw notFound(`No page with id ${id}`);
    const descendants = this.#index.descendantsOf(record.path);
    if (descendants.length > 0 && !recursive) {
      throw conflict(
        `${record.path} has ${descendants.length} child page(s); delete it recursively to remove them`,
      );
    }

    const targets = [record, ...descendants].sort((a, b) => depth(b.path) - depth(a.path));
    for (const target of targets) await removeFile(target.filePath);

    const dirs = [...new Set(targets.map((target) => path.dirname(target.filePath)))].sort(
      (a, b) => b.length - a.length,
    );
    for (const dir of dirs) await removeDirIfEmpty(this.contentDir, dir);

    this.#index.markStale();
    await this.#demoteIfEmpty(parentPath(record.path));
    await this.#index.rebuild();
    return targets.map((target) => target.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  // -------------------------------------------------------------------------
  // databases
  //
  // A database is a page whose frontmatter carries a `db` block, and its rows live beside that
  // block under `rows`. A row is a record, not a page, so it never reaches the sidebar tree or
  // the search index, and the whole database moves, clones and merges as one file.
  // -------------------------------------------------------------------------

  /** The schema and the rows of a database page. */
  async getDatabase(id: PageId): Promise<{ page: Page; database: Database; rows: DbRow[] }> {
    await this.#index.ensureBuilt();
    const record = this.#index.byId(id);
    if (record === undefined) throw notFound(`No page with id ${id}`);
    const parsed = await this.#readParsed(record);
    const page = await this.#readPage(record);
    const database = page.database;
    if (database === undefined) throw validation(`Page ${record.path} is not a database`);
    // Remembered here, because this is where a writer picks up the base it will send back.
    this.#rememberSchema(id, database);
    return { page, database, rows: rowsFor(database, parsed.frontmatter.rows) };
  }

  /**
   * Give the page a `db` block, or replace the one it has. `baseRev` names the revision the
   * edit started from; without it the schema is replaced whole, which is what an agent and a
   * script want.
   */
  async setDatabase(id: PageId, database: Database, baseRev?: string): Promise<Page> {
    const wanted = parseOrThrow(DatabaseSchema, database, 'database');
    return this.#writes.runExclusive(() =>
      this.#writeFrontmatter(id, (next) => {
        const settled = this.#reconcileSchema(id, wanted, next.db, baseRev);
        // Remembered as written, so the schema the answer carries is a base a later edit can use.
        this.#rememberSchema(id, settled);
        next.db = settled;
      }),
    );
  }

  /**
   * Settle a schema edit against the schema on disk now.
   *
   * Every schema write sends the whole schema, so two edits made from the same starting point
   * used to overwrite each other: two quick clicks on "Add a property" left one property. A
   * writer that says where it started from gets both, because properties and views carry
   * permanent ids and a merge per id needs no guessing. Only a real overlap is refused.
   */
  #reconcileSchema(
    id: PageId,
    wanted: Database,
    onDisk: unknown,
    baseRev: string | undefined,
  ): Database {
    if (baseRev === undefined) return wanted;
    const current = DatabaseSchema.safeParse(onDisk);
    if (!current.success) return wanted;

    const rev = this.#rememberSchema(id, current.data);
    if (baseRev === rev) return wanted;

    const held = this.#schemas.find(id, baseRev);
    if (held !== null) {
      const base = DatabaseSchema.safeParse(JSON.parse(held));
      if (base.success) {
        const merged = mergeDatabases(base.data, wanted, current.data);
        if (merged.clean) return merged.database;
      }
    }

    // A real overlap: the same property or view changed differently on both sides. The browser
    // reads the schema again and the person makes the change once more, which is rare enough
    // that a merge is not worth guessing at.
    throw conflict('The database changed since this edit started');
  }

  /** Keep a schema under its own revision, and hand that revision back. */
  #rememberSchema(id: PageId, database: Database): string {
    const rev = databaseRev(database);
    this.#schemas.record(id, rev, JSON.stringify(database));
    return rev;
  }

  /** Take the `db` block away, and the rows with it. The page itself keeps its body. */
  async removeDatabase(id: PageId): Promise<Page> {
    return this.#writes.runExclusive(() => this.#writeFrontmatter(id, (next) => {
      delete next.db;
      delete next.rows;
    }));
  }

  /** Add a row to the end of the database, carrying the cells it was created with. */
  async createRow(id: PageId, input: CreateRowInput = {}): Promise<DbRow> {
    return this.#writes.runExclusive(async () => {
      let added: DbRow | null = null;
      await this.#writeFrontmatter(id, (next) => {
        const database = next.db;
        if (database === undefined) throw validation(`Page ${id} is not a database`);
        const rows = next.rows ?? [];
        if (rows.length >= MAX_ROWS) throw validation(`A database holds at most ${MAX_ROWS} rows`);

        const title = (input.title ?? '').trim();
        const row = newRow(title.length > 0 ? title : UNTITLED_ROW, this.#nowIso());
        row.props = coerceProps(database.properties, input.props ?? {});
        added = row;
        next.rows = [...rows, row];
      });
      if (added === null) throw validation(`Page ${id} is not a database`);
      return added;
    });
  }

  /** Change a row's cells, its title, or both. An absent cell keeps its value; null clears it. */
  async updateRow(id: PageId, rowId: string, patch: UpdateRowInput): Promise<DbRow> {
    return this.#writes.runExclusive(async () => {
      let changed: DbRow | null = null;
      await this.#writeFrontmatter(id, (next) => {
        const database = next.db;
        if (database === undefined) throw validation(`Page ${id} is not a database`);
        const rows = next.rows ?? [];
        const current = rows.find((row) => row.id === rowId);
        if (current === undefined) throw notFound(`No row ${rowId} on this database`);

        const known = new Map(database.properties.map((property) => [property.id, property]));
        const props: RowProps = { ...current.props };
        for (const [key, raw] of Object.entries(patch.props ?? {})) {
          const property = known.get(key);
          if (property === undefined) throw validation(`No property ${key} on this database`);
          const value = coerceValue(property, raw);
          if (value === null) delete props[key];
          if (value !== null) props[key] = value;
        }

        const title = (patch.title ?? '').trim();
        const row: DbRow = {
          ...current,
          props,
          title: patch.title === undefined || title.length === 0 ? current.title : title,
          updated: this.#nowIso(),
        };
        changed = row;
        const written = rows.map((entry) => (entry.id === rowId ? row : entry));
        next.rows =
          patch.before === undefined ? written : moveRowBefore(written, rowId, patch.before);
      });
      if (changed === null) throw notFound(`No row ${rowId} on this database`);
      return changed;
    });
  }

  /** Take a row out of the database. Nothing else holds it, so it is gone. */
  async deleteRow(id: PageId, rowId: string): Promise<void> {
    await this.#writes.runExclusive(async () => {
      await this.#writeFrontmatter(id, (next) => {
        const rows = next.rows ?? [];
        if (!rows.some((row) => row.id === rowId)) throw notFound(`No row ${rowId} on this database`);
        const kept = rows.filter((row) => row.id !== rowId);
        if (kept.length > 0) next.rows = kept;
        if (kept.length === 0) delete next.rows;
      });
    });
  }

  /**
   * Rewrite one page's frontmatter and nothing else. The body is passed through untouched, so
   * an edit in the browser and a change to a row's cells never overwrite each other's work.
   */
  async #writeFrontmatter(id: PageId, edit: (next: Frontmatter) => void): Promise<Page> {
    await this.#index.ensureBuilt();
    const record = this.#index.byId(id);
    if (record === undefined) throw notFound(`No page with id ${id}`);
    const current = await this.#readParsed(record);

    const next: Frontmatter = { ...current.frontmatter };
    edit(next);
    if (!frontmatterEqual(current.frontmatter, next)) next.updated = this.#nowIso();

    const content = serializePreserving(current, next, current.body);
    if (content !== current.raw) await writeText(record.filePath, content);
    await this.#index.rebuild();
    return this.#pageById(id);
  }

  // -------------------------------------------------------------------------
  // low-level access
  // -------------------------------------------------------------------------

  /** Read a file inside the content directory, byte for byte. */
  async readRaw(filePath: string): Promise<string> {
    const absolute = resolveInside(this.contentDir, filePath);
    const text = await readTextOrNull(absolute);
    if (text === null) throw notFound(`No file at ${filePath}`);
    return text;
  }

  /**
   * Write a file inside the content directory, byte for byte. The content is stored exactly as
   * given, so a caller that keeps the frontmatter block intact keeps the page intact.
   */
  async writeRaw(filePath: string, content: string): Promise<void> {
    const absolute = resolveInside(this.contentDir, filePath);
    await writeText(absolute, content);
    this.#index.markStale();
  }

  /** Absolute path of a content-relative file, rejecting anything outside the content root. */
  resolvePath(filePath: string): string {
    return resolveInside(this.contentDir, filePath);
  }

  async saveAsset(
    pageId: PageId,
    filename: string,
    data: Uint8Array,
  ): Promise<{ url: string; path: string }> {
    if (!isPageId(pageId)) throw validation(`Invalid page id: ${JSON.stringify(pageId)}`);
    const base = path.basename(filename.replace(/\\/g, '/'));
    const extension = path.extname(base);
    const stem = base.slice(0, base.length - extension.length);
    let candidate = base;
    for (let attempt = 2; attempt < 1000; attempt += 1) {
      const relative = assetRelPath(pageId, candidate);
      if (!(await pathExists(path.join(this.contentDir, relative)))) break;
      candidate = `${stem}-${attempt}${extension}`;
    }
    const relative = assetRelPath(pageId, candidate);
    const absolute = resolveInside(this.contentDir, relative);
    await writeBytes(absolute, data);
    return { url: assetUrl(pageId, candidate), path: relative };
  }

  // -------------------------------------------------------------------------
  // links
  // -------------------------------------------------------------------------

  async #linkedPages(): Promise<LinkedPage[]> {
    await this.#index.ensureBuilt();
    const pages: LinkedPage[] = [];
    for (const record of this.#index.all()) {
      const raw = await readTextOrNull(record.filePath);
      if (raw === null) continue;
      const parsed = parse(raw, { filename: baseName(record.path), fallbackId: record.id });
      pages.push({
        id: record.id,
        path: record.path,
        title: parsed.frontmatter.title,
        hasChildren: record.hasChildren,
        markdown: parsed.body,
      });
    }
    return pages;
  }

  async getBacklinks(id: PageId): Promise<Backlink[]> {
    await this.#index.ensureBuilt();
    if (this.#index.byId(id) === undefined) throw notFound(`No page with id ${id}`);
    return buildBacklinkIndex(await this.#linkedPages()).get(id) ?? [];
  }

  /** Rewrite `[[wikilinks]]` into markdown links pointing at page paths. */
  async resolveLinks(markdown: string, from?: PagePath): Promise<string> {
    await this.#index.ensureBuilt();
    const resolver = createPageResolver(
      this.#index.all().map((record) => ({
        id: record.id,
        path: record.path,
        title: record.frontmatter.title,
        hasChildren: record.hasChildren,
      })),
    );
    return resolveWikilinks(markdown, (target) => {
      const options = from === undefined ? {} : { from };
      const page = resolver.resolve(target, options);
      if (page === null) return null;
      return { href: `/${page.path}`, title: page.title };
    });
  }

}
