/** Stable page identifier: "pg_" + ULID. Never changes across renames or moves. */
export type PageId = string;

/** Slash-joined page path, e.g. "eng/runbooks/deploy". No leading or trailing slash. */
export type PagePath = string;

/** YAML frontmatter block at the top of every page file. */
export interface Frontmatter {
  id: PageId;
  title: string;
  icon?: string;
  order?: number;
  created: string; // ISO
  updated: string; // ISO
}

/** A page: its frontmatter, its body and where it lives on disk. */
export interface Page {
  id: PageId;
  path: PagePath;
  space: string; // first path segment
  title: string;
  icon?: string;
  order?: number;
  created: string;
  updated: string;
  markdown: string; // body WITHOUT frontmatter
  /**
   * Fingerprint of `markdown`. A save sends the revision it started from, and the server
   * rejects it when the file has moved on since. See contentRev() in merge.ts.
   */
  rev: string;
  filePath: string; // absolute path on disk
  hasChildren: boolean;
}

/** A page without its body. Used by the list and tree endpoints. */
export type PageSummary = Omit<Page, 'markdown' | 'rev'>;

/** One node of the sidebar page tree. */
export interface TreeNode {
  id: PageId;
  path: PagePath;
  title: string;
  icon?: string;
  order?: number;
  children: TreeNode[];
}

/** A top-level content section, one directory under content/. */
export interface Space {
  slug: string;
  name: string;
  icon?: string;
  order?: number;
}

/** One result from the full-text index. */
export interface SearchHit {
  id: PageId;
  path: PagePath;
  title: string;
  snippet: string;
  score: number;
}

/** One git commit that touched a page. */
export interface Revision {
  sha: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

/** A pull that could not be rebased, kept until the operator resolves it. */
export interface GitConflict {
  /** Repo-relative files the rebase could not merge. */
  files: string[];
  message: string;
  /** ISO timestamp of the pull that failed. */
  at: string;
}

/** State of the content repo working tree and its remote. */
export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirtyFiles: string[];
  remote: string | null;
  lastCommit: Revision | null;
  /** Set while an upstream pull is blocked by conflicting local commits. */
  conflict: GitConflict | null;
}

/** One conflicted file, with every version needed to resolve it. */
export interface ConflictFile {
  /** Repo-relative file path. */
  file: string;
  /** The page it holds, when the file is a page. */
  path: PagePath | null;
  title: string | null;
  /** The version in the local branch. */
  local: string;
  /** The version on the remote branch. */
  remote: string;
  /** The version both branches started from. */
  base: string;
  /** Three-way merge of the three above, with conflict markers when it is not clean. */
  merged: string;
  clean: boolean;
}

/** A page that links to the page being inspected. */
export interface Backlink {
  id: PageId;
  path: PagePath;
  title: string;
}

/** Machine-readable error codes returned by the REST API. */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'GIT_ERROR'
  | 'INTERNAL';

/** What a 409 from PATCH /pages/:id carries, so the client can merge instead of guessing. */
export interface ConflictInfo {
  /** The body the server holds right now. */
  markdown: string;
  /** Its revision, to send back with the merged save. */
  rev: string;
  updated: string;
}

/** Error envelope: every non-2xx REST response has this shape. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Machine-readable context the client is expected to act on, e.g. a save conflict. */
    info?: ConflictInfo;
  };
}

/** Resolved, frozen runtime configuration. See loadConfig(). */
export interface Config {
  contentDir: string;
  port: number;
  apiTokens: string[];
  sessionSecret: string;
  gitRemote: string | null;
  gitBranch: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  autocommitMs: number;
  autopullMs: number;
  /** Quiet period after a commit before the branch is pushed. 0 disables the auto push. */
  autopushMs: number;
  /** Slack bot token (`xoxb-…`). Null disables the mention notifications. */
  slackBotToken: string | null;
  /** Origin tablinum is reached on, used for the page link in a notification. */
  publicUrl: string | null;
  /**
   * Trust `X-Forwarded-Proto` and `X-Forwarded-For`. A reverse proxy terminates TLS and
   * speaks plain http to tablinum, so without this the session cookie is never marked
   * `Secure` and every caller shares the proxy's IP.
   */
  trustProxy: boolean;
}
