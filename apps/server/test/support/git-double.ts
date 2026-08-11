import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gitError, type GitConflict, type GitStatus, type Revision } from '@tablinum/shared';
import type { FileResolution, FileVersions, GitEngine } from '../../src/deps.js';

const run = promisify(execFile);

const FIELD = '\u001f';
const RECORD = '\u001e';
const LOG_FORMAT = ['%H', '%an', '%ae', '%aI', '%s'].join(FIELD) + RECORD;

function parseLog(raw: string): Revision[] {
  return raw
    .split(RECORD)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const fields = record.split(FIELD);
      return {
        sha: fields[0] ?? '',
        author: fields[1] ?? '',
        email: fields[2] ?? '',
        date: fields[3] ?? '',
        message: fields[4] ?? '',
      };
    });
}

/**
 * A real git repository driven through the git CLI. The suite uses it so history,
 * revisions and the auto-commit debounce are exercised against git itself.
 */
export class TestGitEngine implements GitEngine {
  #timer: NodeJS.Timeout | null = null;
  #pendingMessage: string | undefined;
  #chain: Promise<unknown> = Promise.resolve();

  /** Directories a test asked to keep out of git, as content-relative paths. */
  readonly excluded: string[] = [];

  /** Set by a test to pretend a pull hit a conflict it could not rebase. */
  conflict: GitConflict | null = null;
  versions: FileVersions[] = [];

  constructor(
    readonly contentDir: string,
    private readonly debounceMs = 25,
  ) {}

  async #git(args: string[]): Promise<string> {
    const { stdout } = await run('git', args, {
      cwd: this.contentDir,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        // Ignore the developer's own git config: hooks, signing and templates would
        // otherwise leak into the fixture repo.
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'tablinum',
        GIT_AUTHOR_EMAIL: 'tablinum@localhost',
        GIT_COMMITTER_NAME: 'tablinum',
        GIT_COMMITTER_EMAIL: 'tablinum@localhost',
      },
    });
    return stdout;
  }

  async #tryGit(args: string[]): Promise<string | null> {
    try {
      return await this.#git(args);
    } catch {
      return null;
    }
  }

  /** Same as the real engine: the line lands in `.git/info/exclude`, and git honours it. */
  async excludePath(relDir: string): Promise<void> {
    if (!this.excluded.includes(relDir)) this.excluded.push(relDir);
    const file = join(this.contentDir, '.git', 'info', 'exclude');
    await mkdir(dirname(file), { recursive: true });
    const current = existsSync(file) ? await readFile(file, 'utf8') : '';
    const line = `/${relDir}/`;
    if (current.split('\n').includes(line)) return;
    const head = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
    await writeFile(file, `${head}${line}\n`, 'utf8');
  }

  async excludedPaths(): Promise<string[]> {
    return [...this.excluded];
  }

  async init(): Promise<void> {
    if (existsSync(join(this.contentDir, '.git'))) return;
    try {
      await this.#git(['init', '-b', 'main']);
    } catch (err) {
      throw gitError('Failed to initialize the content repository', err);
    }
    await this.commit('chore: initialize tablinum content repo');
  }

  async status(): Promise<GitStatus> {
    const branch = (await this.#tryGit(['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? 'main';
    const porcelain = (await this.#tryGit(['status', '--porcelain'])) ?? '';
    const dirtyFiles = porcelain
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim());

    return {
      branch: branch === 'HEAD' ? 'main' : branch,
      ahead: 0,
      behind: 0,
      dirtyFiles,
      remote: (await this.#tryGit(['remote', 'get-url', 'origin']))?.trim() ?? null,
      lastCommit: await this.#lastCommit(),
      conflict: this.conflict,
    };
  }

  async #lastCommit(): Promise<Revision | null> {
    const raw = await this.#tryGit(['log', '-1', `--format=${LOG_FORMAT}`]);
    if (raw === null) return null;
    return parseLog(raw)[0] ?? null;
  }

  async commit(message?: string): Promise<string | null> {
    await this.#git(['add', '-A']);
    // status works on an unborn branch, where `diff --cached` has no HEAD to compare against.
    const staged = (await this.#tryGit(['status', '--porcelain'])) ?? '';
    if (staged.trim().length === 0) return null;
    await this.#git(['commit', '-m', message ?? 'docs: update pages']);
    return (await this.#git(['rev-parse', 'HEAD'])).trim();
  }

  scheduleCommit(message?: string): void {
    this.#pendingMessage = message ?? this.#pendingMessage;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const pending = this.#pendingMessage;
      this.#pendingMessage = undefined;
      this.#chain = this.#chain.then(() => this.commit(pending)).catch(() => null);
    }, this.debounceMs);
    this.#timer.unref?.();
  }

  /** Force the debounced commit to happen now. Tests use this instead of sleeping. */
  async flush(): Promise<string | null> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const pending = this.#pendingMessage;
    this.#pendingMessage = undefined;
    await this.#chain;
    return this.commit(pending);
  }

  flushCommit(): Promise<string | null> {
    return this.flush();
  }

  async history(relFile: string, limit: number): Promise<Revision[]> {
    const raw = await this.#tryGit([
      'log',
      '--follow',
      `--max-count=${limit}`,
      `--format=${LOG_FORMAT}`,
      '--',
      relFile,
    ]);
    if (raw === null) return [];
    return parseLog(raw);
  }

  async readFileAt(relFile: string, sha: string): Promise<string | null> {
    return this.#tryGit(['show', `${sha}:${relFile}`]);
  }

  async pull(): Promise<{ status: GitStatus; pulled: number; files: string[] }> {
    return { status: await this.status(), pulled: 0, files: [] };
  }

  async conflictVersions(): Promise<FileVersions[]> {
    return this.conflict === null ? [] : this.versions;
  }

  /** Write the caller's text, commit it and clear the pending conflict, like the real engine. */
  async resolveConflict(files: FileResolution[], message?: string): Promise<string[]> {
    for (const entry of files) {
      const target = join(this.contentDir, entry.file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.content, 'utf8');
    }
    await this.commit(message ?? 'docs: resolve conflicts with the remote');
    this.conflict = null;
    this.versions = [];
    return files.map((entry) => entry.file);
  }

  async push(): Promise<{ status: GitStatus; pushed: boolean }> {
    return { status: await this.status(), pushed: false };
  }

  startAutoPull(): void {
    // No remote in the fixture repo, so there is nothing to pull.
  }

  async stop(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#chain;
  }
}
