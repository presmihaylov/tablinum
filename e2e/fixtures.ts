import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, test as base } from 'vitest';
import { ADMIN, API_TOKEN, BASE_URL, CONTENT_DIR, RESULTS_DIR, STORAGE_STATE } from './env';
import { expect, Http, newSession, type Browser, type BrowserContext, type Page, type StorageState } from './harness';
import { ApiClient } from './helpers/api';
import { ContentRepo } from './helpers/content';

/** No cookies: a caller the server has never seen. */
const EMPTY_STATE: StorageState = { cookies: [] };

const adminState = (): StorageState => JSON.parse(readFileSync(STORAGE_STATE, 'utf8')) as StorageState;

export interface TablinumFixtures {
  /** The signed-in admin's page, in a Chromium session of its own. */
  page: Page;
  /** The page's session: its cookies and permissions. */
  context: BrowserContext;
  /** Opens more isolated sessions; each closes when the test ends. */
  browser: Browser;
  /** REST client on the signed-in admin session. */
  request: Http;
  /** Opens more REST clients, for callers other than the admin. */
  http: { newContext(options?: { baseURL?: string; extraHTTPHeaders?: Record<string, string>; storageState?: StorageState }): Promise<Http> };
  /** REST client on the signed-in admin session. Seed content with it. */
  api: ApiClient;
  /** The content directory and its git repo, read straight from disk. */
  content: ContentRepo;
  /** A second page with no session at all: it lands on the login screen. */
  signedOutPage: Page;
  /** REST client with no session, for asserting what an anonymous caller may do. */
  signedOutRequest: Http;
  /** REST client on the operator token, for calls made outside any browser session. */
  operatorApi: ApiClient;
  /**
   * Automatic. One server and one content directory back the whole run, so a space or a page
   * a test leaves behind is still there for the next one, and the sidebar and the home route
   * both read the whole tree. This puts the content tree of the default workspace back to the
   * state a fresh server starts in, before every test.
   *
   * That tree is all it owns: one space, `docs`, holding one page, the welcome page. Extra
   * workspaces, favorites, accounts and agents live outside it, and a spec that makes one
   * still removes it itself.
   *
   * Before the test and not after, so that a test body which runs out its own timeout cannot
   * take the next test down with it: the reset gets the fresh budget of the test that needs
   * the clean tree, and a reset that fails fails on that test.
   */
  cleanContent: void;
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 120);

const extended = base.extend<TablinumFixtures>({
  cleanContent: [
    async ({ api }, use) => {
      await api.reset();
      await use();
    },
    { auto: true },
  ],

  page: async ({ task }, use) => {
    const context = await newSession({ baseURL: BASE_URL, cookies: adminState().cookies });
    try {
      await use(context.page);
      if (task.result?.state === 'fail') {
        await mkdir(RESULTS_DIR, { recursive: true });
        await context.wdio.saveScreenshot(join(RESULTS_DIR, `${slug(task.name)}.png`)).catch(() => undefined);
      }
    } finally {
      await context.close();
    }
  },

  context: async ({ page }, use) => {
    await use(page.context());
  },

  browser: async ({}, use) => {
    const opened: BrowserContext[] = [];
    await use({
      async newContext(options) {
        const context = await newSession({
          baseURL: options?.baseURL ?? BASE_URL,
          cookies: (options?.storageState ?? EMPTY_STATE).cookies,
        });
        opened.push(context);
        return context;
      },
    });
    await Promise.all(opened.map((c) => c.close()));
  },

  request: async ({}, use) => {
    await use(new Http({ baseURL: BASE_URL, cookies: adminState().cookies }));
  },

  http: async ({}, use) => {
    await use({
      newContext(options) {
        return Promise.resolve(
          new Http({
            baseURL: options?.baseURL ?? BASE_URL,
            cookies: (options?.storageState ?? EMPTY_STATE).cookies,
            extraHTTPHeaders: options?.extraHTTPHeaders,
          }),
        );
      },
    });
  },

  api: async ({ request }, use) => {
    await use(new ApiClient(request));
  },

  content: async ({}, use) => {
    await use(new ContentRepo(CONTENT_DIR));
  },

  signedOutPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: EMPTY_STATE });
    await use(context.page);
  },

  signedOutRequest: async ({}, use) => {
    await use(new Http({ baseURL: BASE_URL }));
  },

  operatorApi: async ({}, use) => {
    await use(new ApiClient(new Http({ baseURL: BASE_URL, extraHTTPHeaders: { authorization: `Bearer ${API_TOKEN}` } })));
  },
});

type Context = TablinumFixtures & { task: { name: string } };
type Body = (ctx: Context) => unknown;

// vitest hands its own beforeEach no fixtures, so test.beforeEach hooks run inside each test instead,
// outermost scope first, as the suite's hooks always have.
interface Scope {
  before: Body[];
  after: Body[];
}
const scopes: Scope[] = [{ before: [], after: [] }];

// vitest starts only the fixtures a test destructures, read from the function's source text.
function fixtureNames(fn: Body): string[] {
  const params = /^[^(]*\(\s*\{([^}]*)\}/.exec(fn.toString())?.[1] ?? '';
  return params
    .split(',')
    .map((p) => p.split(/[:=]/)[0]?.trim() ?? '')
    .filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
}

function wrap(fn: Body, chain: Scope[]) {
  const hooks = chain.flatMap((s) => [...s.before, ...s.after]);
  const names = [...new Set([fn, ...hooks].flatMap(fixtureNames))];
  const run = async (ctx: Context) => {
    for (const hook of chain.flatMap((s) => s.before)) await hook(ctx);
    try {
      await fn(ctx);
    } finally {
      for (const hook of [...chain].reverse().flatMap((s) => s.after)) await hook(ctx);
    }
  };
  return new Function('run', `return async function ({ ${names.join(', ')} }) { return run(arguments[0]); }`)(run) as Body;
}

function testWith(name: string, fn: Body, timeout?: number) {
  // The chain holds the scope objects themselves, so a hook declared after the test still applies.
  extended(name, wrap(fn, [...scopes]), timeout);
}

function describeWith(name: string, fn: () => void) {
  describe(name, () => {
    scopes.push({ before: [], after: [] });
    try {
      fn();
    } finally {
      scopes.pop();
    }
  });
}

const current = () => scopes[scopes.length - 1] as Scope;

// The spec style the suite was written in: test.describe and test.beforeEach next to test itself.
export const test = Object.assign(testWith, {
  describe: describeWith,
  beforeEach: (fn: Body) => void current().before.push(fn),
  afterEach: (fn: Body) => void current().after.push(fn),
  beforeAll,
  afterAll,
});

export { expect, ADMIN, BASE_URL, CONTENT_DIR };
export { uniqueSlug } from './helpers/api';
export type { ApiClient } from './helpers/api';
export type { ContentRepo } from './helpers/content';
