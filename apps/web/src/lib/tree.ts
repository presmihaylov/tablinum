import { parentPath, segments } from '@tablinum/shared';
import type { PagePath, TreeNode, TreeResponse } from '@tablinum/shared';

/** One space plus its page tree, exactly as GET /api/v1/tree returns it. */
export type SpaceTree = TreeResponse['spaces'][number];

/** Sibling order: explicit `order` first, then title, as the content format specifies. */
export function sortNodes(nodes: readonly TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
    const bo = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });
}

export function findNode(spaces: readonly SpaceTree[], path: PagePath): TreeNode | null {
  for (const space of spaces) {
    const hit = findInNodes(space.tree, path);
    if (hit) return hit;
  }
  return null;
}

function findInNodes(nodes: readonly TreeNode[], path: PagePath): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (path === node.path || path.startsWith(`${node.path}/`)) {
      const deeper = findInNodes(node.children, path);
      if (deeper) return deeper;
    }
  }
  return null;
}

/**
 * Children of a container path. A space slug with no page of its own still holds
 * the space's top-level nodes, so both shapes of tree resolve.
 */
export function childrenOf(spaces: readonly SpaceTree[], parent: PagePath): TreeNode[] {
  const node = findNode(spaces, parent);
  if (node) return sortNodes(node.children);
  const space = spaces.find((candidate) => candidate.slug === parent);
  if (space) return sortNodes(space.tree);
  return [];
}

export function flattenTree(spaces: readonly SpaceTree[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  for (const space of spaces) walk(space.tree);
  return out;
}

/** Every ancestor path of `path`, outermost first, excluding the path itself. */
export function ancestorPaths(path: PagePath): PagePath[] {
  const parts = segments(path);
  const out: PagePath[] = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'));
  return out;
}

/** Breadcrumb entries for a path, using tree titles where they are known. */
export function breadcrumbFor(spaces: readonly SpaceTree[], path: PagePath): Array<{ path: PagePath; title: string }> {
  const crumbs: Array<{ path: PagePath; title: string }> = [];
  const parts = segments(path);
  for (let i = 0; i < parts.length; i += 1) {
    const crumbPath = parts.slice(0, i + 1).join('/');
    const node = findNode(spaces, crumbPath);
    const space = spaces.find((candidate) => candidate.slug === crumbPath);
    crumbs.push({ path: crumbPath, title: node?.title ?? space?.name ?? parts[i] ?? crumbPath });
  }
  return crumbs;
}

/** The space that owns a path, or null when nothing matches. */
export function spaceForPath(spaces: readonly SpaceTree[], path: PagePath | undefined): SpaceTree | null {
  if (!path) return null;
  const slug = segments(path)[0];
  return spaces.find((space) => space.slug === slug) ?? null;
}

/** Parent container of a node: its parent page, or the space slug at the top level. */
export function containerOf(node: TreeNode): PagePath {
  return parentPath(node.path) ?? node.path;
}
