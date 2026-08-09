import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, request as apiRequest, test as setup } from '@playwright/test';
import { ADMIN, BASE_URL, STORAGE_STATE } from './env';

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
