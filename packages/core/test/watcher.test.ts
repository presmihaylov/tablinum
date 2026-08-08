import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { silentLogger } from '../src/logger.js';
import { shouldIgnore, watchContent, type ContentChange } from '../src/watcher.js';
import { makeTempDir, removeTempDir, writeFileAt } from './helpers.js';

let dir = '';

beforeEach(async () => {
  dir = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(dir);
});

function collector(): { changes: ContentChange[]; onChange: (change: ContentChange) => void } {
  const changes: ContentChange[] = [];
  return { changes, onChange: (change): number => changes.push(change) };
}

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for a change');
}

describe('shouldIgnore', () => {
  it('keeps markdown pages and space files', () => {
    expect(shouldIgnore(dir, path.join(dir, 'docs', 'guide.md'))).toBe(false);
    expect(shouldIgnore(dir, path.join(dir, 'docs', '_space.yml'))).toBe(false);
  });

  it('drops git internals, attachments and dotfiles', () => {
    expect(shouldIgnore(dir, path.join(dir, '.git', 'HEAD'))).toBe(true);
    expect(shouldIgnore(dir, path.join(dir, '_assets', 'pg_A', 'shot.png'))).toBe(true);
    expect(shouldIgnore(dir, path.join(dir, 'docs', '.DS_Store'))).toBe(true);
    expect(shouldIgnore(dir, path.join(dir, 'node_modules', 'x', 'a.md'))).toBe(true);
  });

  it('drops files that are not pages', () => {
    expect(shouldIgnore(dir, path.join(dir, 'docs', 'notes.txt'))).toBe(true);
    expect(shouldIgnore(dir, path.join(dir, 'docs', '_draft.md'))).toBe(true);
  });

  it('keeps the root itself and anything that could be a directory', () => {
    expect(shouldIgnore(dir, dir)).toBe(false);
    expect(shouldIgnore(dir, path.join(dir, 'docs'))).toBe(false);
  });
});

describe('watchContent', () => {
  it('reports add, change and unlink', async () => {
    const { changes, onChange } = collector();
    const watcher = watchContent(dir, onChange, {
      debounceMs: 30,
      usePolling: true,
      logger: silentLogger,
    });
    try {
      await watcher.ready;
      const target = path.join(dir, 'docs', 'guide.md');

      await writeFileAt(dir, 'docs/guide.md', 'one');
      await waitFor(() => changes.some((change) => change.type === 'add'));

      await writeFileAt(dir, 'docs/guide.md', 'one two three');
      await waitFor(() => changes.some((change) => change.type === 'change'));

      await rm(target);
      await waitFor(() => changes.some((change) => change.type === 'unlink'));

      expect(changes.every((change) => change.filePath === target)).toBe(true);
    } finally {
      await watcher.close();
    }
  });

  it('stays quiet for ignored files', async () => {
    const { changes, onChange } = collector();
    const watcher = watchContent(dir, onChange, {
      debounceMs: 30,
      usePolling: true,
      logger: silentLogger,
    });
    try {
      await watcher.ready;
      await writeFileAt(dir, '_assets/pg_A/shot.png', 'binary-ish');
      await writeFileAt(dir, 'docs/notes.txt', 'plain');
      await writeFileAt(dir, 'docs/real.md', 'page');
      await waitFor(() => changes.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(changes.map((change) => path.basename(change.filePath))).toEqual(['real.md']);
    } finally {
      await watcher.close();
    }
  });

  it('reports nothing after it is closed', async () => {
    const { changes, onChange } = collector();
    const watcher = watchContent(dir, onChange, {
      debounceMs: 30,
      usePolling: true,
      logger: silentLogger,
    });
    await watcher.ready;
    await watcher.close();
    await writeFileAt(dir, 'docs/late.md', 'page');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(changes).toHaveLength(0);
  });
});
