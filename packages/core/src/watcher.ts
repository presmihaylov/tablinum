import path from 'node:path';
import type { Stats } from 'node:fs';
import { watch, type FSWatcher } from 'chokidar';
import { ASSETS_DIR, PAGE_EXT, SPACE_FILE } from '@gitdocs/shared';
import { consoleLogger, type Logger } from './logger.js';

export type ContentChangeType = 'add' | 'change' | 'unlink';

export interface ContentChange {
  type: ContentChangeType;
  /** Absolute path of the file that changed. */
  filePath: string;
}

export interface WatchContentOptions {
  /** Quiet period before changes are reported. Defaults to 200ms. */
  debounceMs?: number;
  /** Use polling instead of native events. Needed on some network filesystems. */
  usePolling?: boolean;
  logger?: Logger;
  /** Called once per flush with every coalesced change. */
  onBatch?: (changes: ContentChange[]) => void;
  onError?: (error: Error) => void;
}

export interface ContentWatcher {
  /** Resolves once the initial scan has finished. */
  readonly ready: Promise<void>;
  close(): Promise<void>;
}

const IGNORED_NAMES = new Set(['.git', 'node_modules', ASSETS_DIR]);
const DEFAULT_DEBOUNCE_MS = 200;

function isWatchedFileName(name: string): boolean {
  if (name === SPACE_FILE) return true;
  if (name.startsWith('.') || name.startsWith('_')) return false;
  return name.toLowerCase().endsWith(PAGE_EXT);
}

/** chokidar asks about a path twice: once without stats while scanning, once with. */
export function shouldIgnore(root: string, target: string, stats?: Stats): boolean {
  const relative = path.relative(root, target);
  if (relative.length === 0) return false;
  if (relative.startsWith('..')) return true;
  const parts = relative.split(path.sep);
  for (const part of parts) {
    if (part.startsWith('.')) return true;
    if (IGNORED_NAMES.has(part)) return true;
  }
  const name = parts[parts.length - 1] ?? '';
  if (stats?.isDirectory() === true) return false;
  if (stats?.isFile() === true) return !isWatchedFileName(name);
  // No stats yet: keep anything that could be a directory.
  if (path.extname(name).length === 0 && name !== SPACE_FILE) return false;
  return !isWatchedFileName(name);
}

function merge(previous: ContentChangeType | undefined, next: ContentChangeType): ContentChangeType | null {
  if (previous === undefined) return next;
  if (previous === 'add' && next === 'unlink') return null; // created then removed: nothing happened
  if (previous === 'add') return 'add';
  if (previous === 'unlink' && next !== 'unlink') return 'change';
  return next;
}

/**
 * Watch a content directory for markdown and space-file changes.
 * Changes are coalesced per file and reported after a quiet period.
 */
export function watchContent(
  dir: string,
  onChange: (change: ContentChange) => void,
  options: WatchContentOptions = {},
): ContentWatcher {
  const root = path.resolve(dir);
  const logger = options.logger ?? consoleLogger;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pending = new Map<string, ContentChangeType>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const flush = (): void => {
    timer = null;
    if (pending.size === 0) return;
    const changes: ContentChange[] = [...pending].map(([filePath, type]) => ({ type, filePath }));
    pending.clear();
    for (const change of changes) onChange(change);
    options.onBatch?.(changes);
  };

  const record = (type: ContentChangeType, filePath: string): void => {
    if (closed) return;
    const absolute = path.resolve(filePath);
    const merged = merge(pending.get(absolute), type);
    if (merged === null) pending.delete(absolute);
    else pending.set(absolute, merged);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
    timer.unref?.();
  };

  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    persistent: true,
    usePolling: options.usePolling ?? false,
    interval: 100,
    ignored: (target: string, stats?: Stats) => shouldIgnore(root, target, stats),
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
  });

  watcher.on('add', (filePath) => record('add', filePath));
  watcher.on('change', (filePath) => record('change', filePath));
  watcher.on('unlink', (filePath) => record('unlink', filePath));
  watcher.on('error', (error) => {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    if (options.onError !== undefined) {
      options.onError(wrapped);
      return;
    }
    logger.error(`Content watcher error: ${wrapped.message}`, wrapped);
  });

  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', () => resolve());
  });

  return {
    ready,
    async close(): Promise<void> {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
      await watcher.close();
    },
  };
}
