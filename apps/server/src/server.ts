import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import { AccountStore, defaultAccountsDbPath, type WorkspaceRecord } from '@tablinum/accounts';
import {
  ContentStore as CoreContentStore,
  parse,
  type AssetRefSource,
  type CreateSpaceOptions,
} from '@tablinum/core';
import { GitEngine as CoreGitEngine } from '@tablinum/git-sync';
import { SearchIndex as CoreSearchIndex, defaultDbPath } from '@tablinum/search';
import {
  isAppError,
  loadConfig,
  redactConfig,
  relFileToPagePath,
  type Backlink,
  type Config,
  type CreatePageBody,
  type CreateRowBody,
  type CreateSpaceBody,
  type Database,
  type DbRow,
  type GitStatus,
  type Page,
  type PageId,
  type PagePath,
  type PageSummary,
  type Revision,
  type RowProps,
  type SearchHit,
  type Space,
  type UpdatePageBody,
  type UpdateRowBody,
  type UpdateSpaceBody,
} from '@tablinum/shared';
import { buildApp } from './app.js';
import { commentAssetRefs } from './cleanup.js';
import { contextOf } from './context.js';
import type {
  ContentStore,
  FileResolution,
  FileVersions,
  GitEngine,
  OrphanedAssets,
  ParsedPageFile,
  SearchIndex,
  SearchOptions,
  ServerDeps,
  SpaceTree,
} from './deps.js';
import { VERSION } from './version.js';
import { startContentWatcher, type ContentWatcher } from './wiring.js';
import type { WorkspaceInstance } from './workspaces.js';

/** A NOT_FOUND from a package becomes a null here; the routes turn null into a 404. */
async function orNull<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (err) {
    if (isAppError(err) && err.code === 'NOT_FOUND') return null;
    throw err;
  }
}

/** Adapts @tablinum/core onto the store interface the routes use. */
class CoreStoreAdapter implements ContentStore {
  constructor(private readonly core: CoreContentStore) {}

  get contentDir(): string {
    return this.core.contentDir;
  }

  async init(): Promise<void> {
    await this.core.init();
  }

  async rebuild(): Promise<void> {
    await this.core.rebuild();
  }

  listSpaces(): Promise<Space[]> {
    return this.core.listSpaces();
  }

  createSpace(input: CreateSpaceBody, owner?: string): Promise<Space> {
    const options: CreateSpaceOptions = {};
    if (input.icon !== undefined) options.icon = input.icon;
    if (input.order !== undefined) options.order = input.order;
    if (owner !== undefined) options.owner = owner;
    return this.core.createSpace(input.slug, input.name, options);
  }

  updateSpace(slug: string, patch: UpdateSpaceBody): Promise<Space> {
    return this.core.updateSpace(slug, patch);
  }

  deleteSpace(slug: string, recursive: boolean): Promise<PagePath[]> {
    return this.core.deleteSpace(slug, recursive);
  }

  getTree(): Promise<SpaceTree[]> {
    return this.core.getTree();
  }

  listPages(): Promise<PageSummary[]> {
    return this.core.listPages();
  }


  getPageByPath(path: PagePath): Promise<Page | null> {
    return orNull(this.core.getPageByPath(path));
  }

  getPageById(id: PageId): Promise<Page | null> {
    return orNull(this.core.getPageById(id));
  }

  createPage(input: CreatePageBody): Promise<Page> {
    return this.core.createPage(input);
  }

  updatePage(id: PageId, patch: UpdatePageBody): Promise<Page> {
    return this.core.updatePage(id, patch);
  }

  deletePage(id: PageId, recursive: boolean): Promise<PagePath[]> {
    return this.core.deletePage(id, recursive);
  }

  removeOrphanedAssets(pageIds: Iterable<PageId>): Promise<OrphanedAssets> {
    return this.core.removeOrphanedAssets(pageIds);
  }

  getBacklinks(id: PageId): Promise<Backlink[]> {
    return this.core.getBacklinks(id);
  }

  getDatabase(id: PageId): Promise<{ page: Page; database: Database; rows: DbRow[] }> {
    return this.core.getDatabase(id);
  }

  setDatabase(
    id: PageId,
    database: Database,
    baseRev?: string,
    rows?: Record<string, RowProps>,
  ): Promise<Page> {
    return this.core.setDatabase(id, database, baseRev, rows);
  }

  removeDatabase(id: PageId): Promise<Page> {
    return this.core.removeDatabase(id);
  }

  createRow(id: PageId, input: CreateRowBody): Promise<DbRow> {
    return this.core.createRow(id, input);
  }

  updateRow(id: PageId, rowId: string, patch: UpdateRowBody): Promise<DbRow> {
    return this.core.updateRow(id, rowId, patch);
  }

  deleteRow(id: PageId, rowId: string): Promise<void> {
    return this.core.deleteRow(id, rowId);
  }

  async reloadFile(relFile: string): Promise<Page | null> {
    await this.core.rebuild();
    return orNull(this.core.getPageByPath(relFileToPagePath(relFile)));
  }

  async forgetFile(relFile: string): Promise<PageId | null> {
    // Read the id before the rescan, because the rescan is what forgets the file.
    const record = this.core.index.byPath(relFileToPagePath(relFile));
    const id = record?.id ?? null;
    await this.core.rebuild();
    return id;
  }

  parsePageFile(raw: string): ParsedPageFile {
    const parsed = parse(raw);
    return { frontmatter: parsed.frontmatter, markdown: parsed.body };
  }
}

/** Adapts @tablinum/git-sync onto the git interface the routes use. */
class CoreGitAdapter implements GitEngine {
  constructor(private readonly core: CoreGitEngine) {}

  async init(): Promise<void> {
    await this.core.init();
  }

  excludePath(relDir: string): Promise<void> {
    return this.core.excludePath(relDir);
  }

  unexcludePath(relDir: string): Promise<void> {
    return this.core.unexcludePath(relDir);
  }

  excludedPaths(): Promise<string[]> {
    return this.core.excludedPaths();
  }

  status(): Promise<GitStatus> {
    return this.core.status();
  }

  async pull(): Promise<{ status: GitStatus; pulled: number; files: string[] }> {
    const result = await this.core.pull();
    return { status: await this.core.status(), pulled: result.pulled, files: result.files };
  }

  async push(): Promise<{ status: GitStatus; pushed: boolean }> {
    const result = await this.core.push();
    return { status: await this.core.status(), pushed: result.pushed };
  }

  conflictVersions(): Promise<FileVersions[]> {
    return this.core.conflictVersions();
  }

  resolveConflict(files: FileResolution[], message?: string): Promise<string[]> {
    return this.core.resolveConflict(files, message);
  }

  commit(message?: string): Promise<string | null> {
    return this.core.commitAll(message);
  }

  scheduleCommit(message?: string): void {
    this.core.scheduleCommit(message);
  }

  flushCommit(): Promise<string | null> {
    return this.core.flushPendingCommit();
  }

  history(relFile: string, limit: number): Promise<Revision[]> {
    return this.core.history(relFile, limit);
  }

  readFileAt(relFile: string, sha: string): Promise<string | null> {
    return orNull(this.core.showAtRevision(relFile, sha));
  }

  startAutoPull(intervalMs: number): void {
    this.core.startAutoPull(intervalMs);
  }

  async stop(): Promise<void> {
    await this.core.close();
  }
}

/** Adapts @tablinum/search, which is synchronous, onto the async index interface. */
class CoreSearchAdapter implements SearchIndex {
  constructor(private readonly core: CoreSearchIndex) {}

  async init(): Promise<void> {
    this.core.init();
  }

  async reindexAll(pages: Iterable<Page>): Promise<number> {
    return this.core.reindexAll(pages);
  }

  async indexPage(page: Page): Promise<void> {
    this.core.upsert(page);
  }

  async removePage(id: PageId): Promise<void> {
    this.core.remove(id);
  }

  search(query: string, options?: SearchOptions): Promise<SearchHit[]> {
    return this.core.search(query, options ?? {});
  }

  async close(): Promise<void> {
    this.core.close();
  }
}

export interface RunningServer {
  close(): Promise<void>;
}

/**
 * The real parts of a workspace other than the default one. It gets its own repository and its
 * own index file. The configured git remote belongs to the default workspace alone, so an
 * extra workspace is local until somebody gives it a remote by hand.
 */
function openRealWorkspace(
  config: Config,
  assetRefs: AssetRefSource,
): (record: WorkspaceRecord) => Promise<WorkspaceInstance> {
  return async (record) => {
    // The create route writes the starter space, so the store must not add a second one.
    const core = new CoreContentStore({ contentDir: record.dir, starter: false, assetRefs });
    const git = new CoreGitEngine({
      contentDir: record.dir,
      branch: config.gitBranch,
      authorName: config.gitAuthorName,
      authorEmail: config.gitAuthorEmail,
      autocommitMs: config.autocommitMs,
      commitMaxHoldMs: config.commitMaxHoldMs,
    });
    // Named after the directory, not after the slug: a rename must not orphan the index.
    const search = new CoreSearchIndex({ dbPath: `${record.dir}.search.db` });
    return {
      store: new CoreStoreAdapter(core),
      git: new CoreGitAdapter(git),
      search: new CoreSearchAdapter(search),
      close: async () => {
        await git.flushPendingCommit().catch(() => null);
      },
    };
  };
}

/**
 * Commit anything the working tree still carries at boot. A crash between a write and its
 * debounced commit leaves the edit uncommitted for good: the watcher only reports changes made
 * after it starts, so nothing else would ever pick it up.
 */
export async function commitOrphanedWrites(
  deps: Pick<ServerDeps, 'git'>,
  log: FastifyBaseLogger,
): Promise<string | null> {
  try {
    const status = await deps.git.status();
    if (status.dirtyFiles.length === 0) return null;
    const sha = await deps.git.commit('Commit content changed while tablinum was stopped');
    log.info({ sha, files: status.dirtyFiles.length }, 'committed content left over from a crash');
    return sha;
  } catch (err) {
    // A repo the server cannot commit to is still a repo it can serve pages from.
    log.warn({ err }, 'could not commit leftover content at boot');
    return null;
  }
}

/** The real content, git and search parts, plus the engines behind them. */
export interface RealDeps {
  deps: ServerDeps;
  git: CoreGitEngine;
  search: CoreSearchIndex;
  accounts: AccountStore;
}

/**
 * Every real dependency, unstarted. `start()` uses it, and so does the load test, which needs
 * the same stack a deployment runs rather than the doubles the unit suite injects.
 */
export function buildRealDeps(config: Config): RealDeps {
  // Beside the search index, one level above the content root: passwords and avatars must
  // never land inside the git repo.
  const accounts = new AccountStore({ dbPath: defaultAccountsDbPath(config.contentDir) });
  // deletePage() and deleteSpace() collect attachments inside the store, so the store needs the
  // same view of comment bodies the operator sweep has. Injected, because content must not
  // learn about the account database.
  const assetRefs = commentAssetRefs(accounts);
  const coreStore = new CoreContentStore({ contentDir: config.contentDir, assetRefs });
  const coreGit = CoreGitEngine.fromConfig(config);
  const coreSearch = new CoreSearchIndex({ dbPath: defaultDbPath(config.contentDir) });

  const deps: ServerDeps = {
    config,
    store: new CoreStoreAdapter(coreStore),
    git: new CoreGitAdapter(coreGit),
    search: new CoreSearchAdapter(coreSearch),
    accounts,
    openWorkspace: openRealWorkspace(config, assetRefs),
    workspacesDir: resolve(config.contentDir, '..', 'workspaces'),
    version: VERSION,
    trustProxy: config.trustProxy,
  };
  return { deps, git: coreGit, search: coreSearch, accounts };
}

/**
 * Build every real dependency, wire them together and listen.
 * Order matters: the store must exist before git initializes the repo around it, the index
 * is built from the store, and the watcher only starts once the index is consistent.
 */
export async function start(config: Config = loadConfig()): Promise<RunningServer> {
  const { deps, git: coreGit, accounts } = buildRealDeps(config);

  await deps.store.init();
  await deps.git.init();
  await deps.search.init();
  accounts.init();
  accounts.purgeExpiredSessions();

  const app = await buildApp(deps);
  app.log.info(redactConfig(config), 'tablinum configuration');
  // A fresh install has nobody in it. Say so, because the first visitor becomes the admin.
  if (accounts.isEmpty()) {
    app.log.warn(`No account exists yet. Open http://localhost:${config.port} to create the first one.`);
  }

  const ctx = contextOf(app);
  if (ctx === null) throw new Error('buildApp did not register a route context');

  const indexed = await ctx.wiring.reindexAll();
  app.log.info({ pages: indexed }, 'search index built');

  // A crash between a write and its debounced commit leaves the edit uncommitted, and nothing
  // else would ever notice: the watcher only sees changes made after it starts.
  await commitOrphanedWrites(deps, app.log);

  let watcher: ContentWatcher | null = startContentWatcher(deps, ctx.wiring, app.log, ctx.live);
  await watcher.whenReady();
  deps.git.startAutoPull(config.autopullMs);

  // Every other workspace gets the same treatment the moment it is first opened.
  const extraWatchers: ContentWatcher[] = [];
  ctx.workspaces.onOpened((parts) => {
    const scoped: ServerDeps = { ...deps, store: parts.store, git: parts.git, search: parts.search };
    extraWatchers.push(startContentWatcher(scoped, parts.wiring, app.log, parts.live));
    parts.git.startAutoPull(config.autopullMs);
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });

  let closing: Promise<void> | null = null;
  const close = async (): Promise<void> => {
    if (closing !== null) return closing;
    closing = (async (): Promise<void> => {
      app.log.info('shutting down');
      if (watcher !== null) {
        await watcher.close();
        watcher = null;
      }
      for (const extra of extraWatchers.splice(0)) await extra.close();
      await app.close();
      // close() stops the timers and commits whatever the last writes scheduled.
      await coreGit.flushPendingCommit().catch((err: unknown) => {
        app.log.error({ err }, 'final commit failed');
        return null;
      });
      await deps.git.stop();
      await deps.search.close();
      accounts.close();
      app.log.info('shutdown complete');
    })();
    return closing;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }

  return { close };
}

// Only bootstrap when this file is the entry point, so importing it stays side-effect free.
const entry = process.argv[1];
const invokedDirectly = entry !== undefined && import.meta.url === pathToFileURL(entry).href;

if (invokedDirectly) {
  start().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
