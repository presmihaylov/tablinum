import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from 'react';
import { MenuEmpty, MenuList } from '../../components/ui/MenuList';
import type { SuggestionMenuHandle } from './suggestionRenderer';

interface SuggestionMenuProps<I> {
  items: readonly I[];
  command: (item: I) => void;
  /** The handle tiptap sends the arrow keys to. The menu answers them here. */
  handleRef: Ref<SuggestionMenuHandle>;
  label: string;
  emptyText: string;
  keyOf: (item: I) => string;
  renderRow: (item: I) => ReactNode;
}

/**
 * Every menu a caret opens in the editor. It holds the row the keys sit on, wraps the arrows
 * round both ends, commits on Enter or Tab, and starts again at the top when the items change.
 * A menu built on it says only what its rows hold and what to write when it has nothing.
 */
export function SuggestionMenu<I>({
  items,
  command,
  handleRef,
  label,
  emptyText,
  keyOf,
  renderRow,
}: SuggestionMenuProps<I>) {
  const [active, setActive] = useState(0);

  useEffect(() => setActive(0), [items]);

  useImperativeHandle(handleRef, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === 'ArrowDown') {
        setActive((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setActive((current) => (current + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[active];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return <MenuEmpty className="menu--caret">{emptyText}</MenuEmpty>;

  return (
    <MenuList
      className="menu--caret"
      items={items}
      active={active}
      label={label}
      keyOf={keyOf}
      renderRow={renderRow}
      onHover={setActive}
      onPick={command}
    />
  );
}
