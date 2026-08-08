import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useGitSync, useSearch } from '../../api/hooks';
import { pageHref } from '../../lib/href';
import { filterActions, type PaletteAction } from '../../lib/palette';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useWorkspace } from '../../lib/workspace';
import { DocIcon, Moon, Plus, Search, Sun, Sync } from '../ui/Icon';
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

const SEARCH_DEBOUNCE_MS = 160;

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { newPage, currentSpace, currentPath } = useWorkspace();
  const { toggle: toggleTheme, resolved } = useTheme();
  const { push, pushError } = useToast();
  const sync = useGitSync();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const search = useSearch({ q: debounced, limit: 12 }, open);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(timer);
  }, [open]);

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'new-page',
        label: 'New page',
        group: 'Actions',
        hint: currentSpace,
        keywords: ['create', 'add', 'page'],
        run: () => newPage(currentPath || currentSpace || null),
      },
      {
        id: 'sync',
        label: 'Sync with git',
        group: 'Actions',
        hint: 'pull, then push',
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
        keywords: ['dark', 'light', 'appearance'],
        run: toggleTheme,
      },
    ],
    [currentSpace, currentPath, newPage, sync, push, pushError, resolved, toggleTheme],
  );

  const rows = useMemo<Row[]>(() => {
    const matched = filterActions(actions, query).map<Row>((action) => ({
      key: `action:${action.id}`,
      label: action.label,
      hint: action.hint,
      group: action.group,
      icon: action.id === 'sync' ? <Sync size={13} /> : action.id === 'theme' ? themeIcon(resolved) : <Plus size={13} />,
      run: action.run,
    }));

    const hits = (search.data?.hits ?? []).map<Row>((hit) => ({
      key: `page:${hit.id}`,
      label: hit.title,
      hint: hit.snippet.replace(/\s+/g, ' ').slice(0, 90),
      group: 'Pages',
      icon: <DocIcon size={13} />,
      run: () => navigate(pageHref(hit.path)),
    }));

    return [...matched, ...hits];
  }, [actions, query, search.data, navigate, resolved]);

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
