import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Modal } from '../../components/ui/Overlay';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import type { WikilinkItem } from '../extensions';

interface PagePickerProps {
  open: boolean;
  search: (query: string) => Promise<WikilinkItem[]>;
  onClose: () => void;
  onPick: (path: string) => void;
}

const DEBOUNCE_MS = 160;

/** Picks the page an embed points at, by the same search the wikilink menu uses. */
export function PagePicker({ open, search, onClose, onPick }: PagePickerProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<WikilinkItem[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settled = useDebouncedValue(query, DEBOUNCE_MS);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setItems([]);
    setActive(0);
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

  const choose = (item: WikilinkItem | undefined): void => {
    if (!item) return;
    onClose();
    onPick(item.path);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (items.length === 0 ? 0 : (current + 1) % items.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (items.length === 0 ? 0 : (current + items.length - 1) % items.length));
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    choose(items[active]);
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
        {items.length === 0 ? (
          <p className="gd-editor-picker__empty">
            {query.trim().length === 0 ? 'Type to find a page.' : 'No page was found.'}
          </p>
        ) : null}
        {items.map((item, index) => (
          <button
            key={item.path}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`gd-editor-menu__item${index === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(item)}
          >
            <span className="gd-editor-menu__text">
              <span className="gd-editor-menu__title">{item.title}</span>
              <span className="gd-editor-menu__hint">{item.path}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export default PagePicker;
