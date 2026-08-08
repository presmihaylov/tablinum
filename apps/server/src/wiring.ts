import { relative, sep } from 'node:path';
import { type FSWatcher, watch } from 'chokidar';
import type { FastifyBaseLogger } from 'fastify';
import {
  ASSETS_DIR,
  PAGE_EXT,
  SPACE_FILE,
  pagePathToRelFile,
  type Page,
  type PageId,
  type PagePath,
} from '@gitdocs/shared';
import type { ServerDeps } from './deps.js';

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

/** What a mutating route did, so the index and git stay in step with the disk. */
export interface MutationRecord {
  /** Pages to insert or refresh in the full-text index. */
  pages?: Page[];
  /** Page ids that no longer exist. */
  removedIds?: PageId[];
  /** Extra content-relative files the request touched, e.g. `_space.yml` or an attachment. */
  files?: string[];
  /** Commit message for the debounced commit. */
  message?: string;
  /** Skip the debounced commit, e.g. right after an explicit commit or pull. */
  skipCommit?: boolean;
}

/**
 * The write path. Every mutating route funnels through recordMutation() so that a change
 * is indexed and committed exactly once, whichever route made it.
 */
export class Wiring {
  readonly recentWrites: RecentWrites;

  constructor(
    private readonly deps: ServerDeps,
    private readonly log: FastifyBaseLogger,
  ) {
    this.recentWrites = new RecentWrites(deps.echoSuppressMs ?? DEFAULT_ECHO_SUPPRESS_MS);
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
      await this.#indexPage(page);
    }
    for (const id of record.removedIds ?? []) {
      await this.#removePage(id);
    }

    if (record.skipCommit === true) return;
    this.deps.git.scheduleCommit(record.message);
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
    for (const [rel, kind] of batch) {
      try {
        if (kind === 'remove') {
          const id = isPageFile(rel) ? await deps.store.forgetFile(rel) : null;
          if (id !== null) await deps.search.removePage(id);
          changed = true;
          continue;
        }
        if (isPageFile(rel)) {
          const page = await deps.store.reloadFile(rel);
          if (page !== null) await deps.search.indexPage(page);
        }
        changed = true;
      } catch (err) {
        log.warn({ err, file: rel }, 'failed to sync an out-of-band content change');
      }
    }

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
