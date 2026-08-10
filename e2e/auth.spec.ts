import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ADMIN, expect, test } from './fixtures';
import { DEFAULT_PAGE_PATH, REPO_ROOT } from './env';

const LOGIN_LEDE = 'Sign in to edit your docs.';
const CLAIM_LEDE = 'Nobody has claimed this server yet. Create your account to start.';
const WRONG_PASSWORD_ERROR = 'That email and password did not match';
const SESSION_COOKIE = 'tablinum_session';

/** Sign in through the login card and wait for the shell it opens. */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A port nothing holds right now, for the second server the first-run test claims. */
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

interface FreshServer {
  url: string;
  stop: () => Promise<void>;
}

/**
 * A second server over its own empty content directory, so the first-run claim can be driven
 * through the UI. The suite's own server was claimed by the setup project and cannot go back.
 */
async function startUnclaimedServer(): Promise<FreshServer> {
  const port = await freePort();
  // The accounts database is written beside the content directory, so the whole run gets its
  // own root: an accounts file left in the temp directory would claim the next run's server.
  const runDir = await mkdtemp(join(tmpdir(), `tablinum-e2e-firstrun-${String(port)}-`));
  const contentDir = join(runDir, 'content');
  await mkdir(contentDir, { recursive: true });
  // The runner's own TABLINUM_* variables must not reach this server, or it would answer over
  // the suite's content directory.
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
      TABLINUM_SESSION_SECRET: `e2e-firstrun-secret-${String(port)}-0123456789`,
      TABLINUM_GIT_BRANCH: 'main',
      TABLINUM_GIT_AUTHOR_NAME: 'tablinum e2e',
      TABLINUM_GIT_AUTHOR_EMAIL: 'e2e@localhost',
      TABLINUM_AUTOCOMMIT_MS: '200',
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
    .poll(async () => {
      const response = await fetch(`${url}/api/v1/health`).catch(() => null);
      return response?.status ?? 0;
    }, { timeout: 60_000, message: 'the unclaimed server never became healthy' })
    .toBe(200);

  return { url, stop };
}

test.describe('authentication and session', () => {
  test('the first visitor claims an unclaimed server', async ({ browser }) => {
    // Spawning a second server, claiming it and loading the shell twice needs more than the default.
    test.setTimeout(120_000);

    const server = await startUnclaimedServer();
    const context = await browser.newContext({ baseURL: server.url });
    const page = await context.newPage();

    try {
      await page.goto('/');

      await expect(page.getByText(CLAIM_LEDE)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
      // Nobody signs in to a server that has no account yet.
      await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);

      await page.getByLabel('Email').fill('first-owner@example.com');
      await page.getByLabel('Your name').fill('First Owner');
      await page.getByLabel('Password').fill('first-owner-1234');
      await page.getByRole('button', { name: 'Create account' }).click();

      // The claim continues into naming the workspace the server started with. Naming it is a
      // workspace journey; this one takes the skip and goes straight to the shell.
      await expect(page.getByText('Name your first workspace. You can add more at any time.')).toBeVisible();
      await page.getByRole('button', { name: 'Skip for now' }).click();

      await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
      await expect(page.getByRole('treeitem', { name: 'Welcome' })).toBeVisible();

      await page.getByRole('button', { name: 'Your account' }).click();
      await expect(page.getByText('first-owner@example.com')).toBeVisible();

      // The server is claimed now, so a second visitor would be asked to sign in instead.
      const state = await context.request.get('/api/v1/auth/state');
      expect(await state.json()).toMatchObject({ setupRequired: false });
    } finally {
      await context.close();
      await server.stop();
    }
  });

  test('the right password signs you in', async ({ signedOutPage }) => {
    await signedOutPage.goto('/');
    await expect(signedOutPage.getByText(LOGIN_LEDE)).toBeVisible();

    await signIn(signedOutPage, ADMIN.email, ADMIN.password);

    await expect(signedOutPage).toHaveURL(new RegExp(`/p/${DEFAULT_PAGE_PATH}$`));
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toBeVisible();
    await expect(signedOutPage.getByRole('button', { name: 'Your account' })).toBeVisible();

    const cookie = (await signedOutPage.context().cookies()).find((each) => each.name === SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
  });

  test('a wrong password shows an error and does not sign you in', async ({ signedOutPage }) => {
    await signedOutPage.goto('/');

    await signIn(signedOutPage, ADMIN.email, 'not-the-right-password');

    await expect(signedOutPage.getByText(WRONG_PASSWORD_ERROR)).toBeVisible();
    await expect(signedOutPage.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);

    // A failed attempt hands out no cookie, so a reload stays on the login screen.
    const cookies = await signedOutPage.context().cookies();
    expect(cookies.map((each) => each.name)).not.toContain(SESSION_COOKIE);
    await signedOutPage.reload();
    await expect(signedOutPage.getByText(LOGIN_LEDE)).toBeVisible();
  });

  test('the session survives a full page reload', async ({ signedOutPage }) => {
    await signedOutPage.goto('/');
    await signIn(signedOutPage, ADMIN.email, ADMIN.password);
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toBeVisible();

    // The regression: the session cookie used to be dropped, so the reload showed the login card.
    await signedOutPage.reload();

    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toBeVisible();
    await expect(signedOutPage.getByRole('treeitem', { name: 'Welcome' })).toBeVisible();
    await expect(signedOutPage.getByText(LOGIN_LEDE)).toHaveCount(0);

    // A deep link opened from cold in the same browser is signed in too.
    await signedOutPage.goto(`/p/${DEFAULT_PAGE_PATH}`);
    await expect(signedOutPage.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(signedOutPage.getByRole('button', { name: 'Your account' })).toBeVisible();
  });

  test('sign out returns to the login screen and locks the shell', async ({ signedOutPage }) => {
    // Signing out destroys that one session server side, so it must be a session of its own:
    // the suite's saved admin session has to stay valid for every other spec.
    await signedOutPage.goto('/');
    await signIn(signedOutPage, ADMIN.email, ADMIN.password);
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toBeVisible();

    await signedOutPage.getByRole('button', { name: 'Your account' }).click();
    await signedOutPage.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(signedOutPage.getByText(LOGIN_LEDE)).toBeVisible();
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);

    // The shell is gone for good: the cookie no longer names a session.
    await signedOutPage.goto(`/p/${DEFAULT_PAGE_PATH}`);
    await expect(signedOutPage.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
  });

  test('a protected deep link sends an anonymous visitor to the login screen', async ({
    signedOutPage,
    signedOutRequest,
  }) => {
    await signedOutPage.goto(`/p/${DEFAULT_PAGE_PATH}`);

    await expect(signedOutPage.getByText(LOGIN_LEDE)).toBeVisible();
    await expect(signedOutPage.getByLabel('Password')).toBeVisible();
    await expect(signedOutPage.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
    await expect(signedOutPage.getByRole('treeitem', { name: 'Welcome' })).toHaveCount(0);

    // The page behind that link is protected at the API too, not only in the shell.
    const response = await signedOutRequest.get('/api/v1/pages', { params: { path: DEFAULT_PAGE_PATH } });
    expect(response.status()).toBe(401);
  });
});
