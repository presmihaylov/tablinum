import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { pageHref } from '../../lib/href';
import { useTheme } from '../../lib/theme';
import { breadcrumbFor } from '../../lib/tree';
import { useWorkspace } from '../../lib/workspace';
import { Moon, PanelLeft, PanelRight, Search, Sun } from '../ui/Icon';
import './topbar.css';

interface TopBarProps {
  sidebarOpen: boolean;
  metaOpen: boolean;
  onToggleSidebar: () => void;
  onToggleMeta: () => void;
  onOpenPalette: () => void;
}

export function TopBar({ sidebarOpen, metaOpen, onToggleSidebar, onToggleMeta, onOpenPalette }: TopBarProps) {
  const { spaces, currentPath } = useWorkspace();
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

        <button
          type="button"
          className={metaOpen ? 'btn btn--icon btn--on' : 'btn btn--icon'}
          onClick={onToggleMeta}
          title="Toggle page details"
          aria-label="Toggle page details"
        >
          <PanelRight />
        </button>
      </div>
    </header>
  );
}
