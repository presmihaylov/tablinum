import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PagePath } from '@tablinum/shared';
import { ancestorPaths } from '../../lib/tree';
import { usePersistedState } from '../../lib/storage';
import { useContent } from '../../lib/content';
import { PanelLeft, Plus, Search } from '../ui/Icon';
import { AccountMenu } from '../Account/AccountMenu';
import { GitStatusPill } from './GitStatusPill';
import { PageTree } from './PageTree';
import { SpaceSwitcher } from './SpaceSwitcher';
import { WorkspaceSwitcher } from '../Workspace/WorkspaceSwitcher';
import './sidebar.css';

interface SidebarProps {
  onOpenPalette: () => void;
  onCollapse: () => void;
}

export function Sidebar({ onOpenPalette, onCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const { spaces, currentSpace, currentPath, newPage, isLoadingTree } = useContent();
  const [expanded, setExpanded] = usePersistedState<string[]>('tree.expanded', []);

  const space = useMemo(
    () => spaces.find((candidate) => candidate.slug === currentSpace) ?? spaces[0] ?? null,
    [spaces, currentSpace],
  );

  // Ancestors of the open page are always visible, whatever the stored state says.
  const openPaths = useMemo(() => {
    const set = new Set(expanded);
    for (const ancestor of ancestorPaths(currentPath)) set.add(ancestor);
    return set;
  }, [expanded, currentPath]);

  const toggle = useCallback(
    (path: PagePath) => {
      setExpanded((prev) => (prev.includes(path) ? prev.filter((entry) => entry !== path) : [...prev, path]));
    },
    [setExpanded],
  );

  const expand = useCallback(
    (path: PagePath) => {
      setExpanded((prev) => (prev.includes(path) ? prev : [...prev, path]));
    },
    [setExpanded],
  );

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <WorkspaceSwitcher />
        <AccountMenu />
        <button
          type="button"
          className="btn btn--icon"
          onClick={onCollapse}
          title="Hide the sidebar (⌘\)"
          aria-label="Hide the sidebar"
        >
          <PanelLeft />
        </button>
      </div>

      <div className="sidebar__top">
        <SpaceSwitcher />
        <button type="button" className="btn btn--icon" onClick={onOpenPalette} title="Search (⌘K)" aria-label="Search">
          <Search />
        </button>
      </div>

      <nav className="sidebar__tree scroll-y" aria-label="Pages">
        {isLoadingTree ? <p className="sidebar__hint">Loading…</p> : null}
        {!isLoadingTree && !space ? <p className="sidebar__hint">No spaces yet.</p> : null}
        {space ? (
          <PageTree
            nodes={space.tree}
            expanded={openPaths}
            onToggle={toggle}
            onExpand={expand}
            currentPath={currentPath}
            onOpen={(path) => navigate(`/p/${path.split('/').map(encodeURIComponent).join('/')}`)}
          />
        ) : null}

        <button type="button" className="sidebar__new" onClick={() => newPage(space ? space.slug : null)}>
          <Plus />
          New page
        </button>
      </nav>

      <GitStatusPill />
    </aside>
  );
}
