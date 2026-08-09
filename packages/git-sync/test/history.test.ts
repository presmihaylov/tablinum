import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@tablinum/shared';
import {
  cleanupTempDirs,
  disposeEngines,
  git,
  makeEngine,
  page,
  tempDir,
  writeFileIn,
} from './helpers.js';

afterEach(async () => {
  await disposeEngines();
  await cleanupTempDirs();
});

describe('GitEngine.history', () => {
  it('lists the commits that touched one file, newest first', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await writeFileIn(dir, 'eng/deploy.md', page('pg_1', 'Deploy', 'first draft'));
    await engine.commitAll('docs: add the deploy page');
    await writeFileIn(dir, 'eng/deploy.md', page('pg_1', 'Deploy', 'second draft'));
    await engine.commitAll('docs: edit the deploy page');
    await writeFileIn(dir, 'eng/other.md', page('pg_2', 'Other', 'unrelated'));
    await engine.commitAll('docs: add an unrelated page');

    const revisions = await engine.history('eng/deploy.md');

    expect(revisions.map((revision) => revision.message)).toEqual([
      'docs: edit the deploy page',
      'docs: add the deploy page',
    ]);
    const [newest] = revisions;
    expect(newest?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(newest?.author).toBe('tablinum');
    expect(newest?.email).toBe('tablinum@localhost');
    // git renders a zero offset as "Z", so this must pass under TZ=UTC too.
    expect(newest?.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
  });

  it('follows a file across a rename', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    const body = 'A long enough body so git detects the rename by content similarity.';
    await writeFileIn(dir, 'eng/old-name.md', page('pg_1', 'Old name', body));
    await engine.commitAll('docs: create the page');

    await rename(join(dir, 'eng/old-name.md'), join(dir, 'eng/new-name.md'));
    await engine.commitAll('docs: rename the page');

    await writeFileIn(dir, 'eng/new-name.md', page('pg_1', 'New name', `${body} Plus an edit.`));
    await engine.commitAll('docs: edit after the rename');

    const revisions = await engine.history('eng/new-name.md');

    expect(revisions.map((revision) => revision.message)).toEqual([
      'docs: edit after the rename',
      'docs: rename the page',
      'docs: create the page',
    ]);
  });

  it('follows a leaf that was promoted to a directory index', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    const body = 'Runbook body that stays identical while the file moves to index.md.';
    await writeFileIn(dir, 'eng/runbooks.md', page('pg_1', 'Runbooks', body));
    await engine.commitAll('docs: create the runbooks page');

    await mkdir(join(dir, 'eng/runbooks'), { recursive: true });
    await rename(join(dir, 'eng/runbooks.md'), join(dir, 'eng/runbooks/index.md'));
    await writeFileIn(dir, 'eng/runbooks/deploy.md', page('pg_2', 'Deploy', 'child page'));
    await engine.commitAll('docs: promote runbooks to a parent page');

    const revisions = await engine.history('eng/runbooks/index.md');

    expect(revisions.map((revision) => revision.message)).toEqual([
      'docs: promote runbooks to a parent page',
      'docs: create the runbooks page',
    ]);
  });

  it('honours the limit', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    for (let i = 0; i < 5; i += 1) {
      await writeFileIn(dir, 'eng/a.md', page('pg_1', 'A', `revision ${i}`));
      await engine.commitAll(`docs: revision ${i}`);
    }

    expect(await engine.history('eng/a.md', 2)).toHaveLength(2);
    expect(await engine.history('eng/a.md')).toHaveLength(5);
  });

  it('returns an empty list for an unknown file and for a repo with no commits', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });

    expect(await engine.history('eng/missing.md')).toEqual([]);

    await engine.init();
    expect(await engine.history('eng/missing.md')).toEqual([]);
  });

  it('rejects a path outside the content directory', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await expect(engine.history('../escape.md')).rejects.toThrow(AppError);
    await expect(engine.history('eng/../../escape.md')).rejects.toThrow(AppError);
    await expect(engine.history('')).rejects.toThrow(AppError);
  });

  it('accepts an absolute path inside the content directory', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();
    await writeFileIn(dir, 'eng/a.md', page('pg_1', 'A', 'body'));
    await engine.commitAll('docs: add A');

    const revisions = await engine.history(join(dir, 'eng/a.md'));
    expect(revisions).toHaveLength(1);
  });
});

describe('GitEngine.showAtRevision', () => {
  it('returns the file exactly as it was at a revision', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    const original = page('pg_1', 'Deploy', 'the original body');
    await writeFileIn(dir, 'eng/deploy.md', original);
    await engine.commitAll('docs: first');
    await writeFileIn(dir, 'eng/deploy.md', page('pg_1', 'Deploy', 'the new body'));
    await engine.commitAll('docs: second');

    const revisions = await engine.history('eng/deploy.md');
    const oldest = revisions[revisions.length - 1];
    expect(oldest).toBeDefined();

    const content = await engine.showAtRevision('eng/deploy.md', oldest?.sha ?? '');
    expect(content).toBe(original);
  });

  it('reads a file that was deleted later', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await writeFileIn(dir, 'eng/gone.md', page('pg_1', 'Gone', 'still here'));
    const sha = await engine.commitAll('docs: add gone');
    await rm(join(dir, 'eng/gone.md'));
    await engine.commitAll('docs: remove gone');

    const content = await engine.showAtRevision('eng/gone.md', sha ?? '');
    expect(content).toContain('still here');
  });

  it('throws NOT_FOUND for an unknown path or revision', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();
    const head = (await git(dir, 'rev-parse', 'HEAD')).trim();

    await expect(engine.showAtRevision('eng/missing.md', head)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      engine.showAtRevision('.gitattributes', '0000000000000000000000000000000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a revision that git would read as an option', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    await expect(engine.showAtRevision('.gitattributes', '--output=/tmp/x')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(engine.showAtRevision('.gitattributes', '')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
