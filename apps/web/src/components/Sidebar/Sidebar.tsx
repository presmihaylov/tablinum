import { useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PagePath, TreeNode } from '@tablinum/shared';
import { pageHref } from '../../lib/href';
import { ancestorPaths, findNode } from '../../lib/tree';
import { usePersistedState } from '../../lib/storage';
import { useContent } from '../../lib/content';
import { EmojiGlyph } from '../ui/EmojiGlyph';
import { DocIcon, PanelLeft, Plus, Search, Star } from '../ui/Icon';
import { AccountMenu } from '../Account/AccountMenu';
import { GitStatusPill } from './GitStatusPill';
import { PageTree } from './PageTree';
import { SidebarSection } from './SidebarSection';
import { WorkspaceSwitcher } from '../Workspace/WorkspaceSwitcher';
import './sidebar.css';

interface SidebarProps {
  onOpenPalette: () => void;
  onCollapse: () => void;
}

/** Buckets are open until somebody folds one away, so an absent entry reads as open. */
type SectionState = Record<string, boolean>;

export function Sidebar({ onOpenPalette, onCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const { spaces, recents, favorites, toggleFavorite, currentPath, newPage, newSpace, isLoadingTree } =
    useContent();
  const [expanded, setExpanded] = usePersistedState<string[]>('tree.expanded', []);
  const [sections, setSections] = usePersistedState<SectionState>('ui.sections', {});

  // Ancestors of the open page are always visible, whatever the stored state says.
  const openPaths = useMemo(() => {
    const set = new Set(expanded);
    for (const ancestor of ancestorPaths(currentPath)) set.add(ancestor);
    return set;
  }, [expanded, currentPath]);

  const open = (path: PagePath): void => navigate(pageHref(path));

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

  const isSectionOpen = (id: string): boolean => sections[id] ?? true;
  const toggleSection = (id: string): void =>
    setSections((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  // A page that was deleted or renamed stays in the stored list, so resolve every entry.
  const recentNodes = useMemo(
    () => recents.map((path) => findNode(spaces, path)).filter((node) => node !== null),
    [recents, spaces],
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
        <button type="button" className="sidebar__row" onClick={onOpenPalette} title="Search (⌘K)">
          <Search size={14} />
          Search
        </button>
      </div>

      <nav className="sidebar__tree scroll-y" aria-label="Pages">
        {isLoadingTree ? <p className="sidebar__hint">Loading…</p> : null}

        <SidebarSection
          label="Favorites"
          open={isSectionOpen('favorites')}
          onToggle={() => toggleSection('favorites')}
        >
          {favorites.length === 0 ? <p className="sidebar__hint">No favorites yet.</p> : null}
          <ul className="sidebar-list">
            {favorites.map((node) => (
              <li key={node.id}>
                <PageRow node={node} currentPath={currentPath} onOpen={open}>
                  <button
                    type="button"
                    className="sidebar-list__action"
                    aria-label={`Remove ${node.title} from favorites`}
                    title="Remove from favorites"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(node);
                    }}
                  >
                    <Star size={12} filled />
                  </button>
                </PageRow>
              </li>
            ))}
          </ul>
        </SidebarSection>

        <SidebarSection
          label="Spaces"
          open={isSectionOpen('spaces')}
          onToggle={() => toggleSection('spaces')}
          action={{ label: 'New space', onSelect: newSpace }}
        >
          {!isLoadingTree && spaces.length === 0 ? <p className="sidebar__hint">No spaces yet.</p> : null}
          {spaces.map((space) => (
            <PageTree
              key={space.slug}
              nodes={space.tree}
              expanded={openPaths}
              onToggle={toggle}
              onExpand={expand}
              currentPath={currentPath}
              onOpen={open}
            />
          ))}
        </SidebarSection>

        <SidebarSection
          label="Recents"
          open={isSectionOpen('recents')}
          onToggle={() => toggleSection('recents')}
        >
          {recentNodes.length === 0 ? <p className="sidebar__hint">No pages opened yet.</p> : null}
          <ul className="sidebar-list">
            {recentNodes.map((node) => (
              <li key={node.id}>
                <PageRow node={node} currentPath={currentPath} onOpen={open} />
              </li>
            ))}
          </ul>
        </SidebarSection>

        <button type="button" className="sidebar__new" onClick={() => newPage(null)}>
          <Plus />
          New page
        </button>
      </nav>

      <GitStatusPill />
    </aside>
  );
}

interface PageRowProps {
  node: TreeNode;
  currentPath: PagePath;
  onOpen: (path: PagePath) => void;
  /** A trailing control, shown on hover. The Favorites bucket puts its star here. */
  children?: ReactNode;
}

/** One flat page row, as the Favorites and Recents buckets both draw it. */
function PageRow({ node, currentPath, onOpen, children }: PageRowProps) {
  const className = node.path === currentPath ? 'sidebar__row sidebar__row--current' : 'sidebar__row';
  return (
    <div className="sidebar-list__item">
      <button type="button" className={className} onClick={() => onOpen(node.path)}>
        <span className="sidebar__row-icon">
          {node.icon ? <EmojiGlyph value={node.icon} /> : <DocIcon size={13} />}
        </span>
        <span className="sidebar__row-title">{node.title}</span>
      </button>
      {children}
    </div>
  );
}
