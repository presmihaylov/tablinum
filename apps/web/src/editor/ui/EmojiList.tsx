import { EmojiGlyph } from '../../components/ui/EmojiGlyph';
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
    <div
      className={`gd-editor-menu gd-editor-menu--emoji${className ? ` ${className}` : ''}`}
      role="listbox"
      aria-label="Insert emoji"
    >
      {items.map((entry, index) => (
        <button
          key={entry.src ?? entry.char}
          type="button"
          role="option"
          aria-selected={index === active}
          className={`gd-editor-menu__item${index === active ? ' is-active' : ''}`}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(entry)}
        >
          <span className="gd-editor-menu__emoji" aria-hidden="true">
            <EmojiGlyph value={entry.char} />
          </span>
          <span className="gd-editor-menu__text">
            <span className="gd-editor-menu__title">{entry.name}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default EmojiList;
