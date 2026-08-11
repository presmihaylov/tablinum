import { Fragment, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { depth as pathDepth } from '@tablinum/shared';
import { pageHref } from '../../lib/href';
import { useTheme } from '../../lib/theme';
import { breadcrumbFor, findNode } from '../../lib/tree';
import { useContent } from '../../lib/content';
import type { PanelId, PanelState } from '../../lib/panels';
import { Presence } from '../Presence/Presence';
import { ContextMenu, type MenuItem } from '../ui/Overlay';
import { Check, Dots, Moon, MoveTo, PanelLeft, Search, Star, Sun, Trash } from '../ui/Icon';
import './topbar.css';

interface TopBarProps {
  sidebarOpen: boolean;
  panels: PanelState;
  onToggleSidebar: () => void;
  onTogglePanel: (id: PanelId) => void;
  onOpenPalette: () => void;
}

export function TopBar({ sidebarOpen, panels, onToggleSidebar, onTogglePanel, onOpenPalette }: TopBarProps) {
  const { spaces, currentPath } = useContent();
  const { resolved, toggle } = useTheme();

  const crumbs = useMemo(
    () => (currentPath ? breadcrumbFor(spaces, currentPath) : []),
    [spaces, currentPath],
  );

  return (
    <header className="topbar">
      <button
        type="button"
        className="btn btn--icon"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'}
        title="Toggle sidebar (⌘\)"
      >
        <PanelLeft />
      </button>

      <nav className="breadcrumb" aria-label="Breadcrumb">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.path}>
            {index > 0 ? <span className="breadcrumb__sep">/</span> : null}
            <Link className="breadcrumb__item" to={pageHref(crumb.path)}>
              {crumb.title}
            </Link>
          </Fragment>
        ))}
      </nav>

      <div className="topbar__right">
        <Presence />

        <button type="button" className="btn btn--icon" onClick={onOpenPalette} title="Search (⌘K)" aria-label="Search">
          <Search />
        </button>

        <button
          type="button"
          className="btn btn--icon"
          onClick={toggle}
          title="Toggle theme"
          aria-label={resolved === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        >
          {resolved === 'dark' ? <Sun /> : <Moon />}
        </button>

        <FavoriteButton />

        <PageMenu panels={panels} onTogglePanel={onTogglePanel} />
      </div>
    </header>
  );
}

/** The star beside the page menu. The same pin the bucket and the menu offer, one click away. */
function FavoriteButton() {
  const { spaces, currentPath, isFavorite, toggleFavorite } = useContent();
  const node = useMemo(() => (currentPath ? findNode(spaces, currentPath) : null), [spaces, currentPath]);

  if (node === null) return null;

  const pinned = isFavorite(node.id);
  const label = pinned ? 'Remove from your favorites' : 'Add to your favorites';

  return (
    <button
      type="button"
      className={pinned ? 'btn btn--icon btn--on' : 'btn btn--icon'}
      onClick={() => toggleFavorite(node)}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
    >
      <Star filled={pinned} />
    </button>
  );
}

interface PageMenuProps {
  panels: PanelState;
  onTogglePanel: (id: PanelId) => void;
}

/** Everything a whole page can do, out of sight until it is asked for. */
function PageMenu({ panels, onTogglePanel }: PageMenuProps) {
  const { spaces, currentPath, isFavorite, toggleFavorite, moveToSpace, deletePage } = useContent();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const node = useMemo(() => (currentPath ? findNode(spaces, currentPath) : null), [spaces, currentPath]);

  const items: MenuItem[] = [
    {
      id: 'backlinks',
      label: 'Backlinks',
      icon: panels.backlinks ? <Check /> : undefined,
      onSelect: () => onTogglePanel('backlinks'),
    },
    {
      id: 'history',
      label: 'History',
      icon: panels.history ? <Check /> : undefined,
      onSelect: () => onTogglePanel('history'),
    },
  ];

  const actions: MenuItem[] = [];

  if (node !== null) {
    const pinned = isFavorite(node.id);
    actions.push({
      id: 'favorite',
      label: pinned ? 'Remove from favorites' : 'Add to favorites',
      icon: <Star filled={pinned} />,
      onSelect: () => toggleFavorite(node),
    });
    // A space home page owns its space, so it can never move into another one.
    if (pathDepth(node.path) > 1) {
      actions.push({ id: 'move', label: 'Move to', icon: <MoveTo />, onSelect: () => moveToSpace(node) });
    }
    actions.push({ id: 'delete', label: 'Delete', icon: <Trash />, danger: true, onSelect: () => deletePage(node) });
  }

  // The rule sits above whichever action came first, whatever the page turned out to offer.
  const first = actions[0];
  if (first !== undefined) items.push({ ...first, divider: true }, ...actions.slice(1));

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={open ? 'btn btn--icon btn--on' : 'btn btn--icon'}
        onClick={() => setOpen((prev) => !prev)}
        title="Page options"
        aria-label="Page options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Dots />
      </button>

      {open ? (
        <ContextMenu
          label="Page options"
          anchor={buttonRef}
          align="right"
          items={items}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
