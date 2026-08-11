import { forwardRef } from 'react';
import type { SlashCommandItem } from '../extensions/slashMenu';
import { SuggestionMenu } from './SuggestionMenu';
import type { SuggestionMenuHandle, SuggestionMenuProps } from './suggestionRenderer';

export const SlashMenu = forwardRef<SuggestionMenuHandle, SuggestionMenuProps<SlashCommandItem>>(
  function SlashMenu({ items, command }, ref) {
    return (
      <SuggestionMenu
        handleRef={ref}
        items={items}
        command={command}
        label="Insert block"
        emptyText="No matching blocks"
        keyOf={(item) => item.id}
        renderRow={(item) => (
          <>
            <span className="menu__glyph">{item.glyph}</span>
            <span className="menu__text">
              <span className="menu__title">{item.title}</span>
              <span className="menu__hint">{item.hint}</span>
            </span>
          </>
        )}
      />
    );
  },
);

export default SlashMenu;
