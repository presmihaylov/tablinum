import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@tablinum/shared';
import {
  cleanupTempDirs,
  commitSubjects,
  disposeEngines,
  gitLines,
  makeEngine,
  page,
  readFileIn,
  tempDir,
  writeFileIn,
} from './helpers.js';

/**
 * A private space is a directory git is told to ignore. The line lives in `.git/info/exclude`
 * rather than a committed `.gitignore`, so the slug never reaches a remote either.
 */

afterEach(async () => {
  await disposeEngines();
  await cleanupTempDirs();
});

describe('excludePath', () => {
  it('writes the line, and writes it once', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await engine.excludePath('secrets');
    await engine.excludePath('secrets');

    // `git init` seeds the file from its template, so the line is appended, not the whole file.
    expect(await readFileIn(dir, '.git/info/exclude')).toMatch(/\/secrets\/\n$/);
    expect(await engine.excludedPaths()).toEqual(['secrets']);
  });

  it('keeps whatever the exclude file already held', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();
    await writeFileIn(dir, '.git/info/exclude', '# a comment\nscratch.txt');

    await engine.excludePath('secrets');

    expect(await readFileIn(dir, '.git/info/exclude')).toBe('# a comment\nscratch.txt\n/secrets/\n');
  });

  it('keeps an excluded directory out of every commit', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await engine.excludePath('secrets');
    await writeFileIn(dir, 'secrets/_space.yml', 'name: Secrets\nowner: us_someone\n');
    await writeFileIn(dir, 'secrets/index.md', page('pg_01J0000000000000000000000C', 'Secrets', 'Nobody else reads this.'));
    await writeFileIn(dir, 'docs/index.md', page('pg_01J0000000000000000000000D', 'Docs', 'Everybody reads this.'));

    await engine.commitAll('docs: add a page');

    const tracked = await gitLines(dir, 'ls-files');
    expect(tracked).toContain('docs/index.md');
    expect(tracked.filter((file) => file.startsWith('secrets/'))).toEqual([]);
    // The exclude file is git's own metadata, so it is never a tracked file either.
    expect(tracked).not.toContain('.git/info/exclude');
    expect(await engine.status()).toMatchObject({ dirtyFiles: [] });
  });

  it('hides a nested attachment directory too', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await engine.excludePath('_assets/pg_01J0000000000000000000000A');
    await writeFileIn(dir, '_assets/pg_01J0000000000000000000000A/plan.png', 'not really a png');
    await writeFileIn(dir, '_assets/pg_01J0000000000000000000000B/open.png', 'also not a png');

    await engine.commitAll('docs: add attachments');

    const tracked = await gitLines(dir, 'ls-files');
    expect(tracked.filter((file) => file.startsWith('_assets/'))).toEqual([
      '_assets/pg_01J0000000000000000000000B/open.png',
    ]);
  });

  it('refuses a path that could escape the content directory or match a glob', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    for (const bad of ['../elsewhere', 'a/../b', '*', 'sec rets', '', '/absolute']) {
      await expect(engine.excludePath(bad)).rejects.toBeInstanceOf(AppError);
    }
    expect(await engine.excludedPaths()).toEqual([]);
  });

  it('leaves the history alone: the exclude file is never committed', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();
    const before = await commitSubjects(dir);

    await engine.excludePath('secrets');

    expect(await commitSubjects(dir)).toEqual(before);
  });
});
