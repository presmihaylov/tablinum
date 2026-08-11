import { useCallback, useState, type DragEvent, type MouseEvent } from 'react';
import { depth as pathDepth } from '@tablinum/shared';
import type { PagePath, TreeNode } from '@tablinum/shared';
import { sortNodes } from '../../lib/tree';
import type { DropPosition } from '../../lib/treeMove';
import type { TriggerBox } from '../../lib/menuPlacement';
import { useContent } from '../../lib/content';
import { useAuth } from '../../lib/auth';
import { PageIcon } from '../ui/PageIcon';
import { ContextMenu, type MenuItem } from '../ui/Overlay';
import { ChevronRight, Copy, Dots, Link, MoveTo, Pencil, Plus, Star, Trash } from '../ui/Icon';
import { useTreeDrag, type DropState } from './TreeDrag';

const DRAG_MIME = 'application/x-tablinum-page';

interface PageTreeProps {
  nodes: TreeNode[];
  expanded: Set<string>;
  currentPath: PagePath;
  onToggle: (path: PagePath) => void;
  onExpand: (path: PagePath) => void;
  onOpen: (path: PagePath) => void;
}

interface MenuState {
  /** The button that asked for the menu, or the bare spot a right-click hit. */
  at: TriggerBox;
  node: TreeNode;
}

export function PageTree({ nodes, expanded, currentPath, onToggle, onExpand, onOpen }: PageTreeProps) {
  const {
    movePage,
    moveToSpace,
    newPage,
    renamePage,
    duplicatePage,
    deletePage,
    copyLink,
    editSpace,
    isFavorite,
    toggleFavorite,
    spaces,
  } = useContent();
  const { user } = useAuth();

  // The server lets an admin rename any shared space, and lets an owner rename their own private
  // one. A private space nobody else can see is never in this tree, so an owner is always me.
  const canEditSpace = useCallback(
    (slug: string): boolean => {
      if (user?.role === 'admin') return true;
      return spaces.find((space) => space.slug === slug)?.owner !== undefined;
    },
    [user, spaces],
  );
  const { dragPath, setDragPath, drop, setDrop } = useTreeDrag();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const handleDrop = useCallback(
    (targetPath: PagePath, position: DropPosition, sourcePath: PagePath) => {
      setDrop(null);
      setDragPath(null);
      if (sourcePath === targetPath) return;
      if (position === 'inside') onExpand(targetPath);
      movePage(sourcePath, targetPath, position);
    },
    [movePage, onExpand, setDrop, setDragPath],
  );

  const menuItems = useCallback(
    (node: TreeNode): MenuItem[] => {
      const pinned = isFavorite(node.id);
      const items: MenuItem[] = [
        {
          id: 'favorite',
          label: pinned ? 'Remove from favorites' : 'Add to favorites',
          icon: <Star filled={pinned} />,
          onSelect: () => toggleFavorite(node),
        },
        { id: 'new', label: 'New child page', icon: <Plus />, onSelect: () => newPage(node.path) },
        { id: 'rename', label: 'Rename', icon: <Pencil />, onSelect: () => renamePage(node) },
        { id: 'duplicate', label: 'Duplicate', icon: <Copy />, onSelect: () => duplicatePage(node) },
      ];
      // A space home page owns its space, so it can never move into another one.
      if (pathDepth(node.path) > 1) {
        items.push({ id: 'move', label: 'Move to space', icon: <MoveTo />, onSelect: () => moveToSpace(node) });
      }
      if (pathDepth(node.path) === 1 && canEditSpace(node.path)) {
        items.push({ id: 'space', label: 'Edit space', icon: <Pencil />, onSelect: () => editSpace(node.path) });
      }
      items.push(
        { id: 'link', label: 'Copy link', icon: <Link />, onSelect: () => copyLink(node.path) },
        { id: 'delete', label: 'Delete', icon: <Trash />, danger: true, onSelect: () => deletePage(node) },
      );
      return items;
    },
    [
      isFavorite,
      toggleFavorite,
      newPage,
      renamePage,
      duplicatePage,
      moveToSpace,
      editSpace,
      canEditSpace,
      copyLink,
      deletePage,
    ],
  );

  return (
    <>
      <ul className="tree" role="tree">
        {sortNodes(nodes).map((node) => (
          <TreeItem
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            currentPath={currentPath}
            dragPath={dragPath}
            drop={drop}
            onToggle={onToggle}
            onOpen={onOpen}
            onDragPath={setDragPath}
            onDropState={setDrop}
            onDropPage={handleDrop}
            onMenu={setMenu}
            onNewChild={newPage}
          />
        ))}
      </ul>

      {menu ? (
        <ContextMenu
          label="Page options"
          anchor={menu.at}
          items={menuItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  currentPath: PagePath;
  dragPath: PagePath | null;
  drop: DropState | null;
  onToggle: (path: PagePath) => void;
  onOpen: (path: PagePath) => void;
  onDragPath: (path: PagePath | null) => void;
  onDropState: (state: DropState | null) => void;
  onDropPage: (targetPath: PagePath, position: DropPosition, sourcePath: PagePath) => void;
  onMenu: (state: MenuState) => void;
  onNewChild: (parent: PagePath) => void;
}

function positionFromEvent(event: DragEvent<HTMLDivElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = rect.height === 0 ? 0.5 : (event.clientY - rect.top) / rect.height;
  if (ratio < 0.28) return 'before';
  if (ratio > 0.72) return 'after';
  return 'inside';
}

function TreeItem(props: TreeItemProps) {
  const { node, depth, expanded, currentPath, dragPath, drop, onToggle, onOpen } = props;
  const isOpen = expanded.has(node.path);
  const isCurrent = currentPath === node.path;
  const hasChildren = node.children.length > 0;
  const dropHere = drop?.path === node.path ? drop.position : null;

  const rowClass = [
    'tree-row',
    isCurrent ? 'tree-row--current' : '',
    dragPath === node.path ? 'tree-row--dragging' : '',
    dropHere ? `tree-row--drop-${dropHere}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData(DRAG_MIME, node.path);
    event.dataTransfer.setData('text/plain', node.path);
    event.dataTransfer.effectAllowed = 'move';
    props.onDragPath(node.path);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!dragPath) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const position = positionFromEvent(event);
    if (drop?.path === node.path && drop.position === position) return;
    props.onDropState({ path: node.path, position });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const source = event.dataTransfer.getData(DRAG_MIME) || dragPath;
    if (!source) return;
    props.onDropPage(node.path, positionFromEvent(event), source);
  };

  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const { clientX, clientY } = event;
    props.onMenu({ at: { top: clientY, bottom: clientY, left: clientX, right: clientX }, node });
  };

  return (
    <li className="tree-node" role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <div
        className={rowClass}
        style={{ paddingLeft: `${depth * 0.75 + 0.375}rem` }}
        draggable
        onDragStart={onDragStart}
        onDragEnd={() => {
          props.onDragPath(null);
          props.onDropState(null);
        }}
        onDragOver={onDragOver}
        onDragLeave={() => {
          if (drop?.path === node.path) props.onDropState(null);
        }}
        onDrop={onDrop}
        onContextMenu={onContextMenu}
        onClick={() => onOpen(node.path)}
      >
        <button
          type="button"
          className={hasChildren ? 'tree-row__twisty' : 'tree-row__twisty tree-row__twisty--empty'}
          onClick={(event) => {
            event.stopPropagation();
            if (!hasChildren) return;
            onToggle(node.path);
          }}
          tabIndex={-1}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
        >
          <ChevronRight size={12} className={isOpen ? 'tree-row__chevron tree-row__chevron--open' : 'tree-row__chevron'} />
        </button>

        <span className="tree-row__icon">
          <PageIcon icon={node.icon} />
        </span>
        <span className="tree-row__title">{node.title}</span>

        <span className="tree-row__actions">
          <button
            type="button"
            className="tree-row__action"
            aria-label={`Page options for ${node.title}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onMenu({ at: event.currentTarget.getBoundingClientRect(), node });
            }}
          >
            <Dots size={12} />
          </button>
          <button
            type="button"
            className="tree-row__action"
            aria-label={`Add a page inside ${node.title}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onNewChild(node.path);
            }}
          >
            <Plus size={12} />
          </button>
        </span>
      </div>

      {isOpen && hasChildren ? (
        <ul className="tree" role="group">
          {sortNodes(node.children).map((child) => (
            <TreeItem {...props} key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
