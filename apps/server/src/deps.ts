import type { AccountStore, WorkspaceRecord } from '@tablinum/accounts';
import type { SlackApi } from './slack.js';
import type { WebhookSender } from './webhooks.js';
import type { WorkspaceInstance } from './workspaces.js';
import type {
  Backlink,
  Config,
  CreatePageBody,
  CreateRowBody,
  CreateSpaceBody,
  Database,
  DbRow,
  Frontmatter,
  GitStatus,
  Page,
  PageId,
  PagePath,
  PageSummary,
  Revision,
  RowProps,
  SearchField,
  SearchHit,
  Space,
  TreeNode,
  UpdatePageBody,
  UpdateRowBody,
  UpdateSpaceBody,
} from '@tablinum/shared';

/** A space plus its rendered page tree, as returned by GET /api/v1/tree. */
export interface SpaceTree extends Space {
  tree: TreeNode[];
}

/** A page file split into its frontmatter and its body. */
export interface ParsedPageFile {
  frontmatter: Frontmatter;
  markdown: string;
}

/** The three versions of one file that a failed pull left behind. */
export interface FileVersions {
  /** Repo-relative path. */
  file: string;
  local: string;
  remote: string;
  base: string;
}

/** One caller decision: the exact text to keep for a conflicted file. */
export interface FileResolution {
  file: string;
  content: string;
}

/** Filters accepted by the full-text index. */
export interface SearchOptions {
  space?: string;
  limit?: number;
  /** Columns the match is restricted to. Omitted, every column answers. */
  fields?: readonly SearchField[];
}

/**
 * The content store: markdown files on disk, their frontmatter and the page tree.
 * Implemented by @tablinum/core; the server only ever talks to this interface so
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

  /**
   * Make a space. `owner` marks it private and comes from the session, never from the body,
   * so nobody can create a space in somebody else's name.
   */
  createSpace(input: CreateSpaceBody, owner?: string): Promise<Space>;

  /** Change the name, icon or order of a space. Its slug never changes. */
  updateSpace(slug: string, patch: UpdateSpaceBody): Promise<Space>;

  /** Every space with its full page tree, ready for the sidebar. */
  getTree(): Promise<SpaceTree[]>;

  /** Every page in the repo, flat, without bodies. */
  listPages(): Promise<PageSummary[]>;


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

  /** The schema and every row of a database page. A page without a `db` block is a 400. */
  getDatabase(id: PageId): Promise<{ page: Page; database: Database; rows: DbRow[] }>;

  /** Give the page a `db` block, or replace the one it has. `rows` sets cells in the same write. */
  setDatabase(
    id: PageId,
    database: Database,
    baseRev?: string,
    rows?: Record<string, RowProps>,
  ): Promise<Page>;

  /** Take the `db` block away, and the rows with it. */
  removeDatabase(id: PageId): Promise<Page>;

  /** Add a row, which is a record inside the database page. */
  createRow(id: PageId, input: CreateRowBody): Promise<DbRow>;

  /** Change one row's cells or its title. An absent cell keeps its value; null clears it. */
  updateRow(id: PageId, rowId: string, patch: UpdateRowBody): Promise<DbRow>;

  /** Take one row out of the database. */
  deleteRow(id: PageId, rowId: string): Promise<void>;
}

/** The git engine: the content directory is a git repo. Implemented by @tablinum/git-sync. */
export interface GitEngine {
  /** Ensure the repo exists, the branch is checked out and the remote is configured. */
  init(): Promise<void>;

  /** Hide one content-relative directory from git for good. Private spaces live behind it. */
  excludePath(relDir: string): Promise<void>;

  /** Every directory the exclude list hides, as content-relative paths. */
  excludedPaths(): Promise<string[]>;

  status(): Promise<GitStatus>;
  pull(): Promise<{ status: GitStatus; pulled: number; files: string[] }>;
  push(): Promise<{ status: GitStatus; pushed: boolean }>;

  /** Local, remote and base version of every file a failed pull could not merge. */
  conflictVersions(): Promise<FileVersions[]>;

  /** Commit the caller's text for every conflicted file and merge the remote in. */
  resolveConflict(files: FileResolution[], message?: string): Promise<string[]>;

  /** Stage everything and commit. Returns null when the working tree is clean. */
  commit(message?: string): Promise<string | null>;

  /** Debounced commit. Safe to call on every write. */
  scheduleCommit(message?: string): void;

  /**
   * Commit whatever the debounce is still holding, right now.
   *
   * A caller about to make a commit with a message of its own calls this first. Otherwise
   * `git add -A` would sweep the pending saves into that commit, and the message would then
   * describe work nobody did there.
   */
  flushCommit(): Promise<string | null>;

  /** Commits that touched one content-relative file, newest first, renames followed. */
  history(relFile: string, limit: number): Promise<Revision[]>;

  /** Contents of one content-relative file at one revision, or null when absent. */
  readFileAt(relFile: string, sha: string): Promise<string | null>;

  /** Start the periodic pull loop. A zero interval disables it. */
  startAutoPull(intervalMs: number): void;

  /** Stop every timer and flush a final commit. */
  stop(): Promise<void>;
}

/** The full-text index. Implemented by @tablinum/search over sqlite FTS5. */
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
  /** The default workspace's content. Its directory is the one named by the config. */
  store: ContentStore;
  git: GitEngine;
  search: SearchIndex;
  /**
   * Build the content, git and search parts of a workspace other than the default one.
   * Without it the server serves the configured content directory and nothing else.
   */
  openWorkspace?: (record: WorkspaceRecord) => Promise<WorkspaceInstance>;
  /** Where a new workspace's git repository is created. Defaults to `<contentDir>/../workspaces`. */
  workspacesDir?: string;
  /**
   * Accounts, passwords, sessions, invites and avatars. It is a plain SQLite file beside the
   * search index, never inside the content repo, so none of it is ever committed.
   */
  accounts: AccountStore;
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
  /** Slack transport for mention notifications. Built from the config when absent. */
  slack?: SlackApi | null;
  /** Webhook transport for agent notifications. Built from the config when absent. */
  webhooks?: WebhookSender | null;
}
