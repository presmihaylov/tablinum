import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultCommitMessage } from '../src/engine.js';
import {
  cleanupTempDirs,
  commitCount,
  commitSubjects,
  disposeEngines,
  git,
  gitLines,
  makeEngine,
  page,
  tempDir,
  waitFor,
  writeFileIn,
} from './helpers.js';

afterEach(async () => {
  await disposeEngines();
  await cleanupTempDirs();
});

describe('defaultCommitMessage', () => {
  it('counts page files', () => {
    expect(defaultCommitMessage(['eng/a.md'])).toBe('docs: update 1 page(s)');
    expect(defaultCommitMessage(['eng/a.md', 'eng/b.md', '_assets/pg_1/x.png'])).toBe(
      'docs: update 2 page(s)',
    );
  });

  it('falls back to a chore message when no page changed', () => {
    expect(defaultCommitMessage(['_assets/pg_1/x.png', 'eng/_space.yml'])).toBe(
      'chore: update 2 file(s)',
    );
  });
});

describe('GitEngine.commitAll', () => {
  it('commits every change and returns the new sha', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await writeFileIn(dir, 'eng/deploy.md', page('pg_1', 'Deploy', 'Run the script'));
    const sha = await engine.commitAll();

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await git(dir, 'rev-parse', 'HEAD')).trim()).toBe(sha);
    expect(await gitLines(dir, 'ls-tree', '-r', '--name-only', 'HEAD')).toContain('eng/deploy.md');
    expect((await engine.status()).dirtyFiles).toEqual([]);
  });

  it('returns null when the tree is clean', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    expect(await engine.commitAll()).toBeNull();
    expect(await commitCount(dir)).toBe(1);
  });

  it('uses a derived message and honours an explicit one', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await writeFileIn(dir, 'eng/a.md', page('pg_1', 'A', 'one'));
    await writeFileIn(dir, 'eng/b.md', page('pg_2', 'B', 'two'));
    await engine.commitAll();
    expect((await commitSubjects(dir))[0]).toBe('docs: update 2 page(s)');

    await writeFileIn(dir, 'eng/a.md', page('pg_1', 'A', 'one edited'));
    await engine.commitAll('docs: rewrite the A page');
    expect((await commitSubjects(dir))[0]).toBe('docs: rewrite the A page');
  });

  it('commits deletions as well as edits', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();
    await writeFileIn(dir, 'eng/gone.md', page('pg_1', 'Gone', 'temporary'));
    await engine.commitAll();

    await rm(join(dir, 'eng/gone.md'));
    const sha = await engine.commitAll();

    expect(sha).not.toBeNull();
    expect(await gitLines(dir, 'ls-tree', '-r', '--name-only', 'HEAD')).not.toContain('eng/gone.md');
  });

  it('serialises concurrent commits into a single commit', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();
    const before = await commitCount(dir);

    await writeFileIn(dir, 'eng/a.md', page('pg_1', 'A', 'one'));
    await writeFileIn(dir, 'eng/b.md', page('pg_2', 'B', 'two'));
    await writeFileIn(dir, 'eng/c.md', page('pg_3', 'C', 'three'));

    const results = await Promise.all([
      engine.commitAll(),
      engine.commitAll(),
      engine.commitAll(),
      engine.commitAll(),
      engine.commitAll(),
    ]);

    const shas = results.filter((sha): sha is string => sha !== null);
    expect(shas).toHaveLength(1);
    expect(await commitCount(dir)).toBe(before + 1);
    const tracked = await gitLines(dir, 'ls-tree', '-r', '--name-only', 'HEAD');
    expect(tracked).toEqual(expect.arrayContaining(['eng/a.md', 'eng/b.md', 'eng/c.md']));
  });
});

describe('GitEngine.scheduleCommit', () => {
  it('coalesces ten rapid saves into one commit', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, autocommitMs: 40 });
    await engine.init();
    const before = await commitCount(dir);

    for (let i = 0; i < 10; i += 1) {
      await writeFileIn(dir, `eng/page-${i}.md`, page(`pg_${i}`, `Page ${i}`, `body ${i}`));
      engine.scheduleCommit();
    }

    await waitFor(async () => (await commitCount(dir)) > before, 'the debounced commit');
    await engine.whenIdle();

    expect(await commitCount(dir)).toBe(before + 1);
    expect((await commitSubjects(dir))[0]).toBe('docs: update 10 page(s)');
    expect((await engine.status()).dirtyFiles).toEqual([]);
  });

  it('commits again after a later burst', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, autocommitMs: 30 });
    await engine.init();
    const before = await commitCount(dir);

    await writeFileIn(dir, 'eng/first.md', page('pg_1', 'First', 'one'));
    engine.scheduleCommit();
    await waitFor(async () => (await commitCount(dir)) === before + 1, 'the first commit');

    await writeFileIn(dir, 'eng/second.md', page('pg_2', 'Second', 'two'));
    engine.scheduleCommit();
    await waitFor(async () => (await commitCount(dir)) === before + 2, 'the second commit');

    expect(await commitCount(dir)).toBe(before + 2);
  });

  it('flushPendingCommit commits immediately and cancels the timer', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, autocommitMs: 60000 });
    await engine.init();
    const before = await commitCount(dir);

    await writeFileIn(dir, 'eng/now.md', page('pg_1', 'Now', 'immediate'));
    engine.scheduleCommit();
    const sha = await engine.flushPendingCommit();

    expect(sha).not.toBeNull();
    expect(await commitCount(dir)).toBe(before + 1);
  });

  it('dispose stops a pending auto commit', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, autocommitMs: 20 });
    await engine.init();
    const before = await commitCount(dir);

    await writeFileIn(dir, 'eng/pending.md', page('pg_1', 'Pending', 'never committed'));
    engine.scheduleCommit();
    engine.dispose();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await commitCount(dir)).toBe(before);

    // A disposed engine ignores further signals too.
    engine.scheduleCommit();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await commitCount(dir)).toBe(before);
  });

  it('close commits whatever was still pending', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, autocommitMs: 60000 });
    await engine.init();
    const before = await commitCount(dir);

    await writeFileIn(dir, 'eng/last.md', page('pg_1', 'Last', 'saved on shutdown'));
    engine.scheduleCommit();
    await engine.close();

    expect(await commitCount(dir)).toBe(before + 1);
  });
});
