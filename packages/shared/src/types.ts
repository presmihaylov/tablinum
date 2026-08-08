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
  filePath: string; // absolute path on disk
  hasChildren: boolean;
}

/** A page without its body. Used by the list and tree endpoints. */
export type PageSummary = Omit<Page, 'markdown'>;

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

/** State of the content repo working tree and its remote. */
export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirtyFiles: string[];
  remote: string | null;
  lastCommit: Revision | null;
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

/** Error envelope: every non-2xx REST response has this shape. */
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

/** Resolved, frozen runtime configuration. See loadConfig(). */
export interface Config {
  contentDir: string;
  port: number;
  apiTokens: string[];
  password: string | null;
  sessionSecret: string;
  gitRemote: string | null;
  gitBranch: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  autocommitMs: number;
  autopullMs: number;
  /** True when no token and no password are configured: the API is unauthenticated. */
  openMode: boolean;
}
