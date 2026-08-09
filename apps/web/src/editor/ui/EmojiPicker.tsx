import { useEffect, useMemo, useRef, useState } from 'react';
import { filterEmoji } from './emoji';

export interface EmojiAnchor {
  left: number;
  top: number;
}

export interface EmojiPickerProps {
  anchor: EmojiAnchor;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** A wider grid. The page icon is chosen once, so it gets more of the screen. */
  wide?: boolean;
  label?: string;
  /** Offered as "Remove" when the thing being picked already has an emoji. */
  onRemove?: () => void;
}

const WIDTH = 264;
const WIDE_WIDTH = 344;
const GAP = 6;

/** A small emoji popover, opened from the slash menu at the caret. */
export function EmojiPicker({ anchor, onPick, onClose, wide, label, onRemove }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => filterEmoji(query), [query]);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && boxRef.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const width = wide === true ? WIDE_WIDTH : WIDTH;
  const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - width - GAP));

  return (
    <div
      ref={boxRef}
      className={`gd-editor-emoji${wide === true ? ' gd-editor-emoji--wide' : ''}`}
      style={{ left: `${Math.round(left)}px`, top: `${Math.round(anchor.top + GAP)}px` }}
      role="dialog"
      aria-label={label ?? 'Insert emoji'}
    >
      <div className="gd-editor-emoji__head">
        <input
          autoFocus
          className="gd-editor-emoji__search"
          value={query}
          placeholder="Search emoji"
          aria-label="Search emoji"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const first = items[0];
            if (first) onPick(first.char);
          }}
        />
        {onRemove ? (
          <button type="button" className="gd-editor-emoji__remove" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
      <div className="gd-editor-emoji__grid">
        {items.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className="gd-editor-emoji__item"
            title={entry.name}
            aria-label={entry.name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(entry.char)}
          >
            {entry.char}
          </button>
        ))}
        {items.length === 0 ? <p className="gd-editor-emoji__empty">No emoji found</p> : null}
      </div>
    </div>
  );
}

export default EmojiPicker;
