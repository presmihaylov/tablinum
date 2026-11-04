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

/**
 * The content tree a fresh server writes, copied out before any spec has run. reset() puts it
 * back, so the suite never has to describe what a fresh tree holds.
 */
export const SEED_DIR = join(RUN_DIR, 'seed');

// A failed test's screenshot is the one thing a run leaves behind for a human, so it goes in the
// checkout, where CI can upload it. The directory is gitignored.
export const RESULTS_DIR = join(REPO_ROOT, 'test-results');

/** chromedriver's port; the port names it like the server, so two runs never share a driver. */
export const DRIVER_PORT = Number(process.env.TABLINUM_E2E_DRIVER_PORT ?? String(PORT + 1000));

/** The in-page helpers, bundled by global-setup.ts. Outside RUN_DIR, which the server wipes. */
export const BUNDLE_FILE = join(tmpdir(), `tablinum-e2e-${PORT}.in-page.js`);

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
