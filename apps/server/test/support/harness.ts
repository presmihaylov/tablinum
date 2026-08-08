import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  PageResponseSchema,
  loadConfig,
  parseOrThrow,
  type Config,
  type EnvSource,
} from '@gitdocs/shared';
import { buildApp } from '../../src/app.js';
import type { ServerDeps } from '../../src/deps.js';
import { FsContentStore } from './fs-store.js';
import { TestGitEngine } from './git-double.js';
import { MemorySearchIndex } from './search-double.js';

export const TEST_TOKEN = 'test-token-aaaaaaaaaaaaaaaa';
export const TEST_PASSWORD = 'correct horse battery staple';
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

export interface Harness {
  app: FastifyInstance;
  config: Config;
  deps: ServerDeps;
  store: FsContentStore;
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
  /** Drop the default token and password so the app runs in OPEN mode. */
  open?: boolean;
}

export async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'gitdocs-server-'));
  const contentDir = join(root, 'content');

  const baseEnv: EnvSource = {
    GITDOCS_CONTENT_DIR: contentDir,
    GITDOCS_SESSION_SECRET: TEST_SESSION_SECRET,
    GITDOCS_AUTOCOMMIT_MS: '25',
    GITDOCS_AUTOPULL_MS: '0',
  };
  if (options.open !== true) {
    baseEnv.GITDOCS_API_TOKENS = TEST_TOKEN;
    baseEnv.GITDOCS_PASSWORD = TEST_PASSWORD;
  }

  const config = loadConfig({ ...baseEnv, ...options.env });

  const store = new FsContentStore(config.contentDir);
  await store.init();
  // A long debounce keeps the suite deterministic: tests call git.flush() to commit.
  const git = new TestGitEngine(config.contentDir, 60_000);
  await git.init();
  const search = new MemorySearchIndex();
  await search.init();

  const deps: ServerDeps = {
    config,
    store,
    git,
    search,
    logger: false,
    webDistDir: null,
    echoSuppressMs: 500,
  };

  const app = await buildApp(deps);

  return {
    app,
    config,
    deps,
    store,
    git,
    search,
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
