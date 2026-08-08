import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { EmojiList } from './EmojiList';
import type { EmojiEntry } from './emoji';
import type { SuggestionMenuHandle, SuggestionMenuProps } from './suggestionRenderer';

export const EmojiMenu = forwardRef<SuggestionMenuHandle, SuggestionMenuProps<EmojiEntry>>(
  function EmojiMenu({ items, command }, ref) {
    const [active, setActive] = useState(0);

    useEffect(() => setActive(0), [items]);

    useImperativeHandle(ref, () => ({
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

    // A colon that matches nothing is ordinary punctuation, so show no box at all.
    if (items.length === 0) return null;

    return (
      <EmojiList items={items} active={active} onHover={setActive} onPick={command} />
    );
  },
);

export default EmojiMenu;
