import { execFile } from 'node:child_process';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { CONTENT_DIR } from '../env';

const run = promisify(execFile);

/** A page is either `<path>.md` or `<path>/index.md`; the first child promotes it. */
export function pageFileVariants(pagePath: string): [string, string] {
  return [`${pagePath}.md`, `${pagePath}/index.md`];
}

/**
 * The content directory as git and the filesystem see it. Use it to prove that a UI action
 * really reached disk, and that git really committed it.
 */
export class ContentRepo {
  constructor(readonly dir: string = CONTENT_DIR) {}

  /** Absolute path of a repo-relative file. */
  path(relPath: string): string {
    return join(this.dir, relPath);
  }

  async read(relPath: string): Promise<string | null> {
    try {
      return await readFile(this.path(relPath), 'utf8');
    } catch {
      return null;
    }
  }

  async write(relPath: string, text: string): Promise<void> {
    await writeFile(this.path(relPath), text, 'utf8');
  }

  async remove(relPath: string): Promise<void> {
    await rm(this.path(relPath), { recursive: true, force: true });
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await stat(this.path(relPath));
      return true;
    } catch {
      return false;
    }
  }

  /** Every file under `relDir`, repo-relative and sorted. `.git` is left out. */
  async list(relDir = '.'): Promise<string[]> {
    const found: string[] = [];
    const walk = async (absolute: string): Promise<void> => {
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const child = join(absolute, entry.name);
        if (entry.isDirectory()) {
          await walk(child);
          continue;
        }
        found.push(relative(this.dir, child));
      }
    };
    await walk(this.path(relDir));
    return found.sort();
  }

  /** The file that actually holds a page, or null when neither variant is on disk. */
  async pageFile(pagePath: string): Promise<string | null> {
    for (const variant of pageFileVariants(pagePath)) {
      if (await this.exists(variant)) return variant;
    }
    return null;
  }

  /** The markdown of a page as it is stored, frontmatter included. */
  async pageFileText(pagePath: string): Promise<string | null> {
    const file = await this.pageFile(pagePath);
    return file === null ? null : this.read(file);
  }

  async git(...args: string[]): Promise<string> {
    const { stdout } = await run('git', args, { cwd: this.dir, maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim();
  }

  /** Commit subjects, newest first. */
  async commitSubjects(limit = 20): Promise<string[]> {
    const out = await this.git('log', `-${String(limit)}`, '--format=%s');
    return out.length === 0 ? [] : out.split('\n');
  }

  /** Files git tracks, repo-relative and sorted. */
  async trackedFiles(): Promise<string[]> {
    const out = await this.git('ls-files');
    return out.length === 0 ? [] : out.split('\n').sort();
  }

  /** Paths git still sees as changed. Empty means every edit is committed. */
  async dirtyFiles(): Promise<string[]> {
    const out = await this.git('status', '--porcelain');
    if (out.length === 0) return [];
    // `git()` trims, so a modified tracked file arrives as "M path", not " M path". Drop the
    // status columns by matching them, never by a fixed offset.
    return out
      .split('\n')
      .map((line) => line.replace(/^\s*\S{1,2}\s+/, '').trim())
      .sort();
  }

  // The writes below land through a debounce, so every wait is a poll, never a sleep.

  async waitForFile(relPath: string): Promise<void> {
    await expect
      .poll(() => this.exists(relPath), { message: `${relPath} never appeared in ${this.dir}` })
      .toBe(true);
  }

  async waitForFileGone(relPath: string): Promise<void> {
    await expect
      .poll(() => this.exists(relPath), { message: `${relPath} is still in ${this.dir}` })
      .toBe(false);
  }

  /** Wait until a page has a file on disk, then answer with that file's path. */
  async waitForPageFile(pagePath: string): Promise<string> {
    await expect
      .poll(() => this.pageFile(pagePath), { message: `no file on disk for page ${pagePath}` })
      .not.toBeNull();
    const file = await this.pageFile(pagePath);
    if (file === null) throw new Error(`no file on disk for page ${pagePath}`);
    return file;
  }

  /** Wait for a commit whose subject contains `text`. */
  async waitForCommit(text: string): Promise<void> {
    await expect
      .poll(() => this.commitSubjects(), { message: `no commit mentioning ${JSON.stringify(text)}` })
      .toEqual(expect.arrayContaining([expect.stringContaining(text)]));
  }

  /** Wait until git has nothing left to commit. */
  async waitForCleanTree(): Promise<void> {
    await expect.poll(() => this.dirtyFiles(), { message: 'the working tree stayed dirty' }).toEqual([]);
  }
}
