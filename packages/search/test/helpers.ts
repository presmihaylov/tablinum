import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newPageId } from '@gitdocs/shared';
import type { IndexablePage } from '../src/index.js';

let counter = 0;

/** Build an indexable page, filling in everything the test does not care about. */
export function page(overrides: Partial<IndexablePage> & { path: string }): IndexablePage {
  counter += 1;
  const space = overrides.path.split('/')[0] ?? 'eng';
  return {
    id: overrides.id ?? newPageId(),
    path: overrides.path,
    space: overrides.space ?? space,
    title: overrides.title ?? `Page ${counter}`,
    updated: overrides.updated ?? new Date(Date.UTC(2026, 0, 1)).toISOString(),
    markdown: overrides.markdown ?? '',
  };
}

export interface TempDb {
  dbPath: string;
  cleanup: () => void;
}

/** A throwaway on-disk database, so tests exercise the same code path as production. */
export function tempDb(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'gitdocs-search-'));
  return {
    dbPath: join(dir, 'nested', 'search.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
