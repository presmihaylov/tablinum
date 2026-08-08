import type {
  Backlink,
  Config,
  CreatePageBody,
  CreateSpaceBody,
  Frontmatter,
  GitStatus,
  Page,
  PageId,
  PagePath,
  PageSummary,
  Revision,
  SearchHit,
  Space,
  TreeNode,
  UpdatePageBody,
} from '@gitdocs/shared';

/** A space plus its rendered page tree, as returned by GET /api/v1/tree. */
export interface SpaceTree extends Space {
  tree: TreeNode[];
}

/** A page file split into its frontmatter and its body. */
export interface ParsedPageFile {
  frontmatter: Frontmatter;
  markdown: string;
}

/** Filters accepted by the full-text index. */
export interface SearchOptions {
  space?: string;
  tag?: string;
  limit?: number;
}

/**
 * The content store: markdown files on disk, their frontmatter and the page tree.
 * Implemented by @gitdocs/core; the server only ever talks to this interface so
 * tests can drive the API over a temporary content directory.
 */
export interface ContentStore {
  /** Absolute path of the content root. */
  readonly contentDir: string;

  /** Create the content root if needed and build the in-memory id index. */
  init(): Promise<void>;

  /**
   * Scan the content root again from scratch. Needed after anything that rewrites files behind
   * the store's back, such as a pull: without it every later read serves the pre-pull index.
   */
  rebuild(): Promise<void>;

  listSpaces(): Promise<Space[]>;
  createSpace(input: CreateSpaceBody): Promise<Space>;

  /** Every space with its full page tree, ready for the sidebar. */
  getTree(): Promise<SpaceTree[]>;

  /** Every page in the repo, flat, without bodies. */
  listPages(): Promise<PageSummary[]>;

  /** Direct children of a page path, without bodies. Powers the table view. */
  listChildren(path: PagePath): Promise<PageSummary[]>;

  getPageByPath(path: PagePath): Promise<Page | null>;
  getPageById(id: PageId): Promise<Page | null>;

  createPage(input: CreatePageBody): Promise<Page>;

  /** Apply a patch. A `path` in the patch moves or renames the page and keeps its id. */
  updatePage(id: PageId, patch: UpdatePageBody): Promise<Page>;

  /** Delete a page. Without `recursive` a page that has children is a CONFLICT. */
  deletePage(id: PageId, recursive: boolean): Promise<PagePath[]>;

  /** Pages whose body links to this page through a wikilink or a relative link. */
  getBacklinks(id: PageId): Promise<Backlink[]>;

  /** Re-read one file from disk after an out-of-band edit. Null when it is gone. */
  reloadFile(relFile: string): Promise<Page | null>;

  /** Drop a file from the in-memory index after an out-of-band delete. */
  forgetFile(relFile: string): Promise<PageId | null>;

  /** Split a raw page file into frontmatter and body. Used to read old revisions. */
  parsePageFile(raw: string): ParsedPageFile;
}

/** The git engine: the content directory is a git repo. Implemented by @gitdocs/git-sync. */
export interface GitEngine {
  /** Ensure the repo exists, the branch is checked out and the remote is configured. */
  init(): Promise<void>;

  status(): Promise<GitStatus>;
  pull(): Promise<{ status: GitStatus; pulled: number }>;
  push(): Promise<{ status: GitStatus; pushed: boolean }>;

  /** Stage everything and commit. Returns null when the working tree is clean. */
  commit(message?: string): Promise<string | null>;

  /** Debounced commit. Safe to call on every write. */
  scheduleCommit(message?: string): void;

  /** Commits that touched one content-relative file, newest first, renames followed. */
  history(relFile: string, limit: number): Promise<Revision[]>;

  /** Contents of one content-relative file at one revision, or null when absent. */
  readFileAt(relFile: string, sha: string): Promise<string | null>;

  /** Start the periodic pull loop. A zero interval disables it. */
  startAutoPull(intervalMs: number): void;

  /** Stop every timer and flush a final commit. */
  stop(): Promise<void>;
}

/** The full-text index. Implemented by @gitdocs/search over sqlite FTS5. */
export interface SearchIndex {
  init(): Promise<void>;

  /** Replace the whole index with these pages. Returns the number indexed. */
  reindexAll(pages: Iterable<Page>): Promise<number>;

  /** Insert or replace one page. */
  indexPage(page: Page): Promise<void>;

  /** Remove one page by id. */
  removePage(id: PageId): Promise<void>;

  search(query: string, options?: SearchOptions): Promise<SearchHit[]>;

  close(): Promise<void>;
}

/** Everything buildApp() needs. Every field is injected so tests can swap it out. */
export interface ServerDeps {
  config: Config;
  store: ContentStore;
  git: GitEngine;
  search: SearchIndex;
  /** Reported by GET /api/v1/health. */
  version?: string;
  /**
   * Directory of the built web UI. `undefined` looks next to the server package,
   * `null` disables static serving entirely.
   */
  webDistDir?: string | null;
  /** Milliseconds an API write suppresses watcher events for the same file. */
  echoSuppressMs?: number;
  /** Passed straight to Fastify. `false` silences logs in tests. */
  logger?: boolean | Record<string, unknown>;
  /** Trust `X-Forwarded-*`. Enable only behind a reverse proxy you control. */
  trustProxy?: boolean;
}
