import { forwardRef } from 'react';
import { PageIcon } from '../../components/ui/PageIcon';
import type { WikilinkItem } from '../extensions/wikilinkSuggestion';
import { SuggestionMenu } from './SuggestionMenu';
import type { SuggestionMenuHandle, SuggestionMenuProps } from './suggestionRenderer';

export const WikilinkMenu = forwardRef<SuggestionMenuHandle, SuggestionMenuProps<WikilinkItem>>(
  function WikilinkMenu({ items, query, command }, ref) {
    return (
      <SuggestionMenu
        handleRef={ref}
        items={items}
        command={command}
        label="Link to page"
        emptyText={query.trim().length === 0 ? 'Type to find a page' : 'No page found'}
        keyOf={(item) => item.id}
        renderRow={(item) => (
          <>
            <span className="menu__page-icon">
              <PageIcon icon={item.icon} />
            </span>
            <span className="menu__text">
              <span className="menu__title">{item.title}</span>
              <span className="menu__hint">{item.path}</span>
            </span>
          </>
        )}
      />
    );
  },
);

export default WikilinkMenu;
