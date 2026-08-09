#!/usr/bin/env node
// Started by playwright's `webServer`. It builds the workspace when the build output is
// missing, throws away this port's content directory, and then runs the real server:
// the same apps/server/dist/server.js production runs, serving apps/web/dist itself.
//
// Everything it needs arrives in the environment (see e2e/playwright.config.ts), so the
// script never guesses a port or a directory.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

const SERVER_ENTRY = join(REPO_ROOT, 'apps/server/dist/server.js');
const WEB_INDEX = join(REPO_ROOT, 'apps/web/dist/index.html');
const BUILD_LOCK = join(REPO_ROOT, 'node_modules', '.tablinum-e2e-build.lock');

const contentDir = required('TABLINUM_CONTENT_DIR');
const runDir = required('TABLINUM_E2E_RUN_DIR');

function required(key) {
  const value = process.env[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`run-server.mjs needs ${key}`);
  }
  return value;
}

function isBuilt() {
  return existsSync(SERVER_ENTRY) && existsSync(WEB_INDEX);
}

function build() {
  console.log('[e2e] building the workspace...');
  const result = spawnSync('pnpm', ['-r', '--sequential', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`pnpm build failed with status ${String(result.status)}`);
}

/** A lock older than this belonged to a run that died; nobody is going to release it. */
const STALE_LOCK_MS = 10 * 60_000;

function takeBuildLock() {
  try {
    mkdirSync(BUILD_LOCK);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    if (Date.now() - statSync(BUILD_LOCK).mtimeMs > STALE_LOCK_MS) {
      rmSync(BUILD_LOCK, { recursive: true, force: true });
      return takeBuildLock();
    }
    return false;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Several agents run their own suites against this one checkout, so two cold starts can
 * meet here. The loser waits for the winner's output instead of writing dist twice.
 */
async function ensureBuilt() {
  if (isBuilt() && process.env.TABLINUM_E2E_BUILD !== '1') return;

  while (!takeBuildLock()) {
    await sleep(1000);
    if (isBuilt()) return;
  }
  try {
    build();
  } finally {
    rmSync(BUILD_LOCK, { recursive: true, force: true });
  }
}

/** A run starts from nothing: no repo, no accounts, no search index, no saved session. */
function resetRunDir() {
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(contentDir, { recursive: true });
}

await ensureBuilt();
resetRunDir();

// server.js only bootstraps when it is the process entry point, so import it and call start().
const { start } = await import(pathToFileURL(SERVER_ENTRY).href);
await start();
console.log(`[e2e] server listening on ${process.env.TABLINUM_PORT ?? ''} over ${contentDir}`);
