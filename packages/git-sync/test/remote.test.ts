import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@tablinum/shared';
import {
  bareRemote,
  captureLogger,
  cleanupTempDirs,
  cloneOf,
  commitSubjects,
  disposeEngines,
  exists,
  git,
  gitLines,
  makeEngine,
  page,
  readFileIn,
  tempDir,
  waitFor,
  writeFileIn,
} from './helpers.js';
import { GitEngine, type GitEngineOptions } from '../src/engine.js';

afterEach(async () => {
  await disposeEngines();
  await cleanupTempDirs();
});

/** A bare remote seeded with one page, plus a peer clone that plays the second author. */
async function seededRemote(): Promise<{ remote: string; peer: string }> {
  const remote = await bareRemote();
  const peer = await cloneOf(remote);
  // The seed already carries .gitattributes, so init has nothing extra to commit after the clone.
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

describe('GitEngine.push', () => {
  it('pushes local commits to the remote', async () => {
    const { remote } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    await writeFileIn(dir, 'eng/deploy.md', page('pg_2', 'Deploy', 'run the script'));
    await engine.commitAll('docs: add the deploy page');
    const result = await engine.push();

    expect(result).toEqual({ pushed: true, reason: 'pushed' });
    expect(await gitLines(remote, 'log', '--format=%s', 'main')).toContain(
      'docs: add the deploy page',
    );
  });

  it('is a no-op when the branch is already up to date', async () => {
    const { remote } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    await writeFileIn(dir, 'eng/deploy.md', page('pg_2', 'Deploy', 'run the script'));
    await engine.commitAll();
    await engine.push();

    expect(await engine.push()).toEqual({ pushed: false, reason: 'up-to-date' });
  });

  it('returns a clear no-op when no remote is configured', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    expect(await engine.push()).toEqual({ pushed: false, reason: 'no-remote' });
  });

  it('reports a GIT_ERROR when the remote is unreachable', async () => {
    const dir = await tempDir();
    const missing = join(await tempDir(), 'missing-remote.git');
    const engine = makeEngine({ contentDir: dir, remote: missing });
    await engine.init();

    await writeFileIn(dir, 'eng/a.md', page('pg_1', 'A', 'body'));
    await engine.commitAll();

    await expect(engine.push()).rejects.toMatchObject({ code: 'GIT_ERROR' });
  });
});

describe('GitEngine.pull', () => {
  it('brings remote commits into the working tree', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);
    await peerPush(peer, 'body written by the other author', 'docs: peer edit');

    const result = await engine.pull();

    expect(result.pulled).toBe(1);
    expect(result.reason).toBe('pulled');
    expect(result.files).toContain('eng/index.md');
    expect(await readFileIn(dir, 'eng/index.md')).toContain('body written by the other author');
  });

  it('replays local commits on top of the remote ones', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    await writeFileIn(dir, 'eng/local.md', page('pg_9', 'Local', 'only here'));
    await engine.commitAll('docs: local only page');
    await peerPush(peer, 'peer body', 'docs: peer edit');

    const result = await engine.pull();

    expect(result.pulled).toBe(1);
    const subjects = await commitSubjects(dir);
    expect(subjects[0]).toBe('docs: local only page');
    expect(subjects[1]).toBe('docs: peer edit');
    expect(await readFileIn(dir, 'eng/local.md')).toContain('only here');
    expect(await readFileIn(dir, 'eng/index.md')).toContain('peer body');
  });

  it('commits uncommitted local edits before it rebases', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);
    await peerPush(peer, 'peer body', 'docs: peer edit');

    await writeFileIn(dir, 'eng/draft.md', page('pg_9', 'Draft', 'not yet committed'));
    const result = await engine.pull();

    expect(result.pulled).toBe(1);
    expect((await engine.status()).dirtyFiles).toEqual([]);
    expect(await commitSubjects(dir)).toContain('docs: save local edits before pull');
    expect(await readFileIn(dir, 'eng/draft.md')).toContain('not yet committed');
  });

  it('reports up-to-date when the remote has nothing new', async () => {
    const { remote } = await seededRemote();
    const { engine } = await clonedEngine(remote);

    expect(await engine.pull()).toEqual({ pulled: 0, files: [], reason: 'up-to-date' });
  });

  it('returns a clear no-op when no remote is configured', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    expect(await engine.pull()).toEqual({ pulled: 0, files: [], reason: 'no-remote' });
  });

  it('aborts a conflicting rebase and leaves the repo clean', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'the tablinum version'));
    await engine.commitAll('docs: local edit');
    const localHead = (await git(dir, 'rev-parse', 'HEAD')).trim();

    await peerPush(peer, 'the other author version', 'docs: peer edit');

    await expect(engine.pull()).rejects.toMatchObject({ code: 'GIT_ERROR' });
    await expect(engine.pull()).rejects.toThrow(/eng\/index\.md/);

    // The repo must be exactly where it was: no rebase in progress, no conflict markers.
    expect(await exists(join(dir, '.git', 'rebase-merge'))).toBe(false);
    expect(await exists(join(dir, '.git', 'rebase-apply'))).toBe(false);
    expect((await git(dir, 'rev-parse', 'HEAD')).trim()).toBe(localHead);
    expect((await engine.status()).dirtyFiles).toEqual([]);
    expect(await readFileIn(dir, 'eng/index.md')).toContain('the tablinum version');
    expect(await readFileIn(dir, 'eng/index.md')).not.toContain('<<<<<<<');
  });

  it('stays usable after a conflict is resolved by hand', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'the tablinum version'));
    await engine.commitAll('docs: local edit');
    await peerPush(peer, 'the other author version', 'docs: peer edit');
    await expect(engine.pull()).rejects.toMatchObject({ code: 'GIT_ERROR' });

    // Drop the local edit and pull again, the way an operator would.
    await git(dir, 'reset', '--hard', 'HEAD~1');
    const result = await engine.pull();

    expect(result.pulled).toBe(1);
    expect(await readFileIn(dir, 'eng/index.md')).toContain('the other author version');
  });

  it('adopts the remote branch when the local repo has no commits', async () => {
    const { remote, peer } = await seededRemote();
    await peerPush(peer, 'remote body', 'docs: peer edit');

    // A bare repo directory that was never committed to: pull must still populate it.
    const dir = await tempDir();
    await git(dir, 'init', '--initial-branch=main');
    await git(dir, 'remote', 'add', 'origin', remote);
    const engine = makeEngine({ contentDir: dir, remote, branch: 'main' });

    const result = await engine.pull();

    expect(result.reason).toBe('pulled');
    expect(result.pulled).toBe(2);
    expect(result.files).toContain('eng/index.md');
    expect(await readFileIn(dir, 'eng/index.md')).toContain('remote body');
  });

  it('reports a GIT_ERROR when the fetch itself fails', async () => {
    const dir = await tempDir();
    const missing = join(await tempDir(), 'missing-remote.git');
    const engine = makeEngine({ contentDir: dir, remote: missing });
    await engine.init();

    await expect(engine.pull()).rejects.toMatchObject({ code: 'GIT_ERROR' });
  });
});

describe('GitEngine.resolveConflict refuses anything but the conflicted files', () => {
  /** A clone whose pull has just stopped on a real conflict in eng/index.md. */
  async function armedConflict(): Promise<{ engine: GitEngine; dir: string }> {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote);

    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'the tablinum version'));
    await engine.commitAll('docs: local edit');
    await peerPush(peer, 'the other author version', 'docs: peer edit');
    await expect(engine.pull()).rejects.toThrow(AppError);
    expect(engine.conflict()?.files).toEqual(['eng/index.md']);

    return { engine, dir };
  }

  it('refuses to write .git/config', async () => {
    const { engine, dir } = await armedConflict();
    const before = await readFileIn(dir, '.git/config');

    await expect(
      engine.resolveConflict([
        { file: '.git/config', content: '[core]\n\tfsmonitor = "touch /tmp/pwned"\n' },
      ]),
    ).rejects.toThrow(AppError);

    const after = await readFileIn(dir, '.git/config');
    expect(after).toBe(before);
    expect(after).toContain('[user]');
    expect(after).not.toContain('fsmonitor');
  });

  it('refuses a page git never reported as conflicted', async () => {
    const { engine, dir } = await armedConflict();

    await expect(
      engine.resolveConflict([{ file: 'eng/other.md', content: 'written by the attacker' }]),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    expect(await exists(join(dir, 'eng/other.md'))).toBe(false);
    expect(await readFileIn(dir, 'eng/index.md')).toContain('the tablinum version');
    expect(engine.conflict()?.files).toEqual(['eng/index.md']);
  });

  it('writes nothing at all when one entry of the batch is refused', async () => {
    const { engine, dir } = await armedConflict();
    const agreed = page('pg_1', 'Engineering', 'both authors agreed on this');

    await expect(
      engine.resolveConflict([
        { file: 'eng/index.md', content: agreed },
        { file: '.git/config', content: 'poisoned' },
      ]),
    ).rejects.toThrow(AppError);

    expect(await readFileIn(dir, 'eng/index.md')).toContain('the tablinum version');
    expect(await readFileIn(dir, '.git/config')).not.toContain('poisoned');
  });

  it('still resolves the conflicted file itself', async () => {
    const { engine, dir } = await armedConflict();
    const agreed = page('pg_1', 'Engineering', 'both authors agreed on this');

    const changed = await engine.resolveConflict([{ file: 'eng/index.md', content: agreed }]);

    expect(changed).toContain('eng/index.md');
    expect(engine.conflict()).toBeNull();
    expect(await readFileIn(dir, 'eng/index.md')).toContain('both authors agreed on this');
    expect((await engine.status()).dirtyFiles).toEqual([]);
  });
});

describe('GitEngine.status', () => {
  it('hides the credentials embedded in the remote url', async () => {
    const dir = await tempDir();
    const url = 'https://x-access-token:ghp_secret@example.invalid/acme/docs.git';
    // No network call: status only reads the config this writes.
    await git(dir, 'init', '--initial-branch=main');
    await git(dir, 'remote', 'add', 'origin', url);
    const engine = makeEngine({ contentDir: dir, remote: url, branch: 'main' });

    const status = await engine.status();

    expect(status.remote).toBe('https://example.invalid/acme/docs.git');
    expect(status.remote).not.toContain('ghp_secret');
  });
});

describe('GitEngine auto push', () => {
  it('pushes a debounced commit to the remote without being asked', async () => {
    const { remote } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote, { autocommitMs: 10, autopushMs: 15 });

    await writeFileIn(dir, 'eng/deploy.md', page('pg_2', 'Deploy', 'run the script'));
    engine.scheduleCommit('docs: add the deploy page');

    await waitFor(
      async () => (await gitLines(remote, 'log', '--format=%s', 'main')).includes('docs: add the deploy page'),
      'the auto push to reach the remote',
    );
  });

  it('pulls and retries when the remote moved on', async () => {
    const { remote, peer } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote, { autopushMs: 15 });

    await peerPush(peer, 'peer body', 'docs: peer edit');
    await writeFileIn(dir, 'eng/deploy.md', page('pg_2', 'Deploy', 'local body'));
    await engine.commitAll('docs: local edit');

    await waitFor(
      async () => (await gitLines(remote, 'log', '--format=%s', 'main')).includes('docs: local edit'),
      'the rejected push to be retried after a pull',
    );
    expect(await readFileIn(dir, 'eng/index.md')).toContain('peer body');
  });

  it('stays off when the interval is 0', async () => {
    const { remote } = await seededRemote();
    const { engine, dir } = await clonedEngine(remote, { autopushMs: 0 });

    await writeFileIn(dir, 'eng/deploy.md', page('pg_2', 'Deploy', 'run the script'));
    await engine.commitAll('docs: never pushed on its own');

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await gitLines(remote, 'log', '--format=%s', 'main')).not.toContain(
      'docs: never pushed on its own',
    );
  });
});

describe('GitEngine auto pull', () => {
  it('applies remote commits on an interval and stops on demand', async () => {
    const { remote, peer } = await seededRemote();
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, remote, branch: 'main', autopullMs: 25 });
    await engine.init();

    await peerPush(peer, 'arrived through auto pull', 'docs: peer edit');
    expect(engine.startAutoPull()).toBe(true);

    await waitFor(
      async () => (await readFileIn(dir, 'eng/index.md')).includes('arrived through auto pull'),
      'the auto pull to land',
    );

    engine.stop();
    await engine.whenIdle();
    await peerPush(peer, 'never arrives', 'docs: another peer edit');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await readFileIn(dir, 'eng/index.md')).not.toContain('never arrives');
  });

  it('sits out a round while a page is still being written', async () => {
    const { remote, peer } = await seededRemote();
    const dir = await tempDir();
    const engine = makeEngine({
      contentDir: dir,
      remote,
      branch: 'main',
      autopullMs: 25,
      autocommitMs: 60000,
    });
    await engine.init();

    // A write nobody has finished. A pull now would commit it half-typed to clean the tree.
    await writeFileIn(dir, 'eng/draft.md', page('pg_9', 'Draft', 'half a sentence'));
    engine.scheduleCommit();

    await peerPush(peer, 'waits for the quiet', 'docs: peer edit');
    expect(engine.startAutoPull()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(await readFileIn(dir, 'eng/index.md')).not.toContain('waits for the quiet');
    expect(await gitLines(dir, 'log', '--format=%s', 'HEAD')).not.toContain(
      'docs: save local edits before pull',
    );

    // The writer stops. The next round pulls, with their edit already one commit of its own.
    await engine.flushPendingCommit();
    await waitFor(
      async () => (await readFileIn(dir, 'eng/index.md')).includes('waits for the quiet'),
      'the pull once the writing stopped',
    );
    engine.stop();
    await engine.whenIdle();
  });

  it('logs a failing pull instead of throwing', async () => {
    const dir = await tempDir();
    const missing = join(await tempDir(), 'missing-remote.git');
    const { logger, entries } = captureLogger();
    const engine = makeEngine({
      contentDir: dir,
      remote: missing,
      autopullMs: 20,
      logger,
    });
    await engine.init();

    engine.startAutoPull();
    await waitFor(
      () => entries.some((entry) => entry.level === 'warn' && entry.message === 'auto pull failed'),
      'the auto pull failure log',
    );
    engine.stop();
    await engine.whenIdle();
  });

  it('does not start without a remote or with the interval off', async () => {
    const dir = await tempDir();
    const withoutRemote = makeEngine({ contentDir: dir, autopullMs: 50 });
    await withoutRemote.init();
    expect(withoutRemote.startAutoPull()).toBe(false);

    const other = await tempDir();
    const remote = await bareRemote();
    const disabled = makeEngine({ contentDir: other, remote, autopullMs: 0 });
    await disabled.init();
    expect(disabled.startAutoPull()).toBe(false);
  });
});
