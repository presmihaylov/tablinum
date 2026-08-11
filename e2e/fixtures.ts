import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN, API_TOKEN, BASE_URL, CONTENT_DIR } from './env';
import { ApiClient } from './helpers/api';
import { ContentRepo } from './helpers/content';

/** No cookies and no local storage: a caller the server has never seen. */
const EMPTY_STATE = { cookies: [], origins: [] };

export interface TablinumFixtures {
  /** REST client on the signed-in admin session. Seed content with it. */
  api: ApiClient;
  /** The content directory and its git repo, read straight from disk. */
  content: ContentRepo;
  /** A second page with no session at all: it lands on the login screen. */
  signedOutPage: Page;
  /** REST client with no session, for asserting what an anonymous caller may do. */
  signedOutRequest: APIRequestContext;
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

export const test = base.extend<TablinumFixtures>({
  api: async ({ request }, use) => {
    await use(new ApiClient(request));
  },

  content: async ({}, use) => {
    await use(new ContentRepo(CONTENT_DIR));
  },

  signedOutPage: async ({ browser }, use) => {
    // browser.newContext() ignores the project's `use`, so the empty state and the base URL
    // are both spelled out here.
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: EMPTY_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  signedOutRequest: async ({ playwright }, use) => {
    // request.newContext() inherits the project's storageState, so the empty one is explicit.
    const context = await playwright.request.newContext({ baseURL: BASE_URL, storageState: EMPTY_STATE });
    await use(context);
    await context.dispose();
  },

  operatorApi: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: EMPTY_STATE,
      extraHTTPHeaders: { authorization: `Bearer ${API_TOKEN}` },
    });
    await use(new ApiClient(context));
    await context.dispose();
  },

  cleanContent: [
    async ({ api }, use) => {
      await api.reset();
      await use();
    },
    { auto: true },
  ],
});

export { expect, ADMIN, BASE_URL, CONTENT_DIR };
export { uniqueSlug } from './helpers/api';
export type { ApiClient } from './helpers/api';
export type { ContentRepo } from './helpers/content';
