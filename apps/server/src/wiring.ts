import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { type FSWatcher, watch } from 'chokidar';
import type { FastifyBaseLogger } from 'fastify';
import {
  ASSETS_DIR,
  PAGE_EXT,
  SPACE_FILE,
  assetDirRelPath,
  pagePathToRelFile,
  relFileToPagePath,
  type LiveAgent,
  type Page,
  type PageId,
  type PagePath,
} from '@tablinum/shared';
import {
  cleanUpAfterDelete,
  sweepOrphanedAssets,
  type CleanupParts,
  type DeletedSubjects,
} from './cleanup.js';
import type { ServerDeps } from './deps.js';
import { LiveHub } from './live.js';

/**
 * Both files a page path could live in: `foo.md` when it is a leaf and `foo/index.md`
 * once it has children. A mutation marks both, because promoting or demoting a page
 * deletes one of them and creates the other.
 */
export function pageFileVariants(path: PagePath): string[] {
  return [pagePathToRelFile(path, false), pagePathToRelFile(path, true)];
}

/** How long an API write suppresses watcher events for the same file. */
export const DEFAULT_ECHO_SUPPRESS_MS = 5_000;

/** Watcher events are batched for this long before the store and index are touched. */
const WATCH_DEBOUNCE_MS = 150;

/** Content-root-relative, slash-separated path of an absolute file. */
export function contentRelPath(contentDir: string, absolutePath: string): string {
  return relative(contentDir, absolutePath).split(sep).join('/');
}

function isPageFile(rel: string): boolean {
  return rel.toLowerCase().endsWith(PAGE_EXT) && !rel.startsWith(`${ASSETS_DIR}/`);
}

/** The space a `_space.yml` describes, or null when the file is not a space descriptor. */
function spaceFileSlug(rel: string): string | null {
  if (!rel.endsWith(`/${SPACE_FILE}`)) return null;
  const slug = rel.slice(0, -(SPACE_FILE.length + 1));
  return slug.includes('/') ? null : slug;
}

function isTrackedFile(rel: string): boolean {
  if (rel.length === 0 || rel.startsWith('..')) return false;
  if (rel.startsWith('.git/') || rel === '.git') return false;
  if (isPageFile(rel)) return true;
  if (rel.endsWith(`/${SPACE_FILE}`) || rel === SPACE_FILE) return true;
  return rel.startsWith(`${ASSETS_DIR}/`);
}

/**
 * Remembers files the API just wrote so the filesystem watcher does not treat its own
 * echo as an out-of-band edit and schedule a second commit for it.
 */
export class RecentWrites {
  readonly #seen = new Map<string, number>();

  constructor(private readonly ttlMs: number = DEFAULT_ECHO_SUPPRESS_MS) {}

  mark(rel: string, now: number = Date.now()): void {
    this.#seen.set(rel, now + this.ttlMs);
  }

  markAll(paths: Iterable<string>, now: number = Date.now()): void {
    for (const rel of paths) this.mark(rel, now);
  }

  /** True when `rel` is still marked. Does not change anything. */
  has(rel: string, now: number = Date.now()): boolean {
    const expiresAt = this.#seen.get(rel);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.#seen.delete(rel);
      return false;
    }
    return true;
  }

  /**
   * Claim the mark for `rel`, if there is one. A mark covers exactly one echo: keeping it for
   * the whole ttl would swallow a real out-of-band edit made moments after an API write, and
   * that edit would never be indexed or committed.
   */
  consume(rel: string, now: number = Date.now()): boolean {
    if (!this.has(rel, now)) return false;
    this.#seen.delete(rel);
    return true;
  }

  prune(now: number = Date.now()): void {
    for (const [rel, expiresAt] of this.#seen) {
      if (expiresAt <= now) this.#seen.delete(rel);
    }
  }

  get size(): number {
    return this.#seen.size;
  }
}

/**
 * Bodies this process wrote, by file, as the revs they hashed to.
 *
 * The path marks above cover one echo each, but chokidar coalesces: a page saved five times in
 * one debounce window can raise fewer events than there were writes, or more. Whichever way it
 * lands, an echo that slips through is broadcast as an out-of-band change, which drops every
 * open room on the page. A rev is exact, so it does not need the counting to be right.
 */
export class RecentRevs {
  readonly #seen = new Map<string, Map<string, number>>();

  constructor(readonly ttlMs: number) {}

  mark(rel: string, rev: string, now: number = Date.now()): void {
    const revs = this.#seen.get(rel) ?? new Map<string, number>();
    this.#seen.set(rel, revs);
    revs.set(rev, now + this.ttlMs);
  }

  /** True when this process wrote exactly this body to this file recently. */
  has(rel: string, rev: string, now: number = Date.now()): boolean {
    const revs = this.#seen.get(rel);
    if (revs === undefined) return false;
    const expiresAt = revs.get(rev);
    if (expiresAt === undefined) return false;
    if (expiresAt > now) return true;
    revs.delete(rev);
    if (revs.size === 0) this.#seen.delete(rel);
    return false;
  }

  prune(now: number = Date.now()): void {
    for (const [rel, revs] of this.#seen) {
      for (const [rev, expiresAt] of revs) {
        if (expiresAt <= now) revs.delete(rev);
      }
      if (revs.size === 0) this.#seen.delete(rel);
    }
  }

  get size(): number {
    return this.#seen.size;
  }
}

/** What a mutating route did, so the index and git stay in step with the disk. */
export interface MutationRecord {
  /** Pages to insert or refresh in the full-text index. */
  pages?: Page[];
  /** Page ids that no longer exist. */
  removedIds?: PageId[];
  /** Page paths that no longer exist, so open tabs can be told. */
  removedPaths?: PagePath[];
  /** Space slugs that no longer exist, so the line that hid a private one goes too. */
  removedSpaces?: string[];
  /** Extra content-relative files the request touched, e.g. `_space.yml` or an attachment. */
  files?: string[];
  /** Commit message for the debounced commit. */
  message?: string;
  /** Skip the debounced commit, e.g. right after an explicit commit or pull. */
  skipCommit?: boolean;
  /** The tab that asked for the change, so it can ignore the echo of its own edit. */
  by?: string | null;
  /** The agent that asked for the change, so the tabs on the page can name it. */
  agent?: LiveAgent | null;
}

/**
 * The write path. Every mutating route funnels through recordMutation() so that a change
 * is indexed and committed exactly once, whichever route made it.
 */
export class Wiring {
  readonly recentWrites: RecentWrites;
  readonly recentRevs: RecentRevs;

  constructor(
    private readonly deps: ServerDeps,
    private readonly log: FastifyBaseLogger,
    private readonly live: LiveHub = new LiveHub(log),
  ) {
    this.recentWrites = new RecentWrites(deps.echoSuppressMs ?? DEFAULT_ECHO_SUPPRESS_MS);
    this.recentRevs = new RecentRevs(deps.echoSuppressMs ?? DEFAULT_ECHO_SUPPRESS_MS);
  }

  /** Mark files as written by this process so the watcher ignores their echo. */
  markWritten(files: Iterable<string>): void {
    this.recentWrites.markAll(files);
  }

  async recordMutation(record: MutationRecord): Promise<void> {
    const pages = record.pages ?? [];
    const touched = [
      ...pages.map((page) => contentRelPath(this.deps.store.contentDir, page.filePath)),
      ...(record.files ?? []),
    ];
    this.markWritten(touched);
    for (const page of pages) {
      this.recentRevs.mark(contentRelPath(this.deps.store.contentDir, page.filePath), page.rev);
    }

    for (const page of pages) {
      await this.#indexPage(page);
    }
    const removedIds = record.removedIds ?? [];
    for (const id of removedIds) {
      await this.#removePage(id);
    }
    await this.cleanUpAfterDelete({
      pageIds: removedIds,
      spaceSlugs: record.removedSpaces ?? [],
    });

    const agent = record.agent ?? null;
    for (const page of pages) {
      this.live.pageChanged(page, 'api', record.by ?? null, agent);
    }
    this.live.pagesRemoved(record.removedPaths ?? []);

    if (record.skipCommit === true) return;
    this.deps.git.scheduleCommit(record.message);
  }

  /**
   * Take away what a delete orphaned: the attachments of a page nothing points at any more, and
   * the exclude lines that hid them or hid a space that is gone. Never fatal; the delete itself
   * already happened.
   */
  async cleanUpAfterDelete(deleted: DeletedSubjects): Promise<string[]> {
    try {
      return await cleanUpAfterDelete(this.#cleanupParts(), deleted);
    } catch (err) {
      this.log.warn({ err }, 'failed to clean up after a delete');
      return [];
    }
  }

  /**
   * The same clean-up over every attachment directory, for the orphans a delete left behind
   * before it took them with it. Only ever called for a rescan somebody asked for, and only
   * once the store index has been rebuilt: the index is what says a page is gone.
   */
  async sweepOrphanedAssets(): Promise<string[]> {
    try {
      return await sweepOrphanedAssets(this.#cleanupParts());
    } catch (err) {
      this.log.warn({ err }, 'failed to sweep orphaned attachments');
      return [];
    }
  }

  /** The unfiltered store and repo: a private space somebody else owns still owns its files. */
  #cleanupParts(): CleanupParts {
    return {
      store: this.deps.store,
      git: this.deps.git,
      markWritten: (files) => this.markWritten(files),
      assetRefs: (candidates) => this.#assetRefsInComments(candidates),
    };
  }

  /**
   * Of these page ids, the ones a comment still shows an attachment of.
   *
   * A comment body is markdown in the account database, so `![x](/_assets/<id>/y.png)` renders
   * as a picture there and the file behind it is in use, even though no page file names it.
   * A comment body is the only markdown the account database holds; every other free-text
   * column in it is shown as plain text, so no url in one of those can render a file.
   *
   * A failed read is logged and then rethrown. The rethrow is what keeps the attachments: the
   * cleanup reads a throw as "cannot say", and an empty answer would read as "no references".
   */
  #assetRefsInComments(candidates: readonly PageId[]): PageId[] {
    try {
      const bodies = this.deps.accounts.commentBodiesContaining(`/${ASSETS_DIR}/`);
      if (bodies.length === 0) return [];
      return candidates.filter((id) =>
        bodies.some((body) => body.includes(`/${assetDirRelPath(id)}/`)),
      );
    } catch (err) {
      this.log.warn({ err }, 'could not read comment bodies; keeping every attachment');
      throw err;
    }
  }

  /** Rebuild the whole index from the store. Used at boot and after a pull. */
  async reindexAll(): Promise<number> {
    const summaries = await this.deps.store.listPages();
    const pages: Page[] = [];
    for (const summary of summaries) {
      const page = await this.deps.store.getPageById(summary.id);
      if (page !== null) pages.push(page);
    }
    return this.deps.search.reindexAll(pages);
  }

  async #indexPage(page: Page): Promise<void> {
    try {
      await this.deps.search.indexPage(page);
    } catch (err) {
      // The file is already on disk; a failed index entry is recoverable, a failed write is not.
      this.log.warn({ err, path: page.path }, 'failed to index page');
    }
  }

  async #removePage(id: PageId): Promise<void> {
    try {
      await this.deps.search.removePage(id);
    } catch (err) {
      this.log.warn({ err, id }, 'failed to remove page from index');
    }
  }
}

/** A running filesystem watcher over the content directory. */
export interface ContentWatcher {
  /** Resolves once the initial directory scan has finished. */
  whenReady(): Promise<void>;
  /** Resolves once every pending batch has been processed. Tests use this. */
  drain(): Promise<void>;
  close(): Promise<void>;
}

type ChangeKind = 'upsert' | 'remove';

/**
 * Watch the content directory for edits made outside the API: an agent writing markdown
 * directly, a `git pull`, or a text editor. Those are re-indexed and committed.
 * Echoes of the API's own writes are dropped, otherwise every save would schedule a
 * second commit for a change that was already scheduled.
 */
export function startContentWatcher(
  deps: ServerDeps,
  wiring: Wiring,
  log: FastifyBaseLogger,
  live: LiveHub = new LiveHub(log),
): ContentWatcher {
  const contentDir = deps.store.contentDir;
  const pending = new Map<string, ChangeKind>();
  let timer: NodeJS.Timeout | null = null;
  let queue: Promise<void> = Promise.resolve();
  let closed = false;

  const watcher: FSWatcher = watch(contentDir, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (candidate: string) => {
      const rel = contentRelPath(contentDir, candidate);
      if (rel.length === 0) return false;
      return rel === '.git' || rel.startsWith('.git/');
    },
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });

  async function flush(): Promise<void> {
    const batch = [...pending.entries()];
    pending.clear();
    if (batch.length === 0) return;

    let changed = false;
    const removed: PagePath[] = [];
    const deleted: { pageIds: PageId[]; spaceSlugs: string[] } = { pageIds: [], spaceSlugs: [] };
    for (const [rel, kind] of batch) {
      try {
        // A removal whose file is back is not a removal. The return can only be missing from
        // this batch because it was suppressed as an echo of an api write, and that write
        // indexed what it wrote; forgetting it here would take a live page out of search.
        if (kind === 'remove' && existsSync(join(contentDir, rel))) continue;
        if (kind === 'remove') {
          const id = isPageFile(rel) ? await deps.store.forgetFile(rel) : null;
          if (id !== null) {
            await deps.search.removePage(id);
            deleted.pageIds.push(id);
          }
          if (isPageFile(rel)) removed.push(relFileToPagePath(rel));
          const slug = spaceFileSlug(rel);
          if (slug !== null) deleted.spaceSlugs.push(slug);
          changed = true;
          continue;
        }
        if (isPageFile(rel)) {
          const page = await deps.store.reloadFile(rel);
          if (page !== null) {
            await deps.search.indexPage(page);
            // Our own write coming back. Calling it a disk change would drop every room on the
            // page and send all of its tabs off to re-read what they just wrote.
            const echo = wiring.recentRevs.has(rel, page.rev);
            if (!echo) live.pageChanged(page, 'disk', null);
            if (echo) continue;
          }
        }
        changed = true;
      } catch (err) {
        log.warn({ err, file: rel }, 'failed to sync an out-of-band content change');
      }
    }

    // A delete made outside the API orphans exactly what an API delete does. This is the only
    // way a whole space goes: nothing in the API removes one, so the exclude line that hid a
    // private space is dropped here, when its `_space.yml` disappears.
    await wiring.cleanUpAfterDelete(deleted);

    live.pagesRemoved(removed);
    if (changed) deps.git.scheduleCommit();
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      queue = queue.then(flush, () => flush());
    }, WATCH_DEBOUNCE_MS);
    timer.unref?.();
  }

  function onEvent(kind: ChangeKind, absolutePath: string): void {
    if (closed) return;
    const rel = contentRelPath(contentDir, absolutePath);
    if (!isTrackedFile(rel)) return;
    if (wiring.recentWrites.consume(rel)) return;
    pending.set(rel, kind);
    schedule();
  }

  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', () => resolve());
  });

  watcher.on('add', (p: string) => onEvent('upsert', p));
  watcher.on('change', (p: string) => onEvent('upsert', p));
  watcher.on('unlink', (p: string) => onEvent('remove', p));
  watcher.on('error', (err: unknown) => log.warn({ err }, 'content watcher error'));

  return {
    whenReady(): Promise<void> {
      return ready;
    },
    async close(): Promise<void> {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
      await queue;
    },
    async drain(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      queue = queue.then(flush, () => flush());
      await queue;
    },
  };
}
