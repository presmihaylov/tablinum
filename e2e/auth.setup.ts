import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, request as apiRequest, test as setup } from '@playwright/test';
import { ADMIN, BASE_URL, DEFAULT_PAGE_PATH, STORAGE_STATE } from './env';
import { saveWelcome, type WelcomePage } from './helpers/welcome';

/**
 * The first visitor of a fresh server claims it, so the suite does that once over the API and
 * saves the session cookie. Every spec in the "chromium" project starts from that file and
 * therefore starts signed in.
 */
setup('claim the server and save the admin session', async () => {
  const context = await apiRequest.newContext({ baseURL: BASE_URL });

  const state = await context.get('/api/v1/auth/state');
  expect(state.ok(), await state.text()).toBeTruthy();
  const { setupRequired } = (await state.json()) as { setupRequired: boolean };

  // A retried run meets a server that is already claimed, so sign in instead.
  const response = setupRequired
    ? await context.post('/api/v1/auth/setup', { data: ADMIN })
    : await context.post('/api/v1/auth/login', {
        data: { email: ADMIN.email, password: ADMIN.password },
      });
  expect(response.ok(), await response.text()).toBeTruthy();

  await mkdir(dirname(STORAGE_STATE), { recursive: true });
  await context.storageState({ path: STORAGE_STATE });
  await context.dispose();
});

/**
 * reset() writes the welcome page back before every test, so it needs the text the server put
 * there. Take it from the server rather than keep a copy of `WELCOME_MARKDOWN`: a copy drifts
 * the moment the product edits its own starter page.
 *
 * This runs in the setup project, after the server is up and before the first spec, so the page
 * it reads is still the one the server wrote and no test can have touched it.
 */
setup('capture the welcome page the server started with', async () => {
  const context = await apiRequest.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });

  const response = await context.get('/api/v1/pages', { params: { path: DEFAULT_PAGE_PATH } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { page } = (await response.json()) as { page: WelcomePage };

  await saveWelcome({ title: page.title, markdown: page.markdown });
  await context.dispose();
});
