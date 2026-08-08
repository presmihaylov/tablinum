import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { WikilinkItem } from '../extensions/wikilinkSuggestion';
import type { SuggestionMenuHandle, SuggestionMenuProps } from './suggestionRenderer';

export const WikilinkMenu = forwardRef<SuggestionMenuHandle, SuggestionMenuProps<WikilinkItem>>(
  function WikilinkMenu({ items, query, command }, ref) {
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

    if (items.length === 0) {
      return (
        <div className="gd-editor-menu gd-editor-menu--empty">
          {query.trim().length === 0 ? 'Type to find a page' : 'No page found'}
        </div>
      );
    }

    return (
      <div className="gd-editor-menu" role="listbox" aria-label="Link to page">
        {items.map((item, index) => (
          <button
            key={item.path}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`gd-editor-menu__item${index === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => command(item)}
          >
            <span className="gd-editor-menu__text">
              <span className="gd-editor-menu__title">{item.title}</span>
              <span className="gd-editor-menu__hint">{item.path}</span>
            </span>
          </button>
        ))}
      </div>
    );
  },
);

export default WikilinkMenu;
