import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  DEFAULT_AUTOCOMMIT_MS,
  DEFAULT_AUTOPULL_MS,
  DEFAULT_AUTOPUSH_MS,
  DEFAULT_GIT_AUTHOR_EMAIL,
  DEFAULT_GIT_AUTHOR_NAME,
  DEFAULT_GIT_BRANCH,
  TEMP_FILE_EXCLUDE_LINE,
  gitError,
  notFound,
  redactRemoteUrl,
  validation,
} from '@tablinum/shared';
import type { Config, GitConflict, GitStatus, Revision } from '@tablinum/shared';
import { consoleLogger, type GitLogger } from './logger.js';
import { Mutex } from './mutex.js';

/** Everything the engine needs. Only `contentDir` is required; the rest fall back to the defaults. */
export interface GitEngineOptions {
  contentDir: string;
  remote?: string | null;
  branch?: string;
  authorName?: string;
  authorEmail?: string;
  autocommitMs?: number;
  autopullMs?: number;
  autopushMs?: number;
  logger?: GitLogger;
}

/** What `init()` actually did. */
export interface InitResult {
  /** True when this call created the repo with `git init`. */
  created: boolean;
  /** True when this call cloned the configured remote. */
  cloned: boolean;
  branch: string;
}

export type PullReason = 'pulled' | 'up-to-date' | 'no-remote';

export interface PullResult {
  /** Number of remote commits that were not in the local branch before the pull. */
  pulled: number;
  /** Repo-relative files whose content changed because of the pull. */
  files: string[];
  reason: PullReason;
}

export type PushReason = 'pushed' | 'up-to-date' | 'no-remote' | 'no-commits';

export interface PushResult {
  pushed: boolean;
  reason: PushReason;
}

/** The three versions of one conflicted file, straight out of the object database. */
export interface ConflictVersions {
  /** Repo-relative path. */
  file: string;
  /** The version on the local branch. */
  local: string;
  /** The version on the remote branch. */
  remote: string;
  /** The version the two branches last agreed on. Empty when the file is new on both sides. */
  base: string;
}

/** One caller decision: the exact text to keep for a conflicted file. */
export interface ConflictResolution {
  file: string;
  content: string;
}

const GITATTRIBUTES_NAME = '.gitattributes';

// Markdown and YAML must round-trip byte for byte between the web editor, the API and git.
const GITATTRIBUTES_CONTENT = [
  '# tablinum: page files are text and always use LF, on every platform.',
  '*.md text eol=lf',
  '*.markdown text eol=lf',
  '*.yml text eol=lf',
  '*.yaml text eol=lf',
  '',
].join('\n');

const INITIAL_COMMIT_MESSAGE = 'chore: initialize tablinum content repo';
const GITATTRIBUTES_COMMIT_MESSAGE = 'chore: normalize page line endings';
const PRE_PULL_COMMIT_MESSAGE = 'docs: save local edits before pull';
/** How many times a pull re-commits a tree that a concurrent page save dirtied again. */
const PRE_PULL_COMMIT_ATTEMPTS = 3;
const RESOLVE_COMMIT_MESSAGE = 'docs: resolve conflicts with the remote';

/**
 * Every write of ours goes through one mutex, so a lock we meet belongs to a git run outside
 * this process. Those are short, so a few waits beat a warning in the log. The lock file is
 * never removed here: one that outlives this belongs to a live process or needs a human.
 */
const INDEX_LOCK_ATTEMPTS = 4;
const INDEX_LOCK_WAIT_MS = 120;

// NUL ends a record: git accepts every other byte in a commit message, so nothing else is
// safe to split on. The message is the last field, so a stray field separator cannot forge one.
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x00';
const LOG_FORMAT = ['%H', '%an', '%ae', '%aI', '%B'].join(FIELD_SEP) + '%x00';

const SHA_RE = /^[0-9a-f]{7,64}$/;
const BRANCH_RE = /^(?!-)[A-Za-z0-9._][A-Za-z0-9._\-/]*$/;
const REVISION_RE = /^(?!-)[A-Za-z0-9][A-Za-z0-9._\-/^~]{0,199}$/;

const DEFAULT_HISTORY_LIMIT = 50;
const DETACHED_PREFIX = 'detached@';

/**
 * Environment variables that make git start an editor, a pager or an alternate config, none of
 * which a server process ever wants. simple-git also refuses to inherit them.
 */
const DROPPED_ENV_KEYS = new Set([
  'editor',
  'pager',
  'prefix',
  'git_editor',
  'git_sequence_editor',
  'git_pager',
  'git_external_diff',
  'git_proxy_command',
  'git_template_dir',
  'git_exec_path',
  'git_config',
  'git_config_global',
  'git_config_system',
  'git_config_count',
]);

const GIT_CONFIG_ENV_RE = /^git_config_(key|value)_\d+$/;

/** Inherit the operator's environment, minus anything that could make git go interactive. */
function gitChildEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (DROPPED_ENV_KEYS.has(lower) || GIT_CONFIG_ENV_RE.test(lower)) continue;
    env[key] = value;
  }
  env['GIT_TERMINAL_PROMPT'] = '0';
  return env;
}

function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function firstLine(value: string): string {
  const line = splitLines(value)[0];
  return line ?? value.trim();
}

/** Strip `user:password@` out of every URL in a line of git output. */
function redactUserInfo(text: string): string {
  return text.replace(/\/\/[^/@\s]*@/g, '//');
}

/** Pull the most useful single line out of whatever simple-git threw. */
function describeGitError(err: unknown): string {
  // A failed fetch prints the remote URL, and this text reaches the client.
  if (err instanceof Error) return redactUserInfo(firstLine(err.message) || err.message);
  return redactUserInfo(firstLine(String(err)));
}

/** True when git refused because another process holds `.git/index.lock`. */
export function isIndexLockError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return text.includes('index.lock');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLog(raw: string): Revision[] {
  const revisions: Revision[] = [];
  for (const record of raw.split(RECORD_SEP)) {
    if (record.trim().length === 0) continue;
    const fields = record.replace(/^\r?\n/, '').split(FIELD_SEP);
    if (fields.length < 5) continue;
    revisions.push({
      sha: (fields[0] ?? '').trim(),
      author: (fields[1] ?? '').trim(),
      email: (fields[2] ?? '').trim(),
      date: (fields[3] ?? '').trim(),
      // The message is the last field, so a separator inside it stays part of the message.
      message: fields.slice(4).join(FIELD_SEP).trim(),
    });
  }
  return revisions;
}

/** Derive a commit message from the files that are about to be committed. */
export function defaultCommitMessage(files: string[]): string {
  const pages = files.filter((file) => file.toLowerCase().endsWith('.md'));
  if (pages.length > 0) return `docs: update ${pages.length} page(s)`;
  return `chore: update ${files.length} file(s)`;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function isEmptyDir(target: string): Promise<boolean> {
  try {
    const entries = await readdir(target);
    return entries.filter((entry) => entry !== '.DS_Store').length === 0;
  } catch {
    return true;
  }
}

async function readTextOrEmpty(target: string): Promise<string> {
  try {
    return await readFile(target, 'utf8');
  } catch {
    return '';
  }
}

/** Slash-joined plain directory names. A glob character or a `..` segment is refused. */
function isSafeExcludePath(relDir: string): boolean {
  const parts = relDir.split('/');
  if (parts.length === 0 || parts.length > 4) return false;
  return parts.every((part) => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(part) && part !== '..');
}

/**
 * Owns the content directory as a git repo: init or clone, commit, pull with rebase, push,
 * per-file history, and the debounced auto-commit that turns a burst of saves into one commit.
 */
export class GitEngine {
  readonly contentDir: string;
  readonly remote: string | null;
  readonly branch: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly autocommitMs: number;
  readonly autopullMs: number;
  readonly autopushMs: number;

  private readonly logger: GitLogger;
  private readonly mutex = new Mutex();
  private client: SimpleGit | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMessage: string | null = null;
  private pendingCommits = 0;
  private autoPullRunning = false;
  private autoPushRunning = false;
  private disposed = false;
  private conflictState: GitConflict | null = null;

  constructor(options: GitEngineOptions) {
    if (!isAbsolute(options.contentDir)) {
      throw validation(`contentDir must be an absolute path, got ${JSON.stringify(options.contentDir)}`);
    }
    const branch = options.branch ?? DEFAULT_GIT_BRANCH;
    if (!BRANCH_RE.test(branch)) {
      throw validation(`Invalid git branch name: ${JSON.stringify(branch)}`);
    }

    this.contentDir = options.contentDir.replace(/\/+$/, '') || '/';
    this.remote = options.remote ?? null;
    this.branch = branch;
    this.authorName = options.authorName ?? DEFAULT_GIT_AUTHOR_NAME;
    this.authorEmail = options.authorEmail ?? DEFAULT_GIT_AUTHOR_EMAIL;
    this.autocommitMs = options.autocommitMs ?? DEFAULT_AUTOCOMMIT_MS;
    this.autopullMs = options.autopullMs ?? DEFAULT_AUTOPULL_MS;
    this.autopushMs = options.autopushMs ?? DEFAULT_AUTOPUSH_MS;
    this.logger = options.logger ?? consoleLogger;
  }

  /** Build an engine straight from the resolved runtime config. */
  static fromConfig(config: Config, logger?: GitLogger): GitEngine {
    return new GitEngine({
      contentDir: config.contentDir,
      remote: config.gitRemote,
      branch: config.gitBranch,
      authorName: config.gitAuthorName,
      authorEmail: config.gitAuthorEmail,
      autocommitMs: config.autocommitMs,
      autopullMs: config.autopullMs,
      autopushMs: config.autopushMs,
      ...(logger ? { logger } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // public API
  // -------------------------------------------------------------------------

  /**
   * Make the content directory a usable git repo. Safe to call on every boot: an existing repo
   * is left alone apart from the local identity config and a missing `.gitattributes`.
   */
  async init(): Promise<InitResult> {
    return this.mutex.runExclusive(() => this.initUnlocked());
  }

  /** True when the content directory is already a git repo. */
  async isRepo(): Promise<boolean> {
    return pathExists(join(this.contentDir, '.git'));
  }

  /**
   * Hide one directory from git for good. Used by private spaces: the line goes in before the
   * directory exists, so git never sees the files at all.
   *
   * `.git/info/exclude` rather than a committed `.gitignore`, because the exclude file stays
   * inside this clone. A `.gitignore` would push the slug names of every private space to the
   * remote, which is a leak of its own. Idempotent, and safe on a repo that is not init'd yet.
   */
  async excludePath(relDir: string): Promise<void> {
    if (!isSafeExcludePath(relDir)) throw validation(`Cannot exclude ${relDir}`);
    await this.mutex.runExclusive(() => this.appendExcludeLine(`/${relDir}/`));
  }

  /** Add one line to the exclude file if it is not already there. Call it under the mutex. */
  private async appendExcludeLine(line: string): Promise<void> {
    const file = join(this.contentDir, '.git', 'info', 'exclude');
    const current = (await readTextOrEmpty(file)).replace(/\r\n/g, '\n');
    if (current.split('\n').includes(line)) return;
    const head = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${head}${line}\n`, 'utf8');
  }

  /** Every directory `.git/info/exclude` hides, as content-relative paths. */
  async excludedPaths(): Promise<string[]> {
    const raw = await readTextOrEmpty(join(this.contentDir, '.git', 'info', 'exclude'));
    return raw
      .split('\n')
      .map((line) => /^\/(.+)\/$/.exec(line.trim())?.[1] ?? null)
      .filter((name): name is string => name !== null);
  }

  /** Branch, ahead/behind against the remote-tracking ref, dirty files and the last commit. */
  async status(): Promise<GitStatus> {
    const git = await this.git();
    const branch = await this.currentBranch();
    const dirtyFiles = await this.dirtyFiles();
    const upstream = await this.upstreamRef();
    const counts = upstream === null ? { ahead: 0, behind: 0 } : await this.aheadBehind(upstream);

    return {
      branch,
      ahead: counts.ahead,
      behind: counts.behind,
      dirtyFiles,
      remote: await this.remoteUrl(git),
      lastCommit: await this.lastCommit(),
      conflict: this.conflictState,
    };
  }

  /** The pull conflict still waiting for a decision, or null. */
  conflict(): GitConflict | null {
    return this.conflictState;
  }

  /**
   * The local, remote and base version of every conflicted file. The rebase was already aborted,
   * so all three come out of the object database and the working tree stays untouched.
   */
  async conflictVersions(): Promise<ConflictVersions[]> {
    const pending = this.conflictState;
    if (pending === null) return [];
    return this.mutex.runExclusive(() => this.conflictVersionsUnlocked(pending.files));
  }

  /**
   * Apply the caller's chosen text for every conflicted file and merge the remote in. Unlike the
   * pull this keeps both histories: the resolution lands as a merge commit.
   */
  async resolveConflict(files: ConflictResolution[], message?: string): Promise<string[]> {
    return this.mutex.runExclusive(() => this.resolveConflictUnlocked(files, message));
  }

  /** Stage everything and commit. Returns the new commit sha, or null when nothing changed. */
  async commitAll(message?: string): Promise<string | null> {
    return this.mutex.runExclusive(() => this.commitAllUnlocked(message));
  }

  /**
   * Fetch and rebase onto the remote branch. On conflict the rebase is aborted, the working tree
   * is restored, and a GIT_ERROR naming the conflicted files is thrown. The repo is never left
   * in the middle of a rebase.
   */
  async pull(): Promise<PullResult> {
    return this.mutex.runExclusive(() => this.pullUnlocked());
  }

  /** Push the current branch to the remote. A missing remote is a clean no-op, not an error. */
  async push(): Promise<PushResult> {
    return this.mutex.runExclusive(() => this.pushUnlocked());
  }

  /** Commits that touched one file, newest first, following the file across renames. */
  async history(relFilePath: string, limit = DEFAULT_HISTORY_LIMIT): Promise<Revision[]> {
    const rel = this.toRepoPath(relFilePath);
    const max = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_HISTORY_LIMIT;
    const git = await this.git();
    try {
      const raw = await git.raw([
        'log',
        '--follow',
        `--max-count=${max}`,
        `--format=${LOG_FORMAT}`,
        '--',
        rel,
      ]);
      return parseLog(raw);
    } catch {
      // Unborn branch, or a path git has never tracked.
      return [];
    }
  }

  /**
   * Content of one file as it was at one revision. `history()` follows renames, so a revision it
   * reported can predate the current name; every earlier name of the file is tried too.
   */
  async showAtRevision(relFilePath: string, sha: string): Promise<string> {
    const rel = this.toRepoPath(relFilePath);
    const revision = assertRevision(sha);
    const git = await this.git();

    const direct = await this.showOrNull(git, revision, rel);
    if (direct !== null) return direct;

    for (const candidate of await this.historicalPaths(rel)) {
      if (candidate === rel) continue;
      const found = await this.showOrNull(git, revision, candidate);
      if (found !== null) return found;
    }
    throw notFound(`No content for ${rel} at revision ${revision}`);
  }

  private async showOrNull(git: SimpleGit, revision: string, rel: string): Promise<string | null> {
    try {
      return await git.raw(['show', `${revision}:${rel}`]);
    } catch {
      return null;
    }
  }

  /** Every name this file has been known by, newest first. */
  private async historicalPaths(rel: string): Promise<string[]> {
    const git = await this.git();
    let raw: string;
    try {
      raw = await git.raw(['log', '--follow', '--name-status', '--format=', '--', rel]);
    } catch {
      return [];
    }

    const names = new Set<string>();
    for (const line of raw.split('\n')) {
      const parts = line.split('\t');
      // A name-status line is "M\tpath" or "R100\told\tnew"; both names of a rename count.
      if (parts.length < 2) continue;
      if (!/^[A-Z]\d*$/.test(parts[0] ?? '')) continue;
      for (const name of parts.slice(1)) {
        if (name.length > 0) names.add(name);
      }
    }
    return [...names];
  }

  /**
   * Signal that a write happened. Bursts coalesce: ten saves inside the debounce window produce
   * exactly one commit, `autocommitMs` after the last one.
   */
  scheduleCommit(message?: string): void {
    if (this.disposed) return;
    if (this.commitTimer !== null) clearTimeout(this.commitTimer);
    // One commit covers the whole burst, so a single caller's message would misdescribe it.
    // The message is kept only while it is the sole one pending.
    this.pendingMessage = this.pendingCommits === 0 ? (message ?? null) : null;
    this.pendingCommits += 1;

    this.commitTimer = setTimeout(() => {
      this.commitTimer = null;
      void this.runScheduledCommit();
    }, this.autocommitMs);
    this.commitTimer.unref?.();
  }

  /** Take the message the pending burst should use, and reset the burst. */
  private takePendingMessage(): string | undefined {
    const message = this.pendingMessage;
    this.pendingMessage = null;
    this.pendingCommits = 0;
    return message ?? undefined;
  }

  /** Cancel any pending debounce and commit right now. */
  async flushPendingCommit(): Promise<string | null> {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    return this.commitAll(this.takePendingMessage());
  }

  /** Start the periodic pull. No-op without a remote or with an interval of 0. */
  startAutoPull(intervalMs?: number): boolean {
    if (this.disposed) return false;
    if (this.pullTimer !== null) return true;
    const interval = intervalMs ?? this.autopullMs;
    if (interval <= 0) return false;
    if (this.remote === null) return false;

    this.pullTimer = setInterval(() => {
      void this.autoPullTick();
    }, interval);
    this.pullTimer.unref?.();
    return true;
  }

  /**
   * Push the branch shortly after a commit, so the remote follows the editor without anyone
   * pressing Sync. Bursts coalesce into one push. No-op without a remote or with an interval of 0.
   */
  schedulePush(): void {
    if (this.disposed || this.remote === null || this.autopushMs <= 0) return;
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.autoPushTick();
    }, this.autopushMs);
    this.pushTimer.unref?.();
  }

  /** Cancel any pending debounce and push right now. Used by shutdown. */
  async flushPendingPush(): Promise<boolean> {
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    if (this.remote === null || this.autopushMs <= 0) return false;
    const result = await this.push();
    return result.pushed;
  }

  /** Stop the periodic pull. The engine stays usable. */
  stop(): void {
    if (this.pullTimer === null) return;
    clearInterval(this.pullTimer);
    this.pullTimer = null;
  }

  /** Clear every timer. The engine accepts no more scheduled work after this. */
  dispose(): void {
    this.disposed = true;
    this.stop();
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }

  /** Commit anything still pending, wait for queued git work, then dispose. */
  async close(): Promise<void> {
    const hadPendingCommit = this.commitTimer !== null;
    const hadPendingPush = this.pushTimer !== null;
    this.dispose();
    if (hadPendingCommit) {
      try {
        await this.commitAllUnlockedThroughMutex();
      } catch (err) {
        this.logger.error('final commit failed', { error: describeGitError(err) });
      }
    }
    // dispose() already refused any new push, so the last commit needs one here.
    if (this.autopushMs > 0 && (hadPendingCommit || hadPendingPush)) {
      try {
        await this.push();
      } catch (err) {
        this.logger.warn('final push failed', { error: describeGitError(err) });
      }
    }
    await this.mutex.drain();
  }

  /** Resolve once every queued git operation has finished. Used by shutdown and by tests. */
  async whenIdle(): Promise<void> {
    await this.mutex.drain();
  }

  // -------------------------------------------------------------------------
  // init helpers
  // -------------------------------------------------------------------------

  private async initUnlocked(): Promise<InitResult> {
    const git = await this.git();
    let created = false;
    let cloned = false;

    if (!(await pathExists(join(this.contentDir, '.git')))) {
      if (this.remote !== null && (await isEmptyDir(this.contentDir))) {
        cloned = await this.tryClone(git);
      }
      if (!cloned) {
        await git.raw(['init']);
        // symbolic-ref works on every git version, unlike `init --initial-branch`.
        await git.raw(['symbolic-ref', 'HEAD', `refs/heads/${this.branch}`]);
        created = true;
      }
    }

    await this.applyLocalConfig(git);
    await this.ensureRemote(git);
    // A save writes its bytes beside the page and renames them over it. `git add -A` runs on a
    // timer of its own, so without this line it could stage one of those files by chance.
    await this.appendExcludeLine(TEMP_FILE_EXCLUDE_LINE);

    const wroteAttributes = await this.ensureGitattributes();

    if (created) {
      await git.raw(['add', '-A']);
      const staged = await this.stagedFiles();
      if (staged.length > 0) {
        await this.runCommit(git, INITIAL_COMMIT_MESSAGE);
      }
    }
    // An adopted repo only gains the attributes commit; its other pending work stays untouched.
    if (!created && wroteAttributes) {
      await this.commitGitattributes(git);
    }

    const branch = await this.currentBranch();
    this.logger.info('content repo ready', {
      contentDir: this.contentDir,
      branch,
      created,
      cloned,
      remote: this.remote,
    });
    return { created, cloned, branch };
  }

  private async tryClone(git: SimpleGit): Promise<boolean> {
    if (this.remote === null) return false;
    try {
      await git.clone(this.remote, '.');
    } catch (err) {
      this.logger.warn('clone failed, starting an empty content repo instead', {
        remote: this.remote,
        error: describeGitError(err),
      });
      return false;
    }

    await this.checkoutBranchAfterClone(git);
    return true;
  }

  private async checkoutBranchAfterClone(git: SimpleGit): Promise<void> {
    const current = await this.currentBranch();
    if (current === this.branch) return;

    const remoteRef = `refs/remotes/origin/${this.branch}`;
    if (await this.refExists(remoteRef)) {
      await git.raw(['checkout', '-B', this.branch, remoteRef]);
      await git.raw(['branch', `--set-upstream-to=origin/${this.branch}`, this.branch]).catch(() => '');
      return;
    }
    if (!(await this.hasHead())) {
      await git.raw(['symbolic-ref', 'HEAD', `refs/heads/${this.branch}`]);
      return;
    }
    await git.raw(['checkout', '-B', this.branch]);
  }

  private async applyLocalConfig(git: SimpleGit): Promise<void> {
    const entries: Array<[string, string]> = [
      ['user.name', this.authorName],
      ['user.email', this.authorEmail],
      // A user's global signing or CRLF settings must never break the server's own commits.
      ['commit.gpgsign', 'false'],
      ['tag.gpgsign', 'false'],
      ['core.autocrlf', 'false'],
      ['core.quotePath', 'false'],
      ['pull.rebase', 'true'],
    ];
    for (const [key, value] of entries) {
      await git.raw(['config', '--local', key, value]);
    }
  }

  private async ensureRemote(git: SimpleGit): Promise<void> {
    if (this.remote === null) return;
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((entry) => entry.name === 'origin');
    if (origin === undefined) {
      await git.raw(['remote', 'add', 'origin', this.remote]);
      return;
    }
    if (origin.refs.fetch !== this.remote) {
      await git.raw(['remote', 'set-url', 'origin', this.remote]);
    }
  }

  /** Returns true when the file was missing and had to be written. */
  private async ensureGitattributes(): Promise<boolean> {
    const target = join(this.contentDir, GITATTRIBUTES_NAME);
    if (await pathExists(target)) return false;
    await writeFile(target, GITATTRIBUTES_CONTENT, 'utf8');
    return true;
  }

  private async commitGitattributes(git: SimpleGit): Promise<void> {
    try {
      await git.raw(['add', '--', GITATTRIBUTES_NAME]);
      await git.raw([
        'commit',
        '--no-verify',
        '-m',
        GITATTRIBUTES_COMMIT_MESSAGE,
        '--only',
        '--',
        GITATTRIBUTES_NAME,
      ]);
    } catch (err) {
      // Not fatal: the file stays staged and the next commit picks it up.
      this.logger.warn('could not commit .gitattributes on its own', {
        error: describeGitError(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // commit
  // -------------------------------------------------------------------------

  private async commitAllUnlocked(message?: string): Promise<string | null> {
    const git = await this.git();
    await this.throughIndexLock(() => git.raw(['add', '-A']));
    const staged = await this.stagedFiles();
    if (staged.length === 0) return null;

    await this.runCommit(git, message ?? defaultCommitMessage(staged));
    // Every commit, from a save or from a conflict resolution, heads for the remote.
    this.schedulePush();
    return (await git.raw(['rev-parse', 'HEAD'])).trim();
  }

  private async commitAllUnlockedThroughMutex(): Promise<string | null> {
    return this.mutex.runExclusive(() => this.commitAllUnlocked());
  }

  private async runCommit(git: SimpleGit, message: string): Promise<void> {
    try {
      await this.throughIndexLock(() => git.raw(['commit', '--no-verify', '-m', message]));
    } catch (err) {
      throw gitError(`Commit failed: ${describeGitError(err)}`, err);
    }
  }

  /** Run a git command that takes `.git/index.lock`, waiting out a lock another process holds. */
  private async throughIndexLock<T>(task: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await task();
      } catch (err) {
        if (attempt >= INDEX_LOCK_ATTEMPTS || !isIndexLockError(err)) throw err;
        this.logger.warn('the git index is locked, waiting', { attempt });
        await delay(INDEX_LOCK_WAIT_MS * attempt);
      }
    }
  }

  private async runScheduledCommit(): Promise<void> {
    try {
      const sha = await this.commitAll(this.takePendingMessage());
      if (sha !== null) this.logger.info('auto commit', { sha });
    } catch (err) {
      this.logger.error('auto commit failed', { error: describeGitError(err) });
    }
  }

  // -------------------------------------------------------------------------
  // pull / push
  // -------------------------------------------------------------------------

  private async pullUnlocked(): Promise<PullResult> {
    if (this.remote === null) return { pulled: 0, files: [], reason: 'no-remote' };
    const git = await this.git();

    try {
      await git.raw(['fetch', '--prune', 'origin']);
    } catch (err) {
      throw gitError(`Fetch failed: ${describeGitError(err)}`, err);
    }

    // A rebase refuses to run over a dirty tree, so local edits become a commit first. Page saves
    // write to disk without holding the git mutex, so one can land right after the commit and
    // dirty the tree again. Commit and re-check a few times instead of failing the whole pull.
    for (let attempt = 0; attempt < PRE_PULL_COMMIT_ATTEMPTS; attempt += 1) {
      const saved = await this.commitAllUnlocked(PRE_PULL_COMMIT_MESSAGE);
      if (saved !== null) this.logger.info('committed local edits before pull', { sha: saved });
      if ((await this.dirtyFiles()).length === 0) break;
    }

    const upstream = await this.upstreamRef();
    if (upstream === null) return { pulled: 0, files: [], reason: 'up-to-date' };

    if (!(await this.hasHead())) return this.adoptUpstream(git, upstream);

    const { behind } = await this.aheadBehind(upstream);
    if (behind === 0) {
      this.conflictState = null;
      return { pulled: 0, files: [], reason: 'up-to-date' };
    }

    const before = await this.headSha();
    try {
      await git.raw(['rebase', upstream]);
    } catch (err) {
      throw await this.recoverFromFailedRebase(git, before, err);
    }

    this.conflictState = null;
    const after = await this.headSha();
    const files = splitLines(await git.raw(['diff', '--name-only', before, after]).catch(() => ''));
    this.logger.info('pulled from remote', { pulled: behind, files: files.length });
    return { pulled: behind, files, reason: 'pulled' };
  }

  private async conflictVersionsUnlocked(files: string[]): Promise<ConflictVersions[]> {
    const git = await this.git();
    const upstream = await this.upstreamRef();
    if (upstream === null) return [];
    const base = await this.mergeBase(upstream);

    const versions: ConflictVersions[] = [];
    for (const file of files) {
      versions.push({
        file,
        local: (await this.showOrNull(git, 'HEAD', file)) ?? '',
        remote: (await this.showOrNull(git, upstream, file)) ?? '',
        base: base === null ? '' : ((await this.showOrNull(git, base, file)) ?? ''),
      });
    }
    return versions;
  }

  private async mergeBase(upstream: string): Promise<string | null> {
    const git = await this.git();
    const sha = (await git.raw(['merge-base', 'HEAD', upstream]).catch(() => '')).trim();
    return SHA_RE.test(sha) ? sha : null;
  }

  private async resolveConflictUnlocked(
    files: ConflictResolution[],
    message?: string,
  ): Promise<string[]> {
    if (this.remote === null) throw gitError('Cannot resolve conflicts without a remote.');
    const git = await this.git();
    const upstream = await this.upstreamRef();
    if (upstream === null) throw gitError('Cannot resolve conflicts: the remote branch is gone.');

    // Anything typed since the failed pull would otherwise block the merge.
    await this.commitAllUnlocked(PRE_PULL_COMMIT_MESSAGE);
    const before = await this.headSha();

    // The merge is expected to conflict. Its value is MERGE_HEAD, which turns the resolution
    // into a real merge commit instead of a commit that silently drops the remote history.
    await git.raw(['merge', '--no-commit', '--no-ff', upstream]).catch(() => '');

    try {
      // Only a file git itself reported as conflicted may be rewritten from a request body.
      const allowed = new Set(this.conflictState?.files ?? (await this.conflictedFiles()));
      if (allowed.size === 0) throw gitError('There is no conflict to resolve.');
      // Check every entry before the first write, so a refused batch changes nothing.
      const targets = files.map((entry) => {
        const rel = this.toRepoPath(entry.file);
        if (!allowed.has(rel)) {
          throw validation(`${entry.file} is not one of the conflicted files`);
        }
        return { rel, content: entry.content };
      });

      for (const entry of targets) {
        const target = join(this.contentDir, entry.rel);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, entry.content, 'utf8');
      }
      await git.raw(['add', '-A']);

      const stillConflicted = await this.conflictedFiles();
      if (stillConflicted.length > 0) {
        throw gitError(`Unresolved conflicts remain in ${stillConflicted.join(', ')}`, {
          conflicted: stillConflicted,
        });
      }
      const staged = await this.stagedFiles();
      if (staged.length > 0 || (await this.inMerge())) {
        await this.runCommit(git, message ?? RESOLVE_COMMIT_MESSAGE);
      }
    } catch (err) {
      await git.raw(['merge', '--abort']).catch(() => '');
      await git.raw(['reset', '--hard', before]).catch(() => '');
      throw err;
    }

    this.conflictState = null;
    const after = await this.headSha();
    const changed = splitLines(
      await git.raw(['diff', '--name-only', before, after]).catch(() => ''),
    );
    this.logger.info('resolved pull conflict', { files: changed.length });
    return changed;
  }

  /** No local commits yet: take the remote branch wholesale. */
  private async adoptUpstream(git: SimpleGit, upstream: string): Promise<PullResult> {
    const files = splitLines(await git.raw(['ls-tree', '-r', '--name-only', upstream]).catch(() => ''));
    await git.raw(['reset', '--hard', upstream]);
    const pulled = Number(splitLines(await git.raw(['rev-list', '--count', upstream]))[0] ?? '0') || 0;
    return { pulled, files, reason: pulled > 0 ? 'pulled' : 'up-to-date' };
  }

  /**
   * Read the conflicts, abort, and make sure nothing is left half-rebased. Returns the error to
   * throw so the caller keeps a single exit point.
   */
  private async recoverFromFailedRebase(
    git: SimpleGit,
    before: string,
    cause: unknown,
  ): Promise<Error> {
    const conflicted = await this.conflictedFiles();

    await git.raw(['rebase', '--abort']).catch(() => '');
    if (await this.inRebase()) {
      await git.raw(['rebase', '--quit']).catch(() => '');
      await git.raw(['reset', '--hard', before]).catch(() => '');
    }

    const detail =
      conflicted.length > 0
        ? `conflicting changes in ${conflicted.join(', ')}`
        : describeGitError(cause);
    const message = `Pull failed: ${detail}. The rebase was aborted and the content repo is unchanged.`;
    this.logger.warn('pull aborted', { conflicted, error: describeGitError(cause) });
    // Kept so the app can offer a resolution instead of only reporting the failure.
    this.conflictState =
      conflicted.length > 0
        ? { files: conflicted, message, at: new Date().toISOString() }
        : null;
    return gitError(message, { conflicted });
  }

  private async pushUnlocked(): Promise<PushResult> {
    if (this.remote === null) return { pushed: false, reason: 'no-remote' };
    const git = await this.git();
    if (!(await this.hasHead())) return { pushed: false, reason: 'no-commits' };

    const branch = await this.currentBranch();
    if (branch.startsWith(DETACHED_PREFIX)) {
      throw gitError('Push failed: the content repo has a detached HEAD, so there is no branch to push.');
    }

    const upstream = await this.upstreamRef();
    if (upstream !== null) {
      const { ahead } = await this.aheadBehind(upstream);
      if (ahead === 0) return { pushed: false, reason: 'up-to-date' };
    }

    try {
      await git.raw(['push', '--set-upstream', 'origin', `${branch}:${branch}`]);
    } catch (err) {
      throw gitError(`Push failed: ${describeGitError(err)}`, err);
    }
    this.logger.info('pushed to remote', { branch, remote: this.remote });
    return { pushed: true, reason: 'pushed' };
  }

  /**
   * A push rejected because the branch moved on the remote is not an error: pull, then push
   * again. A second failure is left for the next commit or for the Sync button.
   */
  private async autoPushTick(): Promise<void> {
    if (this.autoPushRunning) return;
    this.autoPushRunning = true;
    try {
      const result = await this.push();
      if (result.pushed) this.logger.info('auto pushed to remote', { remote: this.remote });
    } catch (err) {
      this.logger.warn('auto push failed, pulling first', { error: describeGitError(err) });
      try {
        await this.pull();
        const retry = await this.push();
        if (retry.pushed) this.logger.info('auto pushed to remote after a pull', { remote: this.remote });
      } catch (retryErr) {
        this.logger.warn('auto push failed', { error: describeGitError(retryErr) });
      }
    } finally {
      this.autoPushRunning = false;
    }
  }

  private async autoPullTick(): Promise<void> {
    if (this.autoPullRunning) return;
    this.autoPullRunning = true;
    try {
      const result = await this.pull();
      if (result.pulled > 0) this.logger.info('auto pull applied commits', { pulled: result.pulled });
    } catch (err) {
      // A failing pull must never take the server down.
      this.logger.warn('auto pull failed', { error: describeGitError(err) });
    } finally {
      this.autoPullRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // low level git helpers
  // -------------------------------------------------------------------------

  private async git(): Promise<SimpleGit> {
    if (this.client !== null) return this.client;
    await mkdir(this.contentDir, { recursive: true });
    const client = simpleGit({
      baseDir: this.contentDir,
      binary: 'git',
      maxConcurrentProcesses: 1,
      trimmed: false,
      config: [
        'core.quotePath=false',
        // Read-only commands then never take .git/index.lock, so status can run during a push.
        'core.optionalLocks=false',
        'commit.gpgsign=false',
        'advice.detachedHead=false',
      ],
      // Self-hosted deployments authenticate with a deploy key, so these two stay inherited.
      unsafe: { allowUnsafeSshCommand: true, allowUnsafeAskPass: true },
    });
    client.env(gitChildEnv(process.env));
    this.client = client;
    return client;
  }

  private async currentBranch(): Promise<string> {
    const git = await this.git();
    try {
      const name = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
      if (name.length > 0) return name;
    } catch {
      // Detached HEAD falls through.
    }
    try {
      const sha = (await git.raw(['rev-parse', '--short', 'HEAD'])).trim();
      if (sha.length > 0) return `${DETACHED_PREFIX}${sha}`;
    } catch {
      // No commits yet.
    }
    return this.branch;
  }

  private async dirtyFiles(): Promise<string[]> {
    const git = await this.git();
    try {
      const status = await git.status();
      const paths = status.files.map((file) => file.path);
      for (const rename of status.renamed) {
        paths.push(rename.from, rename.to);
      }
      return unique(paths.filter((path) => path.length > 0)).sort();
    } catch {
      // Not a repo yet: status must still answer instead of failing the whole request.
      return [];
    }
  }

  /** The origin URL, washed of credentials. Every git command still uses `this.remote`. */
  private async remoteUrl(git: SimpleGit): Promise<string | null> {
    try {
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((entry) => entry.name === 'origin');
      const url = origin?.refs.fetch ?? origin?.refs.push ?? '';
      if (url.length > 0) return redactRemoteUrl(url);
    } catch {
      // Not a repo yet.
    }
    return redactRemoteUrl(this.remote);
  }

  private async lastCommit(): Promise<Revision | null> {
    const git = await this.git();
    try {
      const raw = await git.raw(['log', '--max-count=1', `--format=${LOG_FORMAT}`]);
      return parseLog(raw)[0] ?? null;
    } catch {
      return null;
    }
  }

  private async hasHead(): Promise<boolean> {
    return this.refExists('HEAD');
  }

  private async refExists(ref: string): Promise<boolean> {
    const git = await this.git();
    try {
      // `--quiet` makes git exit 1 with no stderr, which simple-git reports as an empty
      // success, so the output itself is what decides.
      const out = await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return SHA_RE.test(out.trim());
    } catch {
      return false;
    }
  }

  private async headSha(): Promise<string> {
    const git = await this.git();
    return (await git.raw(['rev-parse', 'HEAD'])).trim();
  }

  /** The remote-tracking ref this branch compares against, or null when it does not exist yet. */
  private async upstreamRef(): Promise<string | null> {
    const branch = await this.currentBranch();
    const candidates = unique([
      `refs/remotes/origin/${branch}`,
      `refs/remotes/origin/${this.branch}`,
    ]);
    for (const ref of candidates) {
      if (await this.refExists(ref)) return ref;
    }
    return null;
  }

  private async aheadBehind(upstream: string): Promise<{ ahead: number; behind: number }> {
    if (!(await this.hasHead())) return { ahead: 0, behind: 0 };
    const git = await this.git();
    try {
      const raw = await git.raw(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
      const parts = raw.trim().split(/\s+/);
      return {
        ahead: Number(parts[0] ?? '0') || 0,
        behind: Number(parts[1] ?? '0') || 0,
      };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  private async stagedFiles(): Promise<string[]> {
    const git = await this.git();
    const args = (await this.hasHead())
      ? ['diff', '--cached', '--name-only']
      : ['ls-files', '--cached'];
    return unique(splitLines(await git.raw(args)));
  }

  private async conflictedFiles(): Promise<string[]> {
    const git = await this.git();
    const fromDiff = splitLines(
      await git.raw(['diff', '--name-only', '--diff-filter=U']).catch(() => ''),
    );
    if (fromDiff.length > 0) return unique(fromDiff).sort();

    const unmerged = await git.raw(['ls-files', '--unmerged']).catch(() => '');
    const paths = splitLines(unmerged)
      .map((line) => line.split('\t')[1] ?? '')
      .filter((path) => path.length > 0);
    return unique(paths).sort();
  }

  private async inMerge(): Promise<boolean> {
    const git = await this.git();
    const raw = await git.raw(['rev-parse', '--git-path', 'MERGE_HEAD']).catch(() => '');
    const relOrAbs = raw.trim();
    if (relOrAbs.length === 0) return false;
    return pathExists(isAbsolute(relOrAbs) ? relOrAbs : join(this.contentDir, relOrAbs));
  }

  private async inRebase(): Promise<boolean> {
    const git = await this.git();
    for (const marker of ['rebase-merge', 'rebase-apply']) {
      const raw = await git.raw(['rev-parse', '--git-path', marker]).catch(() => '');
      const relOrAbs = raw.trim();
      if (relOrAbs.length === 0) continue;
      const target = isAbsolute(relOrAbs) ? relOrAbs : join(this.contentDir, relOrAbs);
      if (await pathExists(target)) return true;
    }
    return false;
  }

  /** Normalize any caller-supplied file path into a repo-relative POSIX path. */
  private toRepoPath(input: string, label = 'file path'): string {
    if (typeof input !== 'string' || input.trim().length === 0) {
      throw validation(`Invalid ${label}: ${JSON.stringify(input)}`);
    }
    const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '');
    const absolute = isAbsolute(normalized)
      ? resolve(normalized)
      : resolve(this.contentDir, normalized);
    const rel = relative(this.contentDir, absolute);
    if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw validation(`Invalid ${label}: ${JSON.stringify(input)}`);
    }
    const parts = rel.split(sep);
    // git's own metadata is code, not content. `.gitattributes` and `.gitignore` still pass.
    if (parts.some((segment) => segment.toLowerCase() === '.git')) {
      throw validation(`Invalid ${label}: ${JSON.stringify(input)}`);
    }
    return parts.join('/');
  }
}

/** Guard against a revision string that git would read as an option. */
function assertRevision(sha: string): string {
  if (typeof sha !== 'string' || !REVISION_RE.test(sha)) {
    throw validation(`Invalid revision: ${JSON.stringify(sha)}`);
  }
  return sha;
}
