// Before any spec: bundle the in-page helpers, start chromedriver and the server, and claim the server.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import {
  ADMIN,
  API_TOKEN,
  BASE_URL,
  BUNDLE_FILE,
  CONTENT_DIR,
  DRIVER_PORT,
  PORT,
  REPO_ROOT,
  RUN_DIR,
  SEED_DIR,
  STORAGE_STATE,
  WEBHOOK_SECRET,
} from '../env';
import { Http } from './http';

/** Server logs are pino JSON and drown the output, so they are opt-in, like chromedriver's. */
const showServerLog = process.env.TABLINUM_E2E_SERVER_LOG === '1';
const showDriverLog = process.env.TABLINUM_E2E_DRIVER_LOG === '1';

const SERVER_ENV = {
  TABLINUM_CONTENT_DIR: CONTENT_DIR,
  TABLINUM_PORT: String(PORT),
  TABLINUM_SESSION_SECRET: `e2e-session-secret-${PORT}-0123456789`,
  TABLINUM_API_TOKENS: API_TOKEN,
  TABLINUM_GIT_BRANCH: 'main',
  TABLINUM_GIT_AUTHOR_NAME: 'tablinum e2e',
  TABLINUM_GIT_AUTHOR_EMAIL: 'e2e@localhost',
  TABLINUM_AUTOCOMMIT_MS: '200',
  TABLINUM_AUTOPULL_MS: '0',
  TABLINUM_AUTOPUSH_MS: '0',
  TABLINUM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  TABLINUM_E2E_RUN_DIR: RUN_DIR,
  TABLINUM_E2E_SEED_DIR: SEED_DIR,
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function waitFor(url: string, timeoutMs: number, child: ChildProcess, what: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${what} exited with ${String(child.exitCode)}`);
    const ok = await fetch(url).then((r) => r.ok, () => false);
    if (ok) return;
    await sleep(250);
  }
  throw new Error(`${what} did not answer ${url} within ${String(timeoutMs / 1000)}s`);
}

async function bundleInPage() {
  const out = await build({
    entryPoints: [join(REPO_ROOT, 'e2e/harness/in-page.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
  });
  await writeFile(BUNDLE_FILE, out.outputFiles[0]?.text ?? '');
}

function startDriver(): ChildProcess {
  const bin = process.env.CHROMEDRIVER ?? 'chromedriver';
  // Its own process group, so stopping it also stops every browser it started.
  const child = spawn(bin, [`--port=${String(DRIVER_PORT)}`, '--allowed-ips=127.0.0.1'], {
    detached: true,
    stdio: ['ignore', 'ignore', showDriverLog ? 'inherit' : 'ignore'],
  });
  child.on('error', (err) => console.error(`[e2e] chromedriver (${bin}) failed to start: ${err.message}`));
  return child;
}

function startServer(): ChildProcess {
  return spawn('node', ['e2e/scripts/run-server.mjs'], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...SERVER_ENV },
    detached: true,
    stdio: ['ignore', showServerLog ? 'inherit' : 'ignore', 'inherit'],
  });
}

// Claim the fresh server before tests so every isolated session uses the same admin cookie.
async function claimServer() {
  const http = new Http({ baseURL: BASE_URL });
  const state = await http.get('/api/v1/auth/state');
  if (!state.ok()) throw new Error(`auth state: ${await state.text()}`);
  const { setupRequired } = (await state.json()) as { setupRequired: boolean };
  const response = setupRequired
    ? await http.post('/api/v1/auth/setup', { data: ADMIN })
    : await http.post('/api/v1/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } });
  if (!response.ok()) throw new Error(`claiming the server: ${await response.text()}`);
  await mkdir(dirname(STORAGE_STATE), { recursive: true });
  await writeFile(STORAGE_STATE, JSON.stringify({ cookies: http.cookies() }));
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  signalGroup(child, 'SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  signalGroup(child, 'SIGKILL');
}

export default async function setup() {
  await bundleInPage();
  const driver = startDriver();
  const server = startServer();
  // A run cut short (Ctrl-C, a CI timeout) skips the teardown, so the groups go down with the runner.
  const abort = () => {
    signalGroup(server, 'SIGKILL');
    signalGroup(driver, 'SIGKILL');
  };
  process.once('exit', abort);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => (abort(), process.exit(130)));
  try {
    await waitFor(`http://127.0.0.1:${String(DRIVER_PORT)}/status`, 30_000, driver, 'chromedriver');
    await waitFor(`${BASE_URL}/api/v1/health`, 300_000, server, 'the server');
    await claimServer();
  } catch (err) {
    await Promise.all([stop(server), stop(driver)]);
    throw err;
  }
  return async () => {
    await Promise.all([stop(server), stop(driver)]);
  };
}
