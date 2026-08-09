import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError, loadConfig } from '@tablinum/shared';
import { GitEngine } from '../src/engine.js';
import { silentLogger } from '../src/logger.js';
import {
  bareRemote,
  cleanupTempDirs,
  commitCount,
  commitSubjects,
  disposeEngines,
  exists,
  git,
  gitLines,
  makeEngine,
  page,
  readFileIn,
  tempDir,
  writeFileIn,
} from './helpers.js';

afterEach(async () => {
  disposeEngines();
  await cleanupTempDirs();
});

describe('GitEngine.init', () => {
  it('creates a repo on the configured branch with a local identity', async () => {
    const dir = await tempDir();
    const engine = makeEngine({
      contentDir: dir,
      branch: 'trunk',
      authorName: 'tablinum',
      authorEmail: 'tablinum@localhost',
    });

    const result = await engine.init();

    expect(result.created).toBe(true);
    expect(result.cloned).toBe(false);
    expect(result.branch).toBe('trunk');
    expect(await exists(join(dir, '.git'))).toBe(true);
    expect((await git(dir, 'config', '--local', 'user.name')).trim()).toBe('tablinum');
    expect((await git(dir, 'config', '--local', 'user.email')).trim()).toBe('tablinum@localhost');
    expect((await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('trunk');
  });

  it('creates the content directory when it does not exist', async () => {
    const parent = await tempDir();
    const dir = join(parent, 'nested', 'content');
    const engine = makeEngine({ contentDir: dir });

    await engine.init();

    expect(await exists(join(dir, '.git'))).toBe(true);
  });

  it('writes .gitattributes marking markdown as LF text', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });

    await engine.init();

    const attributes = await readFileIn(dir, '.gitattributes');
    expect(attributes).toContain('*.md text eol=lf');
    expect(attributes).toContain('*.yml text eol=lf');
  });

  it('makes an initial commit that contains the existing files', async () => {
    const dir = await tempDir();
    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'Home'));
    await writeFileIn(dir, 'eng/deploy.md', page('pg_2', 'Deploy', 'Steps'));
    const engine = makeEngine({ contentDir: dir });

    await engine.init();

    expect(await commitCount(dir)).toBe(1);
    const tracked = await gitLines(dir, 'ls-tree', '-r', '--name-only', 'HEAD');
    expect(tracked).toContain('eng/index.md');
    expect(tracked).toContain('eng/deploy.md');
    expect(tracked).toContain('.gitattributes');
  });

  it('is idempotent: a second init changes nothing', async () => {
    const dir = await tempDir();
    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'Home'));
    const engine = makeEngine({ contentDir: dir });

    const first = await engine.init();
    const headAfterFirst = (await git(dir, 'rev-parse', 'HEAD')).trim();

    const second = await engine.init();
    const third = await engine.init();

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect((await git(dir, 'rev-parse', 'HEAD')).trim()).toBe(headAfterFirst);
    expect(await commitCount(dir)).toBe(1);
    expect((await engine.status()).dirtyFiles).toEqual([]);
  });

  it('adopts an existing repo without rewriting its history', async () => {
    const dir = await tempDir();
    await git(dir, 'init', '--initial-branch=main');
    await git(dir, 'config', 'user.name', 'Someone');
    await git(dir, 'config', 'user.email', 'someone@example.test');
    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'Home'));
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-m', 'initial by hand');

    const engine = makeEngine({ contentDir: dir });
    const result = await engine.init();

    expect(result.created).toBe(false);
    const subjects = await commitSubjects(dir);
    expect(subjects).toContain('initial by hand');
    // .gitattributes was missing, so init added it in its own commit and left the tree clean.
    expect(subjects[0]).toBe('chore: normalize page line endings');
    expect((await engine.status()).dirtyFiles).toEqual([]);
  });

  it('does not sweep unrelated uncommitted work into the .gitattributes commit', async () => {
    const dir = await tempDir();
    await git(dir, 'init', '--initial-branch=main');
    await git(dir, 'config', 'user.name', 'Someone');
    await git(dir, 'config', 'user.email', 'someone@example.test');
    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Engineering', 'Home'));
    await git(dir, 'add', '-A');
    await git(dir, 'commit', '-m', 'initial by hand');
    await writeFileIn(dir, 'eng/draft.md', page('pg_2', 'Draft', 'Work in progress'));

    const engine = makeEngine({ contentDir: dir });
    await engine.init();

    const tracked = await gitLines(dir, 'ls-tree', '-r', '--name-only', 'HEAD');
    expect(tracked).not.toContain('eng/draft.md');
    expect((await engine.status()).dirtyFiles).toEqual(['eng/draft.md']);
  });

  it('registers the configured remote and updates a stale url', async () => {
    const dir = await tempDir();
    const remote = await bareRemote();
    const engine = makeEngine({ contentDir: dir, remote });

    await engine.init();
    expect((await git(dir, 'remote', 'get-url', 'origin')).trim()).toBe(remote);

    const moved = await bareRemote();
    const relocated = makeEngine({ contentDir: dir, remote: moved });
    await relocated.init();
    expect((await git(dir, 'remote', 'get-url', 'origin')).trim()).toBe(moved);
  });

  it('clones the remote when the content directory is empty', async () => {
    const remote = await bareRemote();
    const author = await tempDir('tablinum-author-');
    await git(author, 'clone', remote, '.');
    await git(author, 'config', 'user.name', 'Test Author');
    await git(author, 'config', 'user.email', 'author@example.test');
    await writeFileIn(author, 'eng/index.md', page('pg_1', 'Engineering', 'From the remote'));
    await git(author, 'add', '-A');
    await git(author, 'commit', '-m', 'seed the remote');
    await git(author, 'push', 'origin', 'HEAD:main');

    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, remote, branch: 'main' });
    const result = await engine.init();

    expect(result.cloned).toBe(true);
    expect(result.created).toBe(false);
    expect(result.branch).toBe('main');
    expect(await readFileIn(dir, 'eng/index.md')).toContain('From the remote');
  });

  it('clones an empty remote and still ends up with a usable branch', async () => {
    const remote = await bareRemote();
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir, remote, branch: 'main' });

    const result = await engine.init();

    expect(result.branch).toBe('main');
    expect(await exists(join(dir, '.gitattributes'))).toBe(true);
    expect(await commitCount(dir)).toBe(1);
    expect((await engine.status()).dirtyFiles).toEqual([]);
    expect(await engine.push()).toEqual({ pushed: true, reason: 'pushed' });
    expect(await gitLines(remote, 'rev-parse', '--abbrev-ref', 'HEAD')).toEqual(['main']);
  });

  it('does not clone into a directory that already has content', async () => {
    const remote = await bareRemote();
    const dir = await tempDir();
    await writeFileIn(dir, 'eng/index.md', page('pg_1', 'Local', 'Local only'));

    const engine = makeEngine({ contentDir: dir, remote });
    const result = await engine.init();

    expect(result.cloned).toBe(false);
    expect(result.created).toBe(true);
    expect(await readFileIn(dir, 'eng/index.md')).toContain('Local only');
  });

  it('falls back to a local repo when the remote cannot be reached', async () => {
    const dir = await tempDir();
    const missing = join(await tempDir(), 'no-such-remote.git');
    const engine = makeEngine({ contentDir: dir, remote: missing });

    const result = await engine.init();

    expect(result.cloned).toBe(false);
    expect(result.created).toBe(true);
    expect((await git(dir, 'remote', 'get-url', 'origin')).trim()).toBe(missing);
  });

  it('rejects a relative content directory and a bad branch name', () => {
    expect(() => new GitEngine({ contentDir: 'relative/path' })).toThrow(AppError);
    expect(() => new GitEngine({ contentDir: '/tmp/x', branch: 'bad branch' })).toThrow(AppError);
    expect(() => new GitEngine({ contentDir: '/tmp/x', branch: '--upload-pack=evil' })).toThrow(
      AppError,
    );
  });

  it('reports isRepo before and after init', async () => {
    const dir = await tempDir();
    const engine = makeEngine({ contentDir: dir });

    expect(await engine.isRepo()).toBe(false);
    await engine.init();
    expect(await engine.isRepo()).toBe(true);
  });
});

describe('GitEngine.fromConfig', () => {
  it('takes every git setting from the resolved config', async () => {
    const dir = await tempDir();
    const config = loadConfig({
      TABLINUM_CONTENT_DIR: dir,
      TABLINUM_GIT_BRANCH: 'trunk',
      TABLINUM_GIT_AUTHOR_NAME: 'docs bot',
      TABLINUM_GIT_AUTHOR_EMAIL: 'bot@example.test',
      TABLINUM_AUTOCOMMIT_MS: '250',
      TABLINUM_AUTOPULL_MS: '0',
    });

    const engine = GitEngine.fromConfig(config, silentLogger);

    expect(engine.contentDir).toBe(dir);
    expect(engine.branch).toBe('trunk');
    expect(engine.authorName).toBe('docs bot');
    expect(engine.authorEmail).toBe('bot@example.test');
    expect(engine.autocommitMs).toBe(250);
    expect(engine.autopullMs).toBe(0);
    expect(engine.remote).toBeNull();

    await engine.init();
    expect((await git(dir, 'config', '--local', 'user.email')).trim()).toBe('bot@example.test');
    engine.dispose();
  });
});
