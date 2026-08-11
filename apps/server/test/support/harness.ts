import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { AccountStore } from '@tablinum/accounts';
import {
  PageResponseSchema,
  loadConfig,
  parseOrThrow,
  type Config,
  type EnvSource,
} from '@tablinum/shared';
import { buildApp } from '../../src/app.js';
import type { ServerDeps } from '../../src/deps.js';
import type { SlackApi } from '../../src/slack.js';
import type { WebhookSender } from '../../src/webhooks.js';
import { FsContentStore } from './fs-store.js';
import { TestGitEngine } from './git-double.js';
import { MemorySearchIndex } from './search-double.js';

export const TEST_TOKEN = 'test-token-aaaaaaaaaaaaaaaa';
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

export interface Harness {
  app: FastifyInstance;
  config: Config;
  deps: ServerDeps;
  store: FsContentStore;
  accounts: AccountStore;
  git: TestGitEngine;
  search: MemorySearchIndex;
  root: string;
  contentDir: string;
  /** Authorization header for the configured bearer token. */
  authHeaders(): Record<string, string>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Extra or overriding environment for loadConfig(). */
  env?: EnvSource;
  /** Start with no API token, so only an account can get in. */
  noToken?: boolean;
  /** A stub Slack transport. Undefined leaves Slack off unless the env configures a token. */
  slack?: SlackApi | null;
  /** A stub webhook transport, so no test reaches the network. */
  webhooks?: WebhookSender | null;
  /** A directory holding an index.html, so the SPA fallback is registered. */
  webDistDir?: string;
}

export async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'tablinum-server-'));
  const contentDir = join(root, 'content');

  const baseEnv: EnvSource = {
    TABLINUM_CONTENT_DIR: contentDir,
    TABLINUM_SESSION_SECRET: TEST_SESSION_SECRET,
    TABLINUM_AUTOCOMMIT_MS: '25',
    TABLINUM_AUTOPULL_MS: '0',
  };
  if (options.noToken !== true) baseEnv.TABLINUM_API_TOKENS = TEST_TOKEN;

  const config = loadConfig({ ...baseEnv, ...options.env });

  const store = new FsContentStore(config.contentDir);
  await store.init();
  // A long debounce keeps the suite deterministic: tests call git.flush() to commit.
  const git = new TestGitEngine(config.contentDir, 60_000);
  await git.init();
  const search = new MemorySearchIndex();
  await search.init();
  const accounts = new AccountStore({ dbPath: ':memory:' });
  accounts.init();

  const extra: Array<{ git: TestGitEngine; search: MemorySearchIndex }> = [];

  const deps: ServerDeps = {
    config,
    store,
    git,
    search,
    accounts,
    workspacesDir: join(root, 'workspaces'),
    // The same doubles as the default workspace, one set per directory.
    openWorkspace: async (record) => {
      const other = new FsContentStore(record.dir);
      const otherGit = new TestGitEngine(record.dir, 60_000);
      const otherSearch = new MemorySearchIndex();
      extra.push({ git: otherGit, search: otherSearch });
      return { store: other, git: otherGit, search: otherSearch };
    },
    logger: false,
    webDistDir: options.webDistDir ?? null,
    echoSuppressMs: 500,
    trustProxy: config.trustProxy,
  };
  if (options.slack !== undefined) deps.slack = options.slack;
  if (options.webhooks !== undefined) deps.webhooks = options.webhooks;

  const app = await buildApp(deps);

  return {
    app,
    config,
    deps,
    store,
    git,
    search,
    accounts,
    root,
    contentDir: config.contentDir,
    authHeaders: (): Record<string, string> => {
      const token = config.apiTokens[0];
      if (token === undefined) return {};
      return { authorization: `Bearer ${token}` };
    },
    async close(): Promise<void> {
      await app.close();
      await git.stop();
      await search.close();
      for (const other of extra) {
        await other.git.stop();
        await other.search.close();
      }
      accounts.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Parse a response body against a contract schema, so every test asserts the wire shape. */
export function bodyOf<T>(response: { body: string }, schema: z.ZodType<T>): T {
  const raw: unknown = JSON.parse(response.body);
  return parseOrThrow(schema, raw, 'response body');
}

/** Create a space plus a couple of pages so a test can start from real content. */
export async function seed(harness: Harness): Promise<{ space: string; pageIds: string[] }> {
  const headers = harness.authHeaders();

  await harness.app.inject({
    method: 'POST',
    url: '/api/v1/spaces',
    headers,
    payload: { slug: 'eng', name: 'Engineering', icon: '🛠' },
  });

  const pageIds: string[] = [];
  for (const page of [
    { path: 'eng/deploy', title: 'Deploy runbook', markdown: '# Deploy\n\nRun the pipeline.' },
    { path: 'eng/oncall', title: 'On-call guide', markdown: 'Escalate to the duty engineer.' },
  ]) {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers,
      payload: page,
    });
    pageIds.push(bodyOf(response, PageResponseSchema).page.id);
  }

  return { space: 'eng', pageIds };
}
