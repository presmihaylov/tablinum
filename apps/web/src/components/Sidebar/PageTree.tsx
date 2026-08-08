import { useCallback, useState, type DragEvent, type MouseEvent } from 'react';
import type { PagePath, TreeNode } from '@gitdocs/shared';
import { sortNodes } from '../../lib/tree';
import type { DropPosition } from '../../lib/treeMove';
import { useWorkspace } from '../../lib/workspace';
import { ContextMenu, type MenuItem } from '../ui/Overlay';
import { ChevronRight, Copy, DocIcon, Dots, Link, Pencil, Plus, Trash } from '../ui/Icon';

const DRAG_MIME = 'application/x-gitdocs-page';

interface PageTreeProps {
  nodes: TreeNode[];
  expanded: Set<string>;
  currentPath: PagePath;
  onToggle: (path: PagePath) => void;
  onExpand: (path: PagePath) => void;
  onOpen: (path: PagePath) => void;
}

interface DropState {
  path: PagePath;
  position: DropPosition;
}

interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}

export function PageTree({ nodes, expanded, currentPath, onToggle, onExpand, onOpen }: PageTreeProps) {
  const { movePage, newPage, renamePage, duplicatePage, deletePage, copyLink } = useWorkspace();
  const [dragPath, setDragPath] = useState<PagePath | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const handleDrop = useCallback(
    (targetPath: PagePath, position: DropPosition, sourcePath: PagePath) => {
      setDrop(null);
      setDragPath(null);
      if (sourcePath === targetPath) return;
      if (position === 'inside') onExpand(targetPath);
      movePage(sourcePath, targetPath, position);
    },
    [movePage, onExpand],
  );

  const menuItems = useCallback(
    (node: TreeNode): MenuItem[] => [
      { id: 'new', label: 'New child page', icon: <Plus />, onSelect: () => newPage(node.path) },
      { id: 'rename', label: 'Rename', icon: <Pencil />, onSelect: () => renamePage(node) },
      { id: 'duplicate', label: 'Duplicate', icon: <Copy />, onSelect: () => duplicatePage(node) },
      { id: 'link', label: 'Copy link', icon: <Link />, onSelect: () => copyLink(node.path) },
      { id: 'delete', label: 'Delete', icon: <Trash />, danger: true, onSelect: () => deletePage(node) },
    ],
    [newPage, renamePage, duplicatePage, copyLink, deletePage],
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
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.node)} onClose={() => setMenu(null)} />
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
    props.onMenu({ x: event.clientX, y: event.clientY, node });
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

        <span className="tree-row__icon">{node.icon ?? <DocIcon size={13} />}</span>
        <span className="tree-row__title">{node.title}</span>

        <span className="tree-row__actions">
          <button
            type="button"
            className="tree-row__action"
            aria-label={`Page options for ${node.title}`}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              props.onMenu({ x: rect.left, y: rect.bottom + 4, node });
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
