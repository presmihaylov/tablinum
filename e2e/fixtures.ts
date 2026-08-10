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
});

export { expect, ADMIN, BASE_URL, CONTENT_DIR };
export { uniqueSlug } from './helpers/api';
export type { ApiClient } from './helpers/api';
export type { ContentRepo } from './helpers/content';
