import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { EmojiGlyph } from '../../components/ui/EmojiGlyph';
import { Smiley } from '../../components/ui/Icon';
import { EmojiList } from './EmojiList';
import { EmojiPicker } from './EmojiPicker';
import type { EmojiAnchor } from './EmojiPicker';
import { findEmojiTrigger, matchUnicodeEmoji } from './emoji';
import type { EmojiEntry, EmojiTrigger } from './emoji';

export interface PageTitleProps {
  value: string;
  icon: string | null;
  onChange: (title: string) => void;
  /** Enter or Down at the end of the title moves the caret into the body. */
  onLeave: () => void;
  /** Sets the page icon, or clears it with null. Without it the icon is read only. */
  onIconChange?: (icon: string | null) => void;
}

/**
 * The big page heading. It is a textarea rather than a document node: the title
 * lives in frontmatter, not in the markdown body, so it must never become an H1
 * in the file. A textarea has no ProseMirror plugins, so `:emoji` is matched here.
 */
export function PageTitle({ value, icon, onChange, onLeave, onIconChange }: PageTitleProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const caretAfter = useRef<number | null>(null);
  const [trigger, setTrigger] = useState<EmojiTrigger | null>(null);
  const [active, setActive] = useState(0);
  const [iconAt, setIconAt] = useState<EmojiAnchor | null>(null);

  // A title is plain text in frontmatter, so it offers only emoji it can actually hold.
  const items = useMemo(() => (trigger ? matchUnicodeEmoji(trigger.query) : []), [trigger]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
    const at = caretAfter.current;
    if (at === null) return;
    caretAfter.current = null;
    node.focus();
    node.setSelectionRange(at, at);
  }, [value]);

  // A fresh object on every keystroke would send the highlight back to the first row.
  const sync = (): void => {
    const node = ref.current;
    if (!node) return;
    const found = findEmojiTrigger(node.value.slice(0, node.selectionStart));
    setTrigger((current) => (sameTrigger(current, found) ? current : found));
    if (!sameTrigger(trigger, found)) setActive(0);
  };

  const pick = (entry: EmojiEntry): void => {
    const node = ref.current;
    if (!node || !trigger) return;
    const caret = node.selectionStart;
    setTrigger(null);
    caretAfter.current = trigger.from + entry.char.length;
    onChange(`${value.slice(0, trigger.from)}${entry.char}${value.slice(caret)}`);
  };

  const menuKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (items.length === 0) return false;
    if (event.key === 'Escape') {
      setTrigger(null);
      return true;
    }
    if (event.key === 'ArrowDown') {
      setActive((current) => (current + 1) % items.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      setActive((current) => (current + items.length - 1) % items.length);
      return true;
    }
    if (event.key !== 'Enter' && event.key !== 'Tab') return false;
    const entry = items[active];
    if (entry) pick(entry);
    return true;
  };

  const openIcons = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    setIconAt((current) => (current ? null : { left: box.left, top: box.bottom }));
  };

  // The picker closes on a mousedown outside it, and its own button is outside it.
  const holdOpen = (event: ReactMouseEvent<HTMLButtonElement>): void => event.stopPropagation();

  const setIcon = (next: string | null): void => {
    setIconAt(null);
    onIconChange?.(next);
  };

  /** The emoji left of the title: a button that opens the picker, once the shell can save it. */
  function iconSlot() {
    if (!onIconChange) {
      if (!icon) return null;
      return (
        <span className="editor__icon" aria-label="Page icon">
          <EmojiGlyph value={icon} />
        </span>
      );
    }
    if (icon) {
      return (
        <button
          type="button"
          className="editor__icon"
          aria-label="Page icon"
          onMouseDown={holdOpen}
          onClick={openIcons}
        >
          <EmojiGlyph value={icon} />
        </button>
      );
    }
    return (
      <button
        type="button"
        className="editor__icon-add"
        aria-label="Add an icon"
        onMouseDown={holdOpen}
        onClick={openIcons}
      >
        <Smiley size={13} />
        Add icon
      </button>
    );
  }

  return (
    <div className="editor__title-row">
      {iconSlot()}
      <div className="editor__title-field">
        <textarea
          ref={ref}
          className="editor__title"
          value={value}
          rows={1}
          spellCheck={false}
          placeholder="Untitled"
          aria-label="Page title"
          onChange={(event) => {
            onChange(event.target.value.replace(/\n/g, ' '));
            sync();
          }}
          onClick={sync}
          onBlur={() => setTrigger(null)}
          onKeyDown={(event) => {
            if (menuKey(event)) {
              event.preventDefault();
              return;
            }
            if (event.key !== 'Enter' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            onLeave();
          }}
        />
        {items.length > 0 ? (
          <EmojiList
            items={items}
            active={active}
            className="editor__title-emoji"
            onHover={setActive}
            onPick={pick}
          />
        ) : null}
      </div>

      {iconAt ? (
        <EmojiPicker
          wide
          label="Choose a page icon"
          anchor={iconAt}
          onClose={() => setIconAt(null)}
          onPick={setIcon}
          {...(icon ? { onRemove: () => setIcon(null) } : {})}
        />
      ) : null}
    </div>
  );
}

function sameTrigger(a: EmojiTrigger | null, b: EmojiTrigger | null): boolean {
  if (a === null || b === null) return a === b;
  return a.from === b.from && a.query === b.query;
}

export default PageTitle;
