import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../../api/content';
import { useGitSync } from '../../api/git';
import { useAuth } from '../../lib/auth';
import { pageHref } from '../../lib/href';
import { filterActions, type PaletteAction } from '../../lib/palette';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useContent } from '../../lib/content';
import { findNode } from '../../lib/tree';
import {
  Bot,
  Copy,
  DocIcon,
  Link,
  Moon,
  MoveTo,
  Pencil,
  Plus,
  Search,
  Settings,
  Smiley,
  Star,
  Sun,
  Sync,
  Trash,
  UserIcon,
} from '../ui/Icon';
import { PageIcon } from '../ui/PageIcon';
import './palette.css';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Row {
  key: string;
  label: string;
  hint?: string;
  group: string;
  icon: ReactElement;
  run: () => void;
}

/** A palette action draws its own icon, so no list has to be kept in step by hand. */
interface Action extends PaletteAction {
  icon: ReactElement;
}

const SEARCH_DEBOUNCE_MS = 160;

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const content = useContent();
  const { newPage, newSpace, currentSpace, currentPath, spaces } = content;
  const { user } = useAuth();
  const { toggle: toggleTheme, resolved } = useTheme();
  const { push, pushError } = useToast();
  const sync = useGitSync();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const search = useSearch({ q: debounced, limit: 12 }, open);

  // Cleared on the way out, never on the way in. A reset that runs after the dialog is on screen
  // races the first keys: React flushes the effect after paint, so it can wipe what was typed.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setActive(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(timer);
  }, [open]);

  // The page the reader is on, if any. Everything under "This page" acts on it.
  const here = useMemo(
    () => (currentPath.length === 0 ? null : findNode(spaces, currentPath)),
    [spaces, currentPath],
  );
  const isAdmin = user?.role === 'admin';

  const actions = useMemo<Action[]>(() => {
    const made: Action[] = [
      {
        id: 'new-page',
        label: 'New page',
        group: 'Actions',
        hint: currentSpace,
        icon: <Plus size={13} />,
        keywords: ['create', 'add', 'page'],
        run: () => newPage(currentPath || currentSpace || null),
      },
      {
        id: 'new-space',
        label: 'New space',
        group: 'Actions',
        hint: 'everybody reads it',
        icon: <Plus size={13} />,
        keywords: ['create', 'add', 'space', 'public'],
        run: () => newSpace(),
      },
      {
        id: 'new-private-space',
        label: 'New private space',
        group: 'Actions',
        hint: 'only you read it',
        icon: <Plus size={13} />,
        keywords: ['create', 'add', 'space', 'private', 'secret'],
        run: () => newSpace({ private: true }),
      },
      {
        id: 'sync',
        label: 'Sync with git',
        group: 'Actions',
        hint: 'pull, then push',
        icon: <Sync size={13} />,
        keywords: ['git', 'pull', 'push', 'commit'],
        run: () =>
          sync.mutate(undefined, {
            onSuccess: (result) => push(`Synced: pulled ${result.pulled}${result.pushed ? ', pushed' : ''}.`, 'success'),
            onError: (error) => pushError(error, 'Sync failed.'),
          }),
      },
      {
        id: 'theme',
        label: 'Toggle theme',
        group: 'Actions',
        hint: resolved === 'dark' ? 'to light' : 'to dark',
        icon: themeIcon(resolved),
        keywords: ['dark', 'light', 'appearance'],
        run: toggleTheme,
      },
    ];

    if (here !== null) {
      const node = here;
      const pinned = content.isFavorite(node.id);
      made.push(
        {
          id: 'favorite',
          label: pinned ? 'Remove from favorites' : 'Add to favorites',
          group: 'This page',
          hint: node.title,
          icon: <Star size={13} />,
          keywords: ['star', 'pin', 'bookmark', 'favourite'],
          run: () => content.toggleFavorite(node),
        },
        {
          id: 'copy-link',
          label: 'Copy link to the page',
          group: 'This page',
          hint: node.title,
          icon: <Link size={13} />,
          keywords: ['url', 'share', 'address'],
          run: () => content.copyLink(node.path),
        },
        {
          id: 'rename',
          label: 'Rename the page',
          group: 'This page',
          hint: node.title,
          icon: <Pencil size={13} />,
          keywords: ['title', 'name'],
          run: () => content.renamePage(node),
        },
        {
          id: 'duplicate',
          label: 'Duplicate the page',
          group: 'This page',
          hint: node.title,
          icon: <Copy size={13} />,
          keywords: ['copy', 'clone'],
          run: () => content.duplicatePage(node),
        },
        {
          id: 'move-to-space',
          label: 'Move the page to another space',
          group: 'This page',
          hint: node.title,
          icon: <MoveTo size={13} />,
          keywords: ['space', 'private', 'public'],
          run: () => content.moveToSpace(node),
        },
        {
          id: 'delete',
          label: 'Delete the page',
          group: 'This page',
          hint: node.title,
          icon: <Trash size={13} />,
          keywords: ['remove', 'trash'],
          run: () => content.deletePage(node),
        },
      );
    }

    made.push(
      {
        id: 'go-home',
        label: 'Go home',
        group: 'Go to',
        icon: <DocIcon size={13} />,
        keywords: ['start', 'overview'],
        run: () => navigate('/'),
      },
      {
        id: 'go-account',
        label: 'My account',
        group: 'Go to',
        hint: 'settings',
        icon: <UserIcon size={13} />,
        keywords: ['profile', 'password', 'name', 'settings'],
        run: () => navigate('/settings/account'),
      },
      {
        id: 'go-emoji',
        label: 'Custom emoji',
        group: 'Go to',
        hint: 'settings',
        icon: <Smiley size={13} />,
        keywords: ['icon', 'upload', 'settings'],
        run: () => navigate('/settings/emoji'),
      },
      {
        id: 'go-workspace',
        label: 'Workspace settings',
        group: 'Go to',
        hint: 'people and invites too',
        icon: <Settings size={13} />,
        keywords: ['git', 'remote', 'name', 'people', 'members', 'invite', 'invites', 'team', 'settings'],
        run: () => navigate('/settings/workspace'),
      },
    );

    if (isAdmin) {
      made.push({
        id: 'go-agents',
        label: 'Agents',
        group: 'Go to',
        hint: 'settings',
        icon: <Bot size={13} />,
        keywords: ['mcp', 'bot', 'token', 'settings'],
        run: () => navigate('/settings/agents'),
      });
    }

    return made;
  }, [
    currentSpace,
    currentPath,
    newPage,
    newSpace,
    sync,
    push,
    pushError,
    resolved,
    toggleTheme,
    here,
    content,
    isAdmin,
    navigate,
  ]);

  const rows = useMemo<Row[]>(() => {
    const matched = filterActions(actions, query).map<Row>((action) => ({
      key: `action:${action.id}`,
      label: action.label,
      hint: action.hint,
      group: action.group,
      icon: action.icon,
      run: action.run,
    }));

    // An empty box asks for nothing, so the query is switched off and its last answer is kept.
    // Drawing that answer would show the hits of the previous visit under a blank box.
    const found = query.trim().length === 0 ? [] : (search.data?.hits ?? []);
    const hits = found.map<Row>((hit) => ({
      key: `page:${hit.id}`,
      label: hit.title,
      hint: hit.snippet.replace(/\s+/g, ' ').slice(0, 90),
      group: 'Pages',
      icon: <PageIcon icon={hit.icon} />,
      run: () => navigate(pageHref(hit.path)),
    }));

    return [...matched, ...hits];
  }, [actions, query, search.data, navigate]);

  useEffect(() => {
    setActive((prev) => (prev >= rows.length ? 0 : prev));
  }, [rows.length]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open, rows.length]);

  if (!open) return null;

  const choose = (index: number): void => {
    const row = rows[index];
    if (!row) return;
    onClose();
    row.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((prev) => (rows.length === 0 ? 0 : (prev + 1) % rows.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((prev) => (rows.length === 0 ? 0 : (prev - 1 + rows.length) % rows.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    }
  };

  let lastGroup = '';

  return createPortal(
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette__search">
          <Search size={15} />
          <input
            ref={inputRef}
            className="palette__input"
            value={query}
            placeholder="Search pages or run a command…"
            aria-label="Search pages or run a command"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          {search.isFetching ? <span className="spinner" /> : null}
        </div>

        <div className="palette__results scroll-y" id="palette-results" role="listbox" ref={listRef}>
          {rows.length === 0 ? <p className="palette__empty">No matches.</p> : null}
          {rows.map((row, index) => {
            const showGroup = row.group !== lastGroup;
            lastGroup = row.group;
            return (
              <div key={row.key}>
                {showGroup ? <div className="palette__group">{row.group}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  className={index === active ? 'palette__row palette__row--active' : 'palette__row'}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  <span className="palette__icon">{row.icon}</span>
                  <span className="palette__label">{row.label}</span>
                  {row.hint ? <span className="palette__hint">{row.hint}</span> : null}
                </button>
              </div>
            );
          })}
        </div>

        <div className="palette__foot">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> to move
          </span>
          <span>
            <span className="kbd">↵</span> to open
          </span>
          <span>
            <span className="kbd">esc</span> to close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function themeIcon(resolved: 'light' | 'dark'): ReactElement {
  return resolved === 'dark' ? <Sun size={13} /> : <Moon size={13} />;
}
