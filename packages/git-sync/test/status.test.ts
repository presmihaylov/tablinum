import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitStatusSchema } from '@tablinum/shared';
import {
  bareRemote,
  cleanupTempDirs,
  cloneOf,
  disposeEngines,
  git,
  makeEngine,
  page,
  tempDir,
  writeFileIn,
} from './helpers.js';

afterEach(async () => {
  disposeEngines();
  await cleanupTempDirs();
});

describe('GitEngine.status', () => {
  it('describes a fresh local repo', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, branch: 'main' });
    await engine.init();

    const status = await engine.status();

    expect(GitStatusSchema.safeParse(status).success).toBe(true);
    expect(status.branch).toBe('main');
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
    expect(status.dirtyFiles).toEqual([]);
    expect(status.remote).toBeNull();
    expect(status.lastCommit?.message).toBe('chore: initialize tablinum content repo');
    expect(status.lastCommit?.author).toBe('tablinum');
  });

  it('works before init, on a directory that is not a repo yet', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, branch: 'main' });

    const status = await engine.status();

    expect(status.branch).toBe('main');
    expect(status.lastCommit).toBeNull();
    expect(status.dirtyFiles).toEqual([]);
  });

  it('lists added, modified and deleted files', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();
    await writeFileIn(dir, 'eng/keep.md', page('pg_1', 'Keep', 'keep me'));
    await writeFileIn(dir, 'eng/gone.md', page('pg_2', 'Gone', 'delete me'));
    await engine.commitAll();

    await writeFileIn(dir, 'eng/keep.md', page('pg_1', 'Keep', 'changed'));
    await writeFileIn(dir, 'eng/fresh.md', page('pg_3', 'Fresh', 'brand new'));
    await rm(join(dir, 'eng/gone.md'));

    const status = await engine.status();

    expect(status.dirtyFiles).toEqual(['eng/fresh.md', 'eng/gone.md', 'eng/keep.md']);
  });

  it('counts commits ahead of and behind the remote', async () => {
    const remote = await bareRemote();
    const peer = await cloneOf(remote);
    await writeFileIn(peer, '.gitattributes', '*.md text eol=lf\n');
    await writeFileIn(peer, 'eng/index.md', page('pg_1', 'Engineering', 'base'));
    await git(peer, 'add', '-A');
    await git(peer, 'commit', '-m', 'docs: seed');
    await git(peer, 'push', 'origin', 'HEAD:main');

    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, remote, branch: 'main' });
    await engine.init();

    expect(await engine.status()).toMatchObject({ ahead: 0, behind: 0, remote });

    await writeFileIn(dir, 'eng/a.md', page('pg_2', 'A', 'local work'));
    await engine.commitAll();
    expect((await engine.status()).ahead).toBe(1);

    await git(peer, 'commit', '--allow-empty', '-m', 'docs: peer work');
    await git(peer, 'push', 'origin', 'HEAD:main');
    // status never touches the network; the counts move only after a fetch.
    expect((await engine.status()).behind).toBe(0);

    await git(dir, 'fetch', 'origin');
    const status = await engine.status();
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(1);
  });

  it('reports the remote url once one is configured', async () => {
    const dir = await tempDir();
    const remote = await bareRemote();
    const engine = makeEngine({ contentDir: dir, remote });
    await engine.init();

    expect((await engine.status()).remote).toBe(remote);
  });
});
