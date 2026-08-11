import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The repository root, so the config can point at apps/server/dist and apps/web/dist. */
export const REPO_ROOT = resolve(HERE, '..');

/**
 * One run owns one port. Every other path below is derived from it, so two runs on two
 * ports never share a server, a content directory or a saved session.
 */
export const PORT = Number(process.env.TABLINUM_E2E_PORT ?? '4300');

/** Always this literal host: the saved session cookie is scoped to it. */
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export const RUN_DIR = join(tmpdir(), `tablinum-e2e-${PORT}`);
export const CONTENT_DIR = join(RUN_DIR, 'content');
export const STORAGE_STATE = join(RUN_DIR, 'admin-state.json');

/** The welcome page as the fresh server wrote it, saved by the setup project for reset(). */
export const WELCOME_STATE = join(RUN_DIR, 'welcome.json');

// The report and the traces are the one thing a run leaves behind for a human, so they go in
// the checkout under the usual playwright names, where CI can upload them. Both are gitignored.
export const RESULTS_DIR = join(REPO_ROOT, 'test-results');
export const REPORT_DIR = join(REPO_ROOT, 'playwright-report');

/** The account the setup project claims the server with. */
export const ADMIN = {
  email: 'e2e-admin@example.com',
  name: 'E2E Admin',
  password: 'e2e-password-1234',
} as const;

/** Operator token, for a spec that has to call the API without a browser session. */
export const API_TOKEN = 'e2e-operator-token';

/** Signs every agent webhook. A spec stands a receiver and verifies a delivery against it. */
export const WEBHOOK_SECRET = 'e2e-webhook-secret-0123456789';

/** The space a fresh content directory starts with, plus its home page. */
export const DEFAULT_SPACE_SLUG = 'docs';
export const DEFAULT_PAGE_PATH = 'docs';
