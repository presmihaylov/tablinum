import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Modal } from '../../components/ui/Overlay';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import type { WikilinkItem } from '../extensions';

interface PagePickerProps {
  open: boolean;
  search: (query: string) => Promise<WikilinkItem[]>;
  onClose: () => void;
  onPick: (path: string) => void;
  /** Creates a page with this title under the open one, then embeds it. */
  onCreate: (title: string) => void;
}

/** A row in the list: a page that exists, or the offer to make one. */
type Option = { kind: 'page'; item: WikilinkItem } | { kind: 'create'; title: string };

const DEBOUNCE_MS = 160;

/** Picks the page an embed points at, by the same search the wikilink menu uses. */
export function PagePicker({ open, search, onClose, onPick, onCreate }: PagePickerProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<WikilinkItem[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settled = useDebouncedValue(query, DEBOUNCE_MS);

  // Cleared on the way out, never on the way in. A reset that runs after the dialog is on screen
  // races the first keys: React flushes the effect after paint, so it can wipe what was typed.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setItems([]);
    setActive(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    search(settled).then(
      (found) => {
        if (!live) return;
        setItems(found);
        setActive(0);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [open, search, settled]);

  // The new-page row reads the live query, not the debounced one, so the title never lags.
  const title = query.trim();
  const options = useMemo<Option[]>(() => {
    const rows: Option[] = items.map((item) => ({ kind: 'page', item }));
    if (title.length > 0) rows.push({ kind: 'create', title });
    return rows;
  }, [items, title]);

  const choose = (option: Option | undefined): void => {
    if (!option) return;
    onClose();
    if (option.kind === 'create') {
      onCreate(option.title);
      return;
    }
    onPick(option.item.path);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    const count = options.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (count === 0 ? 0 : (current + 1) % count));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (count === 0 ? 0 : (current + count - 1) % count));
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    choose(options[active]);
  };

  return (
    <Modal open={open} title="Embed a page" onClose={onClose} width="26rem">
      <label className="field">
        <span className="field__label">Page</span>
        <input
          ref={inputRef}
          className="input"
          value={query}
          placeholder="Search pages…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>

      <div className="gd-editor-picker" role="listbox" aria-label="Pages">
        {options.length === 0 ? (
          <p className="gd-editor-picker__empty">Type to find a page, or to name a new one.</p>
        ) : null}
        {options.map((option, index) => (
          <button
            key={option.kind === 'create' ? 'create' : `page:${option.item.path}`}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`gd-editor-menu__item${index === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(option)}
          >
            <span className="gd-editor-menu__text">
              <span className="gd-editor-menu__title">
                {option.kind === 'create' ? `New page: ${option.title}` : option.item.title}
              </span>
              <span className="gd-editor-menu__hint">
                {option.kind === 'create' ? 'Create it here and embed it' : option.item.path}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export default PagePicker;
