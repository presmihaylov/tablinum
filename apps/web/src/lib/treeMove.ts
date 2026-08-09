import { baseName, depth, isDescendantOf, parentPath, uniqueSlug } from '@gitdocs/shared';
import type { PageId, PagePath, TreeNode, UpdatePageBody } from '@gitdocs/shared';
import { childrenOf, findNode, sortNodes, type SpaceTree } from './tree';

/** Where a dragged row lands relative to the row it is dropped on. */
export type DropPosition = 'before' | 'after' | 'inside';

export interface MovePatch {
  id: PageId;
  body: UpdatePageBody;
}

/** Container the drop puts the page into. A space root page has no parent, so drops nest inside it. */
export function dropParentPath(target: TreeNode, position: DropPosition): PagePath {
  if (position === 'inside') return target.path;
  return parentPath(target.path) ?? target.path;
}

/**
 * Strictly increasing order values for a sibling list. Pages without an explicit
 * order borrow the slot after their predecessor, so midpoints are always well defined.
 */
export function effectiveOrders(nodes: readonly TreeNode[]): number[] {
  const orders: number[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    const previous = i === 0 ? null : orders[i - 1];
    const own = typeof node.order === 'number' ? node.order : null;
    if (previous === null || previous === undefined) {
      orders.push(own ?? 0);
      continue;
    }
    orders.push(Math.max(own ?? previous + 1, previous + 1));
  }
  return orders;
}

/** Order value that places a page at `index` of an already ordered sibling list. */
export function orderForIndex(orders: readonly number[], index: number): number {
  const before = index > 0 ? orders[index - 1] : undefined;
  const after = index < orders.length ? orders[index] : undefined;
  if (before === undefined) {
    if (after === undefined) return 0;
    return after - 1;
  }
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export interface MoveRequest {
  spaces: readonly SpaceTree[];
  sourcePath: PagePath;
  targetPath: PagePath;
  position: DropPosition;
}

/**
 * Translate a sidebar drop into the single PATCH that realises it.
 * Returns null when the drop is a no-op or would move a page inside itself.
 */
export function computeMove(request: MoveRequest): MovePatch | null {
  const { spaces, sourcePath, targetPath, position } = request;
  if (sourcePath === targetPath) return null;

  const source = findNode(spaces, sourcePath);
  const target = findNode(spaces, targetPath);
  if (!source || !target) return null;
  if (depth(source.path) === 1) return null; // a space home page cannot be re-parented

  const newParent = dropParentPath(target, position);
  if (newParent === source.path || isDescendantOf(newParent, source.path)) return null;

  const currentParent = parentPath(source.path);
  const siblings = sortNodes(childrenOf(spaces, newParent)).filter((node) => node.path !== source.path);

  let index = siblings.length;
  if (position !== 'inside') {
    const targetIndex = siblings.findIndex((node) => node.path === target.path);
    if (targetIndex >= 0) index = position === 'before' ? targetIndex : targetIndex + 1;
  }

  const order = orderForIndex(effectiveOrders(siblings), index);
  const body: UpdatePageBody = { order };

  if (currentParent !== newParent) {
    const taken = siblings.map((node) => baseName(node.path));
    body.path = `${newParent}/${uniqueSlug(baseName(source.path), taken)}`;
  }

  return { id: source.id, body };
}

export interface SpaceMoveRequest {
  spaces: readonly SpaceTree[];
  sourcePath: PagePath;
  spaceSlug: string;
}

/**
 * Translate "move this page to another space" into the single PATCH that realises it.
 * The page lands at the top level of the target space, after its last page.
 * Returns null when the space is unknown or the page already sits there.
 */
export function computeSpaceMove(request: SpaceMoveRequest): MovePatch | null {
  const { spaces, sourcePath, spaceSlug } = request;
  const source = findNode(spaces, sourcePath);
  if (!source) return null;
  if (depth(source.path) === 1) return null; // a space home page cannot be moved
  if (!spaces.some((space) => space.slug === spaceSlug)) return null;
  if (parentPath(source.path) === spaceSlug) return null; // already at the top of that space

  const siblings = sortNodes(childrenOf(spaces, spaceSlug)).filter((node) => node.path !== source.path);
  const taken = siblings.map((node) => baseName(node.path));
  const order = orderForIndex(effectiveOrders(siblings), siblings.length);

  return {
    id: source.id,
    body: { order, path: `${spaceSlug}/${uniqueSlug(baseName(source.path), taken)}` },
  };
}

/** Path a page gets when it is renamed inside its current parent. */
export function renamedPath(spaces: readonly SpaceTree[], path: PagePath, title: string): PagePath {
  const parent = parentPath(path);
  const container = parent ?? path;
  const taken = childrenOf(spaces, container)
    .filter((node) => node.path !== path)
    .map((node) => baseName(node.path));
  const slug = uniqueSlug(title, taken);
  if (!parent) return path; // space home pages keep their slug
  return `${parent}/${slug}`;
}

/** Path for a brand new child of `parent`, avoiding collisions with existing children. */
export function childPathFor(spaces: readonly SpaceTree[], parent: PagePath, title: string): PagePath {
  const taken = childrenOf(spaces, parent).map((node) => baseName(node.path));
  return `${parent}/${uniqueSlug(title, taken)}`;
}
