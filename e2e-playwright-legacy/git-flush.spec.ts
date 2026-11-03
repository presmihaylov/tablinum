import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { REPO_ROOT } from './env';
import { ApiClient } from './helpers/api';
import { ContentRepo } from './helpers/content';

/**
 * A page is written to disk the moment it is saved, and git only records what somebody has
 * finished. This spec drives the two timers that decide when "finished" is: the quiet period a
 * page must have, and the cap that stops a page nobody puts down from never reaching git.
 *
 * The suite server runs both timers far too short to observe, so this spec brings its own.
 */
const QUIET_MS = 4000;
const MAX_HOLD_MS = 9000;

/** Gap between the writes of a burst. Well under the quiet period, so each one resets it. */
const KEYSTROKE_MS = 800;

const TOKEN = 'e2e-flush-token';

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => fail(new Error('could not read a free port')));
        return;
      }
      const { port } = address;
      probe.close(() => done(port));
    });
  });
}

interface Server {
  url: string;
  contentDir: string;
  stop: () => Promise<void>;
}

/** A server of this spec's own, over an empty content directory, driven by an API token. */
async function startServer(): Promise<Server> {
  const port = await freePort();
  const runDir = await mkdtemp(join(tmpdir(), `tablinum-e2e-flush-${String(port)}-`));
  const contentDir = join(runDir, 'content');
  await mkdir(contentDir, { recursive: true });
  // The runner's own TABLINUM_* variables would point this server at the suite's content.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('TABLINUM_')),
  );

  const child: ChildProcess = spawn(process.execPath, [join(REPO_ROOT, 'apps/server/dist/server.js')], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    env: {
      ...inherited,
      TABLINUM_CONTENT_DIR: contentDir,
      TABLINUM_PORT: String(port),
      TABLINUM_SESSION_SECRET: `e2e-flush-secret-${String(port)}-0123456789`,
      TABLINUM_API_TOKENS: TOKEN,
      TABLINUM_GIT_BRANCH: 'main',
      TABLINUM_GIT_AUTHOR_NAME: 'tablinum e2e',
      TABLINUM_GIT_AUTHOR_EMAIL: 'e2e@localhost',
      TABLINUM_AUTOCOMMIT_MS: String(QUIET_MS),
      TABLINUM_COMMIT_MAX_HOLD_MS: String(MAX_HOLD_MS),
      TABLINUM_AUTOPULL_MS: '0',
      TABLINUM_AUTOPUSH_MS: '0',
    },
  });

  const url = `http://127.0.0.1:${String(port)}`;
  const stop = async (): Promise<void> => {
    // Wait for the exit: a git subprocess of this server can still write while it dies.
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    child.kill('SIGKILL');
    await exited;
    await rm(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  await expect
    .poll(
      async () => {
        const response = await fetch(`${url}/api/v1/health`).catch(() => null);
        return response?.status ?? 0;
      },
      { timeout: 60_000, message: 'the flush server never became healthy' },
    )
    .toBe(200);

  return { url, contentDir, stop };
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

test.describe('git flushes once the writing stops', () => {
  test('a burst of edits waits for the quiet, then lands as one commit', async ({ playwright }) => {
    test.setTimeout(120_000);

    const server = await startServer();
    const request = await playwright.request.newContext({
      baseURL: server.url,
      extraHTTPHeaders: { authorization: `Bearer ${TOKEN}` },
    });
    const api = new ApiClient(request, server.contentDir);
    const content = new ContentRepo(server.contentDir);

    try {
      const space = await api.createUniqueSpace('flush');
      const page = await api.createPage({
        path: `${space.slug}/notes`,
        title: 'Notes',
        markdown: 'draft 0\n',
      });
      await expect
        .poll(() => content.dirtyFiles(), { timeout: 30_000, message: 'the seed never committed' })
        .toEqual([]);

      const before = (await content.commitSubjects(50)).length;
      const file = await content.pageFile(page.path);
      expect(file).not.toBeNull();

      // Four edits, each inside the quiet period. Together they run longer than that period,
      // so a debounce that did not reset on every write would already have committed.
      for (let i = 1; i <= 4; i += 1) {
        await api.updatePage(page.id, { markdown: `draft ${String(i)}\n` });
        await sleep(KEYSTROKE_MS);
      }

      // The text is on disk the whole time. Only git is waiting.
      expect(await content.read(file ?? '')).toContain('draft 4');
      expect(await content.dirtyFiles()).toEqual([file]);
      expect((await content.commitSubjects(50)).length).toBe(before);

      await expect
        .poll(() => content.dirtyFiles(), {
          timeout: 30_000,
          message: 'the edits never reached git after the writing stopped',
        })
        .toEqual([]);

      // One commit for the whole burst, not one for each write. Its message is the summary the
      // engine derives, because no single write of the burst describes what the commit holds.
      const after = await content.commitSubjects(50);
      expect(after.length).toBe(before + 1);
      expect(after[0]).toBe('docs: update 1 page(s)');
    } finally {
      await request.dispose();
      await server.stop();
    }
  });

  test('a page nobody stops writing still reaches git at the cap', async ({ playwright }) => {
    test.setTimeout(120_000);

    const server = await startServer();
    const request = await playwright.request.newContext({
      baseURL: server.url,
      extraHTTPHeaders: { authorization: `Bearer ${TOKEN}` },
    });
    const api = new ApiClient(request, server.contentDir);
    const content = new ContentRepo(server.contentDir);

    try {
      const space = await api.createUniqueSpace('cap');
      const page = await api.createPage({
        path: `${space.slug}/notes`,
        title: 'Notes',
        markdown: 'line 0\n',
      });
      await expect
        .poll(() => content.dirtyFiles(), { timeout: 30_000, message: 'the seed never committed' })
        .toEqual([]);

      const before = (await content.commitSubjects(50)).length;

      // Write without a pause long enough to count as one, for longer than the cap. The quiet
      // period alone would never elapse, so the cap is the only thing that can commit this.
      const deadline = Date.now() + MAX_HOLD_MS + QUIET_MS;
      let line = 0;
      while (Date.now() < deadline) {
        line += 1;
        await api.updatePage(page.id, { markdown: `line ${String(line)}\n` });
        await sleep(KEYSTROKE_MS);
      }

      const after = await content.commitSubjects(50);
      expect(after.length).toBeGreaterThan(before);
      expect(after[0]).toBe('docs: update 1 page(s)');
      expect(await content.pageFileText(page.path)).toContain(`line ${String(line)}`);
    } finally {
      await request.dispose();
      await server.stop();
    }
  });
});
