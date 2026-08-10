import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PagePath } from '@tablinum/shared';
import type { DropPosition } from '../../lib/treeMove';

/** The row a drag is hovering, and where the page would land on it. */
export interface DropState {
  path: PagePath;
  position: DropPosition;
}

export interface TreeDragValue {
  dragPath: PagePath | null;
  setDragPath: (path: PagePath | null) => void;
  drop: DropState | null;
  setDrop: (state: DropState | null) => void;
}

const TreeDragContext = createContext<TreeDragValue | null>(null);

/**
 * One drag state for every tree under it. The sidebar draws a tree per space, in two buckets, and
 * a drop is only accepted while a drag is in flight. Without this each tree would know about its
 * own drags alone, so a page could never cross into another space.
 */
export function TreeDragProvider({ children }: { children: ReactNode }) {
  const [dragPath, setDragPath] = useState<PagePath | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const value = useMemo<TreeDragValue>(
    () => ({ dragPath, setDragPath, drop, setDrop }),
    [dragPath, drop],
  );
  return <TreeDragContext.Provider value={value}>{children}</TreeDragContext.Provider>;
}

/** The shared drag state, or one of its own when the tree stands outside a provider. */
export function useTreeDrag(): TreeDragValue {
  const shared = useContext(TreeDragContext);
  const [dragPath, setDragPath] = useState<PagePath | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const own = useMemo<TreeDragValue>(
    () => ({ dragPath, setDragPath, drop, setDrop }),
    [dragPath, drop],
  );
  return shared ?? own;
}
