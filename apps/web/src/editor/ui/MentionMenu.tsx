import { forwardRef } from 'react';
import { PersonRow, type MentionCandidate } from '../../components/ui/PersonRow';
import { SuggestionMenu } from './SuggestionMenu';
import type { SuggestionMenuHandle, SuggestionMenuProps } from './suggestionRenderer';

export const MentionMenu = forwardRef<SuggestionMenuHandle, SuggestionMenuProps<MentionCandidate>>(
  function MentionMenu({ items, query, command }, ref) {
    return (
      <SuggestionMenu
        handleRef={ref}
        items={items}
        command={command}
        label="Mention a person"
        emptyText={query.trim().length === 0 ? 'Type to find a person' : 'Nobody found'}
        keyOf={(person) => person.id}
        renderRow={(person) => <PersonRow person={person} />}
      />
    );
  },
);

export default MentionMenu;
