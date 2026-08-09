import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isAppError, type ErrorCode } from '@tablinum/shared';
import { silentLogger } from '../src/logger.js';
import { ContentStore } from '../src/store.js';

const BASE_TIME = Date.parse('2026-01-02T03:04:05.000Z');

export async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'tablinum-core-'));
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** A clock that advances one second per call, so `updated` always changes. */
export function tickingClock(start = BASE_TIME): () => Date {
  let tick = 0;
  return (): Date => {
    tick += 1;
    return new Date(start + tick * 1000);
  };
}

export function makeStore(contentDir: string): ContentStore {
  return new ContentStore({ contentDir, logger: silentLogger, now: tickingClock() });
}

export async function readFileAt(contentDir: string, relFile: string): Promise<string> {
  return readFile(path.join(contentDir, relFile), 'utf8');
}

export async function writeFileAt(
  contentDir: string,
  relFile: string,
  content: string,
): Promise<void> {
  const target = path.join(contentDir, relFile);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

export async function exists(contentDir: string, relFile: string): Promise<boolean> {
  try {
    await readFile(path.join(contentDir, relFile));
    return true;
  } catch {
    return false;
  }
}

/** Run `run` and return the error code it threw, or null when it did not throw. */
export async function codeOf(run: () => Promise<unknown>): Promise<ErrorCode | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
}
