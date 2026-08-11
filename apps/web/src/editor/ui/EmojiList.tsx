import { EmojiGlyph } from '../../components/ui/EmojiGlyph';
import { MenuList } from '../../components/ui/MenuList';
import type { EmojiEntry } from './emoji';

export interface EmojiListProps {
  items: readonly EmojiEntry[];
  active: number;
  onHover: (index: number) => void;
  onPick: (entry: EmojiEntry) => void;
  /** An extra class for the caller that has to place the box itself. */
  className?: string;
}

/** The `:query` result list. Both the body menu and the title menu draw it. */
export function EmojiList({ items, active, onHover, onPick, className }: EmojiListProps) {
  return (
    <MenuList
      className={className === undefined ? 'menu--emoji' : `menu--emoji ${className}`}
      items={items}
      active={active}
      label="Insert emoji"
      keyOf={(entry) => entry.src ?? entry.char}
      renderRow={(entry) => (
        <>
          <span className="menu__emoji" aria-hidden="true">
            <EmojiGlyph value={entry.char} />
          </span>
          <span className="menu__text">
            <span className="menu__title">{entry.name}</span>
          </span>
        </>
      )}
      onHover={onHover}
      onPick={onPick}
    />
  );
}

export default EmojiList;
