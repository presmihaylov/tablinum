import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  ASSETS_DIR,
  PAGE_EXT,
  isIndexFile,
  isValidPagePath,
  relFileToPagePath,
  type PagePath,
} from '@gitdocs/shared';

/** One markdown file that represents a page. */
export interface ScannedPageFile {
  /** Path relative to the content root, e.g. "eng/runbooks/index.md". */
  relFile: string;
  /** Absolute path on disk. */
  filePath: string;
  path: PagePath;
  isIndex: boolean;
}

const IGNORED_DIR_NAMES = new Set(['.git', 'node_modules', ASSETS_DIR]);

export function isIgnoredDirName(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (name.startsWith('_')) return true;
  return IGNORED_DIR_NAMES.has(name);
}

export function isSpaceSlug(name: string): boolean {
  return isValidPagePath(name) && !name.includes('/');
}

export function isPageFileName(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('_')) return false;
  return name.toLowerCase().endsWith(PAGE_EXT);
}

async function readEntries(dir: string): Promise<{ name: string; directory: boolean }[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    // Symlinks are skipped on purpose: they are the one way a content repo can point outside itself.
    return entries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
  } catch {
    return [];
  }
}

/** Top-level directories that are content spaces, sorted by slug. */
export async function listSpaceSlugs(contentDir: string): Promise<string[]> {
  const entries = await readEntries(contentDir);
  return entries
    .filter((entry) => entry.directory && !isIgnoredDirName(entry.name) && isSpaceSlug(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function walk(contentDir: string, relDir: string, out: ScannedPageFile[]): Promise<void> {
  const entries = await readEntries(path.join(contentDir, relDir));
  for (const entry of entries) {
    const relChild = `${relDir}/${entry.name}`;
    if (entry.directory) {
      if (isIgnoredDirName(entry.name)) continue;
      if (!isSpaceSlug(entry.name)) continue;
      await walk(contentDir, relChild, out);
      continue;
    }
    if (!isPageFileName(entry.name)) continue;
    const pagePath = toPagePath(relChild);
    if (pagePath === null) continue;
    out.push({
      relFile: relChild,
      filePath: path.join(contentDir, relChild),
      path: pagePath,
      isIndex: isIndexFile(relChild),
    });
  }
}

function toPagePath(relFile: string): PagePath | null {
  try {
    return relFileToPagePath(relFile);
  } catch {
    return null;
  }
}

/**
 * Every page file under the content root, sorted by path.
 * Files directly in the content root are ignored: a page always lives inside a space.
 */
export async function scanPageFiles(contentDir: string): Promise<ScannedPageFile[]> {
  const out: ScannedPageFile[] = [];
  for (const slug of await listSpaceSlugs(contentDir)) {
    await walk(contentDir, slug, out);
  }
  return out.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    // `foo.md` and `foo/index.md` claim the same page path. The index form wins, because it is
    // the only one that can hold children; readdir order must not decide this.
    return Number(b.isIndex) - Number(a.isIndex);
  });
}
