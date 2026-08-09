import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Avatar } from '../../components/Account/Avatar';
import type { MentionItem } from '../extensions/mentionSuggestion';
import type { SuggestionMenuHandle, SuggestionMenuProps } from './suggestionRenderer';

export const MentionMenu = forwardRef<SuggestionMenuHandle, SuggestionMenuProps<MentionItem>>(
  function MentionMenu({ items, query, command }, ref) {
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
          {query.trim().length === 0 ? 'Type to find a person' : 'Nobody found'}
        </div>
      );
    }

    return (
      <div className="gd-editor-menu" role="listbox" aria-label="Mention a person">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`gd-editor-menu__item${index === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => command(item)}
          >
            <Avatar person={item} size={20} className="gd-editor-menu__face" />
            <span className="gd-editor-menu__text">
              <span className="gd-editor-menu__title">{item.name}</span>
              <span className="gd-editor-menu__hint">@{item.handle}</span>
            </span>
          </button>
        ))}
      </div>
    );
  },
);

export default MentionMenu;
