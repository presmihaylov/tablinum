import { defineConfig, devices } from '@playwright/test';
import {
  API_TOKEN,
  BASE_URL,
  CONTENT_DIR,
  PORT,
  REPORT_DIR,
  REPO_ROOT,
  RESULTS_DIR,
  RUN_DIR,
  SEED_DIR,
  STORAGE_STATE,
  WEBHOOK_SECRET,
} from './env';

/** Server logs are pino JSON and drown the report, so they are opt-in. */
const showServerLog = process.env.TABLINUM_E2E_SERVER_LOG === '1';

export default defineConfig({
  testDir: '.',
  outputDir: RESULTS_DIR,
  // One server and one content directory back the whole run, so specs take turns.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: [
    ['list'],
    // The HTML report is what CI uploads. `open: 'never'` matters there: the default opens a
    // report server after a failed run, which would hang the job.
    ['html', { outputFolder: REPORT_DIR, open: 'never' }],
  ],
  // A green run leaves the report and nothing else; traces and screenshots below are the
  // expensive part, and they are written only for a test that failed.
  preserveOutput: 'failures-only',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    // Claims the fresh server and writes the admin session every other project starts from.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
  ],

  webServer: {
    command: 'node e2e/scripts/run-server.mjs',
    cwd: REPO_ROOT,
    url: `${BASE_URL}/api/v1/health`,
    // A fresh run must own its server; reusing one would inherit its content directory.
    reuseExistingServer: false,
    // The first run on a clean checkout builds every package before it can listen.
    timeout: 300_000,
    stdout: showServerLog ? 'pipe' : 'ignore',
    stderr: 'pipe',
    env: {
      TABLINUM_CONTENT_DIR: CONTENT_DIR,
      TABLINUM_PORT: String(PORT),
      TABLINUM_SESSION_SECRET: `e2e-session-secret-${PORT}-0123456789`,
      TABLINUM_API_TOKENS: API_TOKEN,
      TABLINUM_GIT_BRANCH: 'main',
      TABLINUM_GIT_AUTHOR_NAME: 'tablinum e2e',
      TABLINUM_GIT_AUTHOR_EMAIL: 'e2e@localhost',
      // Short, so a spec that asserts on git does not wait long for the debounced commit.
      TABLINUM_AUTOCOMMIT_MS: '200',
      // No remote in a test run, so a pull or a push would only add noise.
      TABLINUM_AUTOPULL_MS: '0',
      TABLINUM_AUTOPUSH_MS: '0',
      TABLINUM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      TABLINUM_E2E_RUN_DIR: RUN_DIR,
      TABLINUM_E2E_SEED_DIR: SEED_DIR,
    },
  },
});
