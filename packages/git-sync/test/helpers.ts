import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { GitEngine, type GitEngineOptions } from '../src/engine.js';
import type { GitLogger } from '../src/logger.js';

const run = promisify(execFile);

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.test',
  GIT_COMMITTER_NAME: 'Test Author',
  GIT_COMMITTER_EMAIL: 'author@example.test',
};

const created: string[] = [];

/** A fresh temp directory, resolved through symlinks so paths compare equal on macOS. */
export async function tempDir(prefix = 'gitdocs-'): Promise<string> {
  const dir = await mkdtemp(join(await realpath(tmpdir()), prefix));
  created.push(dir);
  return dir;
}

/** Remove every directory made by tempDir(). */
export async function cleanupTempDirs(): Promise<void> {
  const dirs = created.splice(0, created.length);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

/** Run git directly, outside the engine, so tests can assert on real repo state. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, env: GIT_ENV });
  return stdout;
}

export async function gitLines(cwd: string, ...args: string[]): Promise<string[]> {
  const stdout = await git(cwd, ...args);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function commitCount(cwd: string): Promise<number> {
  try {
    const [count] = await gitLines(cwd, 'rev-list', '--count', 'HEAD');
    return Number(count ?? '0');
  } catch {
    return 0;
  }
}

export async function commitSubjects(cwd: string): Promise<string[]> {
  try {
    return await gitLines(cwd, 'log', '--format=%s');
  } catch {
    return [];
  }
}

/** A bare repo that stands in for the origin remote. */
export async function bareRemote(): Promise<string> {
  const dir = await tempDir('gitdocs-remote-');
  await git(dir, 'init', '--bare', '--initial-branch=main');
  return dir;
}

/** A working clone of a remote, used to simulate a second author. */
export async function cloneOf(remote: string, prefix = 'gitdocs-peer-'): Promise<string> {
  const dir = await tempDir(prefix);
  await git(dir, 'clone', remote, '.');
  await git(dir, 'config', 'user.name', 'Test Author');
  await git(dir, 'config', 'user.email', 'author@example.test');
  await git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

export async function writeFileIn(dir: string, rel: string, content: string): Promise<string> {
  const target = join(dir, rel);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return target;
}

export async function readFileIn(dir: string, rel: string): Promise<string> {
  return readFile(join(dir, rel), 'utf8');
}

export async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** A page file with valid gitdocs frontmatter. */
export function page(id: string, title: string, body: string): string {
  return [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    'created: 2026-01-01T00:00:00.000Z',
    'updated: 2026-01-01T00:00:00.000Z',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

export interface CapturedLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

export function captureLogger(): { logger: GitLogger; entries: CapturedLog[] } {
  const entries: CapturedLog[] = [];
  const logger: GitLogger = {
    info: (message, meta) => entries.push({ level: 'info', message, ...(meta ? { meta } : {}) }),
    warn: (message, meta) => entries.push({ level: 'warn', message, ...(meta ? { meta } : {}) }),
    error: (message, meta) => entries.push({ level: 'error', message, ...(meta ? { meta } : {}) }),
  };
  return { logger, entries };
}

const engines: GitEngine[] = [];

/** Build an engine with test-friendly defaults; every engine is disposed after the test. */
export function makeEngine(options: GitEngineOptions): GitEngine {
  const { logger } = captureLogger();
  // Both timers are off unless a test asks for them: a background push would race assertions.
  const engine = new GitEngine({ logger, autopullMs: 0, autopushMs: 0, ...options });
  engines.push(engine);
  return engine;
}

export function disposeEngines(): void {
  while (engines.length > 0) engines.pop()?.dispose();
}

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  message = 'condition',
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await sleep(10);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
