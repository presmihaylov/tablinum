import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentStore as CoreContentStore, silentLogger } from '@tablinum/core';
import {
  AssetResponseSchema,
  AuthResponseSchema,
  PageResponseSchema,
  SpaceResponseSchema,
  assetDirRelPath,
  loadConfig,
} from '@tablinum/shared';
import type { ServerDeps } from '../src/deps.js';
import { buildRealDeps, type RealDeps } from '../src/server.js';
import { Wiring, startContentWatcher, type ContentWatcher } from '../src/wiring.js';
import {
  bodyOf,
  makeHarness,
  seed,
  TEST_SESSION_SECRET,
  TEST_TOKEN,
  type Harness,
} from './support/harness.js';
import { multipart } from './support/multipart.js';
import { waitFor } from './support/wait.js';

/**
 * A delete leaves nothing behind: no attachment nobody can reach any more, and no exclude line
 * for a space or a page that is gone.
 */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const ADMIN = { email: 'ada@example.com', name: 'Ada Lovelace', password: 'stack-of-pancakes' };

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

function assetDir(pageId: string): string {
  return join(harness.contentDir, assetDirRelPath(pageId));
}

async function upload(pageId: string, filename: string, headers: Record<string, string>) {
  const built = multipart({ fields: { pageId }, filename, contentType: 'image/png', data: PNG });
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/assets',
    headers: { ...headers, ...built.headers },
    payload: built.payload,
  });
  expect(response.statusCode).toBe(200);
  return response;
}

async function createPage(path: string, title: string, markdown: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: harness.authHeaders(),
    payload: { path, title, markdown },
  });
  expect(response.statusCode).toBe(201);
  return bodyOf(response, PageResponseSchema).page.id;
}

async function deletePage(id: string, recursive = false): Promise<void> {
  const response = await harness.app.inject({
    method: 'DELETE',
    url: `/api/v1/pages/${id}${recursive ? '?recursive=true' : ''}`,
    headers: harness.authHeaders(),
  });
  expect(response.statusCode).toBe(200);
}

/** Claim the server with the first admin and return the cookie that account signs in with. */
async function claim(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    payload: ADMIN,
  });
  expect(bodyOf(response, AuthResponseSchema).user?.role).toBe('admin');
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

/** A private space with one page in it, and the cookie of the person who owns it. */
async function privateSpace(cookie: string): Promise<string> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/spaces',
    headers: { cookie },
    payload: { slug: 'notes', name: 'Notes', private: true },
  });
  expect(bodyOf(created, SpaceResponseSchema).space.owner).toBeDefined();

  const page = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: { cookie },
    payload: { path: 'notes/salary', title: 'Salary', markdown: 'The review is on Tuesday.' },
  });
  return bodyOf(page, PageResponseSchema).page.id;
}

describe('a page delete', () => {
  beforeEach(async () => {
    await seed(harness);
  });

  it('takes the attachments of the page with it', async () => {
    const pageId = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    await upload(pageId, 'plan.png', harness.authHeaders());
    expect(existsSync(assetDir(pageId))).toBe(true);

    await deletePage(pageId);

    expect(existsSync(assetDir(pageId))).toBe(false);
  });

  it('takes the attachments of every page in the subtree', async () => {
    const parent = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    const child = await createPage('eng/plan/detail', 'Detail', 'Nothing yet either.');
    await upload(parent, 'parent.png', harness.authHeaders());
    await upload(child, 'child.png', harness.authHeaders());

    await deletePage(parent, true);

    expect(existsSync(assetDir(parent))).toBe(false);
    expect(existsSync(assetDir(child))).toBe(false);
  });

  it('keeps an attachment a surviving page still shows', async () => {
    const source = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    const asset = bodyOf(await upload(source, 'plan.png', harness.authHeaders()), AssetResponseSchema);
    // What "Duplicate page" writes: the copy carries the original's attachment urls.
    await createPage('eng/plan-copy', 'Plan copy', `![plan](${asset.url})`);

    await deletePage(source);

    expect(existsSync(assetDir(source))).toBe(true);
  });

  it('leaves nothing for git to commit', async () => {
    const pageId = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    await upload(pageId, 'plan.png', harness.authHeaders());
    await harness.git.flush();
    // The upload is committed, so the attachment is tracked. Only its removal can untrack it.
    expect(await harness.git.lsFiles()).toContain(`${assetDirRelPath(pageId)}/plan.png`);

    await deletePage(pageId);
    await harness.git.flush();

    expect(await harness.git.lsFiles()).not.toContain(`${assetDirRelPath(pageId)}/plan.png`);
    expect((await harness.git.status()).dirtyFiles).toEqual([]);
  });

  it('keeps the exclude line when the attachment directory cannot be read', async () => {
    const owner = await claim();
    const pageId = await privateSpace(owner);
    await upload(pageId, 'salary.png', { cookie: owner });
    expect(harness.git.excluded).toContain(assetDirRelPath(pageId));

    // A file where the directory was: readdir answers ENOTDIR, which stands in for every errno
    // that is not ENOENT. The attachments are still in the working tree, so the line must stay.
    await rm(assetDir(pageId), { recursive: true, force: true });
    await writeFile(assetDir(pageId), 'not a directory', 'utf8');

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${pageId}`,
      headers: { cookie: owner },
    });
    expect(deleted.statusCode).toBe(200);

    expect(harness.git.excluded).toContain(assetDirRelPath(pageId));
    expect(existsSync(assetDir(pageId))).toBe(true);
  });

  it('drops the exclude line that hid the attachments of a private page', async () => {
    const owner = await claim();
    const pageId = await privateSpace(owner);
    await upload(pageId, 'salary.png', { cookie: owner });
    expect(harness.git.excluded).toContain(assetDirRelPath(pageId));

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${pageId}`,
      headers: { cookie: owner },
    });
    expect(deleted.statusCode).toBe(200);

    expect(harness.git.excluded).not.toContain(assetDirRelPath(pageId));
    expect(existsSync(assetDir(pageId))).toBe(false);
    // The space itself is still there, so its own line stays.
    expect(harness.git.excluded).toContain('notes');
  });
});

describe('what goes away on disk', () => {
  let watcher: ContentWatcher | null = null;

  beforeEach(async () => {
    await seed(harness);
  });

  afterEach(async () => {
    await watcher?.close();
    watcher = null;
  });

  /**
   * Started once the space is on disk, not before: chokidar reports nothing at all about a
   * directory that appears and disappears inside its own settle window.
   */
  async function startWatcher(): Promise<ContentWatcher> {
    const deps: ServerDeps = { ...harness.deps, echoSuppressMs: 5000 };
    const started = startContentWatcher(deps, new Wiring(deps, harness.app.log), harness.app.log);
    await started.whenReady();
    watcher = started;
    return started;
  }

  it('loses its exclude line, so a later space with the same slug reaches git', async () => {
    const owner = await claim();
    await privateSpace(owner);
    expect(harness.git.excluded).toContain('notes');
    await startWatcher();

    await rm(join(harness.contentDir, 'notes'), { recursive: true, force: true });

    await waitFor(
      () => !harness.git.excluded.includes('notes'),
      'the exclude line of the removed space to go',
    );
  });

  it('keeps the line of a space that is merely edited', async () => {
    const owner = await claim();
    await privateSpace(owner);
    const started = await startWatcher();

    await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/spaces/notes',
      headers: { cookie: owner },
      payload: { name: 'Private notes' },
    });
    await started.drain();

    expect(harness.git.excluded).toContain('notes');
  });

  /**
   * A move outside the API is an unlink and an add of the same id. The page comes back, so its
   * attachments must not be collected in between.
   */
  it('keeps the attachments of a page a move re-created', async () => {
    const pageId = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    await upload(pageId, 'plan.png', harness.authHeaders());
    const started = await startWatcher();

    await rename(join(harness.contentDir, 'eng/plan.md'), join(harness.contentDir, 'eng/roadmap.md'));

    await waitFor(
      async () => (await harness.store.getPageByPath('eng/roadmap')) !== null,
      'the moved page to be picked up',
    );
    await started.drain();

    expect(existsSync(assetDir(pageId))).toBe(true);
  });
});

/**
 * The suite drives FsContentStore, so nothing else exercises the adapter that turns the core
 * store's NOT_FOUND into the null the cleanup reads. Without it every cleanup would end in the
 * try/catch in Wiring and no attachment would ever be collected.
 */
describe('the real content store behind the server', () => {
  const MISSING = 'pg_01J0000000000000000000000Z';
  const OTHER = 'pg_01J0000000000000000000000Y';

  /** The whole real stack over a throwaway directory, closed again whatever the body did. */
  async function withRealDeps(
    body: (real: RealDeps, contentDir: string) => Promise<void>,
  ): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'tablinum-adapter-'));
    const config = loadConfig({
      TABLINUM_CONTENT_DIR: join(root, 'content'),
      TABLINUM_SESSION_SECRET: TEST_SESSION_SECRET,
      TABLINUM_AUTOPULL_MS: '0',
    });
    const real = buildRealDeps(config);
    try {
      await real.deps.store.init();
      real.accounts.init();
      await body(real, config.contentDir);
    } finally {
      real.search.close();
      real.accounts.close();
      await rm(root, { recursive: true, force: true });
    }
  }

  /** A workspace and somebody to write a comment, which is all a thread needs. */
  function seedAccounts(real: RealDeps, contentDir: string): { workspace: string; author: string } {
    const workspace = real.accounts.createWorkspace({ name: 'Docs', dir: contentDir });
    const author = real.accounts.createUser({
      email: 'ines@example.com',
      name: 'Ines Roy',
      password: ADMIN.password,
    });
    return { workspace: workspace.id, author: author.id };
  }

  /** An attachment on disk, written the way an upload leaves it. */
  async function writeAsset(contentDir: string, pageId: string): Promise<string> {
    const file = join(contentDir, assetDirRelPath(pageId), 'plan.png');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, PNG);
    return file;
  }

  it('answers null for a page that is gone, where the core store throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tablinum-adapter-'));
    const config = loadConfig({
      TABLINUM_CONTENT_DIR: join(root, 'content'),
      TABLINUM_SESSION_SECRET: TEST_SESSION_SECRET,
      TABLINUM_AUTOPULL_MS: '0',
    });
    const real = buildRealDeps(config);
    try {
      await real.deps.store.init();

      const core = new CoreContentStore({ contentDir: config.contentDir, logger: silentLogger });
      await core.init();
      await expect(core.getPageById(MISSING)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(await real.deps.store.getPageById(MISSING)).toBeNull();
    } finally {
      real.search.close();
      real.accounts.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * The store collects attachments inside deletePage(), before any of the clean-up above runs,
   * so the comment source has to reach the store itself. Only the real stack proves that: the
   * double the rest of the suite drives has a delete path of its own.
   */
  it('lets a comment keep an attachment a page delete would take', async () => {
    await withRealDeps(async (real, contentDir) => {
      const { workspace, author } = seedAccounts(real, contentDir);
      const plan = await real.deps.store.createPage({ path: 'docs/plan', title: 'Plan' });
      const notes = await real.deps.store.createPage({ path: 'docs/notes', title: 'Notes' });
      const asset = await writeAsset(contentDir, plan.id);
      real.accounts.createThread(workspace, {
        pageId: notes.id,
        author,
        body: `Still true? ![plan](/${assetDirRelPath(plan.id)}/plan.png)`,
      });

      await real.deps.store.deletePage(plan.id, false);

      expect(existsSync(asset)).toBe(true);
    });
  });

  it('still takes one no page and no comment points at', async () => {
    await withRealDeps(async (real, contentDir) => {
      const { workspace, author } = seedAccounts(real, contentDir);
      const plan = await real.deps.store.createPage({ path: 'docs/plan', title: 'Plan' });
      const notes = await real.deps.store.createPage({ path: 'docs/notes', title: 'Notes' });
      const asset = await writeAsset(contentDir, plan.id);
      // A comment that names somebody else's attachment must not save this one.
      real.accounts.createThread(workspace, {
        pageId: notes.id,
        author,
        body: `Look: ![x](/${assetDirRelPath(OTHER)}/x.png)`,
      });

      await real.deps.store.deletePage(plan.id, false);

      expect(existsSync(asset)).toBe(false);
    });
  });

  it('keeps everything a space delete would take when the account database will not answer', async () => {
    await withRealDeps(async (real, contentDir) => {
      await real.deps.store.createSpace({ slug: 'eng', name: 'Engineering' });
      const plan = await real.deps.store.createPage({ path: 'eng/plan', title: 'Plan' });
      const asset = await writeAsset(contentDir, plan.id);
      real.accounts.commentBodiesContaining = (): string[] => {
        throw new Error('the account database is locked');
      };

      await real.deps.store.deleteSpace('eng', true);

      expect(existsSync(join(contentDir, 'eng/_space.yml'))).toBe(false);
      expect(existsSync(asset)).toBe(true);
    });
  });
});
