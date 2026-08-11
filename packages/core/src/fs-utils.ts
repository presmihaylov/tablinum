import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Stats } from 'node:fs';
import { TEMP_FILE_PREFIX, validation } from '@tablinum/shared';

const NULL_BYTE = String.fromCharCode(0);

export function isMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

export async function statOrNull(target: string): Promise<Stats | null> {
  try {
    return await fs.stat(target);
  } catch (error) {
    if (isMissingError(error)) return null;
    throw error;
  }
}

export async function pathExists(target: string): Promise<boolean> {
  return (await statOrNull(target)) !== null;
}

export async function isDirectory(target: string): Promise<boolean> {
  const stats = await statOrNull(target);
  return stats !== null && stats.isDirectory();
}

export async function isFile(target: string): Promise<boolean> {
  const stats = await statOrNull(target);
  return stats !== null && stats.isFile();
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function readText(target: string): Promise<string> {
  return fs.readFile(target, 'utf8');
}

export async function readTextOrNull(target: string): Promise<string | null> {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    if (isMissingError(error)) return null;
    throw error;
  }
}

let tempCounter = 0;

function tempPathFor(target: string): string {
  tempCounter += 1;
  return path.join(path.dirname(target), `${TEMP_FILE_PREFIX}${process.pid}-${tempCounter}`);
}

/**
 * Write the whole file, then move it over the target in one step. Whoever reads the file next
 * gets either the old bytes or the new ones. Without this the autocommit, which runs on a timer
 * of its own, can stage a page that is still half written.
 */
async function writeAtomic(target: string, data: string | Uint8Array): Promise<void> {
  await ensureDir(path.dirname(target));
  const temp = tempPathFor(target);
  try {
    await fs.writeFile(temp, data, 'utf8');
    await fs.rename(temp, target);
  } catch (error) {
    await removeFile(temp);
    throw error;
  }
}

/** Write a file, creating any missing parent directory. */
export async function writeText(target: string, content: string): Promise<void> {
  await writeAtomic(target, content);
}

/** The same, for an attachment or any other file that is not text. */
export async function writeBytes(target: string, data: Uint8Array): Promise<void> {
  await writeAtomic(target, data);
}

export async function removeFile(target: string): Promise<void> {
  try {
    await fs.unlink(target);
  } catch (error) {
    if (isMissingError(error)) return;
    throw error;
  }
}

/** Remove a directory and everything in it. A directory that is not there is not an error. */
export async function removeDir(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

export async function readDirNames(target: string): Promise<string[]> {
  try {
    return await fs.readdir(target);
  } catch (error) {
    if (isMissingError(error)) return [];
    throw error;
  }
}

/** Remove a directory only when it holds nothing. Never touches `root` itself. */
export async function removeDirIfEmpty(root: string, target: string): Promise<boolean> {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved === resolvedRoot) return false;
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) return false;
  const names = await readDirNames(resolved);
  if (names.length > 0) return false;
  try {
    await fs.rmdir(resolved);
    return true;
  } catch (error) {
    if (isMissingError(error)) return false;
    throw error;
  }
}

export async function rename(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  await fs.rename(from, to);
}

/**
 * Resolve `target` inside `root` and reject anything that escapes it.
 * `target` may be absolute or relative to the root.
 */
export function resolveInside(root: string, target: string): string {
  if (typeof target !== 'string' || target.length === 0) {
    throw validation('A file path is required');
  }
  if (target.includes(NULL_BYTE)) throw validation('File path contains a null byte');
  const base = path.resolve(root);
  const resolved = path.isAbsolute(target) ? path.resolve(target) : path.resolve(base, target);
  if (resolved === base) return resolved;
  const relative = path.relative(base, resolved);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw validation(`Path escapes the content directory: ${JSON.stringify(target)}`);
  }
  return resolved;
}
