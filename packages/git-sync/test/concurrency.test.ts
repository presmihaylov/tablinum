import { afterEach, describe, expect, it } from 'vitest';
import {
  bareRemote,
  cleanupTempDirs,
  cloneOf,
  disposeEngines,
  git,
  gitLines,
  makeEngine,
  page,
  readFileIn,
  tempDir,
  writeFileIn,
} from './helpers.js';
import { GitEngine, type GitEngineOptions } from '../src/engine.js';

afterEach(async () => {
  await disposeEngines();
  await cleanupTempDirs();
});

async function seededRemote(): Promise<{ remote: string; peer: string }> {
  const remote = await bareRemote();
  const peer = await cloneOf(remote);
  await writeFileIn(peer, '.gitattributes', '*.md text eol=lf\n');
  await writeFileIn(peer, 'eng/index.md', page('pg_1', 'Engineering', 'base body'));
  await git(peer, 'add', '-A');
  await git(peer, 'commit', '-m', 'docs: seed the remote');
  await git(peer, 'push', 'origin', 'HEAD:main');
  await git(peer, 'branch', '--set-upstream-to=origin/main', 'main');
  return { remote, peer };
}

async function clonedEngine(
  remote: string,
  options: Partial<GitEngineOptions> = {},
): Promise<{ engine: GitEngine; dir: string }> {
  const dir = await tempDir();
  const engine = makeEngine({ contentDir: dir, remote, branch: 'main', ...options });
  await engine.init();
  return { engine, dir };
}

async function peerPush(peer: string, body: string, message: string): Promise<void> {
  await git(peer, 'pull', '--rebase', 'origin', 'main');
  await writeFileIn(peer, 'eng/index.md', page('pg_1', 'Engineering', body));
  await git(peer, 'add', '-A');
  await git(peer, 'commit', '-m', message);
  await git(peer, 'push', 'origin', 'HEAD:main');
}

/** Nothing may be staged or modified once every queued operation has finished. */
async function isClean(dir: string): Promise<boolean> {
  const lines = await gitLines(dir, 'status', '--porcelain');
  return lines.filter((line) => line.length > 0).length === 0;
}

describe('local git operations under load', () => {
  it('queues many simultaneous commits without leaving the repo dirty', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    // Every writer touches the tree and asks for a commit at the same moment. Without the
    // engine lock these race on .git/index.lock and git starts failing outright.
    await Promise.all(
      Array.from({ length: 15 }, async (_, i) => {
        await writeFileIn(dir, `eng/p${i}.md`, page(`pg_${i}`, `P${i}`, `body ${i}`));
        return engine.commitAll(`Update p${i}`);
      }),
    );

    expect(await isClean(dir)).toBe(true);
    const log = await gitLines(dir, 'log', '--oneline');
    expect(log.length).toBeGreaterThan(0);
  });

  it('never loses a file when commits and reads interleave', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    const writes = Array.from({ length: 12 }, async (_, i) => {
      await writeFileIn(dir, `eng/p${i}.md`, page(`pg_${i}`, `P${i}`, `body ${i}`));
      await engine.commitAll(`Update p${i}`);
    });
    const statuses = Array.from({ length: 12 }, () => engine.status());
    await Promise.all([...writes, ...statuses]);
    await engine.whenIdle();

    expect(await isClean(dir)).toBe(true);
    const tracked = await gitLines(dir, 'ls-files');
    for (let i = 0; i < 12; i += 1) {
      expect(tracked).toContain(`eng/p${i}.md`);
    }
  });

  it('coalesces debounced commits instead of stacking them up', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, autoCommitMs: 20 });
    await engine.init();

    for (let i = 0; i < 10; i += 1) {
      await writeFileIn(dir, `eng/p${i}.md`, page(`pg_${i}`, `P${i}`, `body ${i}`));
      engine.scheduleCommit(`Update p${i}`);
    }
    await engine.flushPendingCommit();
    await engine.whenIdle();

    expect(await isClean(dir)).toBe(true);
  });
});

describe('remote git operations under load', () => {
  it('serialises a pull against concurrent local commits', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);
    await peerPush(peer, 'changed upstream', 'docs: upstream edit');

    // The autopull lands in the middle of a burst of local saves.
    const work: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i += 1) {
      work.push(
        (async (): Promise<void> => {
          await writeFileIn(dir, `eng/local${i}.md`, page(`pg_l${i}`, `L${i}`, `local ${i}`));
          await engine.commitAll(`Add local${i}`);
        })(),
      );
    }
    // A save writes to disk without the git mutex, so this pull may lose the race and abort.
    // It then retries below, once the burst is over.
    work.push(engine.pull().catch(() => undefined));
    await Promise.all(work);
    await engine.whenIdle();
    await engine.pull();

    expect(await isClean(dir)).toBe(true);
    expect(engine.conflict()).toBeNull();
    // The remote change arrived and no local file was dropped on the way.
    expect(await readFileIn(dir, 'eng/index.md')).toContain('changed upstream');
    const tracked = await gitLines(dir, 'ls-files');
    for (let i = 0; i < 10; i += 1) {
      expect(tracked).toContain(`eng/local${i}.md`);
    }
  });

  it('survives a pull that races a page saved over and over', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);
    // The file must already be tracked, so each rewrite is an unstaged change and not an add.
    await writeFileIn(dir, 'eng/notes.md', page('pg_n', 'Notes', 'draft 0'));
    await engine.commitAll('Add notes');
    await peerPush(peer, 'changed upstream', 'docs: upstream edit');

    let writing = true;
    let writes = 0;
    const writer = (async (): Promise<void> => {
      while (writing) {
        writes += 1;
        await writeFileIn(dir, 'eng/notes.md', page('pg_n', 'Notes', `draft ${writes}`));
      }
    })();

    // Saves do not hold the git mutex, so a pull under this much contention is allowed to fail.
    // What it may never do is leave the repo half-rebased or drop the edit that was in flight.
    await engine.pull().catch(() => undefined);
    writing = false;
    await writer;
    await engine.whenIdle();

    expect(await readFileIn(dir, 'eng/notes.md')).toContain(`draft ${writes}`);
    expect(await gitLines(dir, 'stash', 'list')).toEqual([]);

    // Contention only delays the pull. Once the writes stop, the next one gets the remote change.
    await engine.pull();
    expect(engine.conflict()).toBeNull();
    expect(await readFileIn(dir, 'eng/index.md')).toContain('changed upstream');
    expect(await isClean(dir)).toBe(true);
  });

  it('serialises a push against concurrent local commits', async () => {
    const { remote } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    const work: Array<Promise<unknown>> = [];
    for (let i = 0; i < 8; i += 1) {
      work.push(
        (async (): Promise<void> => {
          await writeFileIn(dir, `eng/p${i}.md`, page(`pg_${i}`, `P${i}`, `body ${i}`));
          await engine.commitAll(`Add p${i}`);
        })(),
      );
    }
    work.push(engine.push());
    await Promise.all(work);
    await engine.whenIdle();
    const pushed = await engine.push();
    expect(pushed.reason).not.toBe('no-remote');

    expect(await isClean(dir)).toBe(true);
    const remoteFiles = await gitLines(remote, 'ls-tree', '-r', '--name-only', 'main');
    for (let i = 0; i < 8; i += 1) {
      expect(remoteFiles).toContain(`eng/p${i}.md`);
    }
  });

  it('keeps the local commit when the push fails', async () => {
    const { remote } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);
    await writeFileIn(dir, 'eng/kept.md', page('pg_kept', 'Kept', 'must survive'));
    await engine.commitAll('Add kept');

    // The remote disappears, which is what a dropped network or a rotated token looks like.
    await git(dir, 'remote', 'set-url', 'origin', `${remote}-gone`);
    // A failed push reports by throwing, so anything that pushes in the background has to
    // catch. What must never happen is the local commit going missing with it.
    await expect(engine.push()).rejects.toThrow();

    expect(await isClean(dir)).toBe(true);
    expect(await readFileIn(dir, 'eng/kept.md')).toContain('must survive');
    const subjects = await gitLines(dir, 'log', '--format=%s');
    expect(subjects).toContain('Add kept');
  });

  it('reports a real remote conflict rather than swallowing either side', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    await peerPush(peer, 'upstream wins', 'docs: upstream edit');
    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'local wins'));
    await engine.commitAll('Local edit');

    await expect(engine.pull()).rejects.toThrow();

    const versions = await engine.conflictVersions();
    expect(versions.length).toBeGreaterThan(0);
    const both = JSON.stringify(versions);
    // Neither side may be thrown away: the person has to be able to see both.
    expect(both).toContain('local wins');
    expect(both).toContain('upstream wins');
  });

  it('leaves the working tree usable after a failed pull', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    await peerPush(peer, 'upstream wins', 'docs: upstream edit');
    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'local wins'));
    await engine.commitAll('Local edit');
    await engine.pull().catch(() => null);

    // A rebase left half-applied would make every later write fail.
    const inProgress = await gitLines(dir, 'status', '--porcelain=v2', '--branch');
    expect(inProgress.join('\n')).not.toContain('rebase');
    expect(await readFileIn(dir, 'eng/index.md')).toContain('local wins');
  });
});

describe('with no remote configured', () => {
  it('treats pull and push as no-ops and still commits', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();
    await writeFileIn(dir, 'eng/solo.md', page('pg_solo', 'Solo', 'body'));
    await engine.commitAll('Add solo');

    const pulled = await engine.pull();
    const pushed = await engine.push();

    expect(pulled.reason).toBe('no-remote');
    expect(pushed.reason).toBe('no-remote');
    expect(pushed.pushed).toBe(false);
    expect(await isClean(dir)).toBe(true);
    const subjects = await gitLines(dir, 'log', '--format=%s');
    expect(subjects).toContain('Add solo');
  });
});
