/**
 * The slices of the REST payloads the e2e suite reads. They are copied rather than imported
 * from @tablinum/shared on purpose: the suite is a black-box client of the running server.
 */

export interface Space {
  slug: string;
  name: string;
  icon?: string;
  order?: number;
}

export interface TreeNode {
  id: string;
  path: string;
  title: string;
  icon?: string;
  order?: number;
  children: TreeNode[];
}

export interface SpaceTree extends Space {
  tree: TreeNode[];
}

export interface Page {
  id: string;
  path: string;
  space: string;
  title: string;
  icon?: string;
  order?: number;
  created: string;
  updated: string;
  markdown: string;
  rev: string;
  filePath: string;
  hasChildren: boolean;
}

export type PageSummary = Omit<Page, 'markdown' | 'rev'>;

export interface Account {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthState {
  setupRequired: boolean;
  user: Account | null;
}

export interface Revision {
  sha: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirtyFiles: string[];
  remote: string | null;
  lastCommit: Revision | null;
  conflict: { files: string[]; message: string; at: string } | null;
}

export interface CreatePageInput {
  path: string;
  title: string;
  markdown?: string;
  icon?: string;
  order?: number;
}

export interface UpdatePageInput {
  title?: string;
  markdown?: string;
  icon?: string | null;
  order?: number | null;
  path?: string;
  baseRev?: string;
}
