import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { EmojiList } from './EmojiList';
import { findEmojiTrigger, matchEmoji } from './emoji';
import type { EmojiEntry, EmojiTrigger } from './emoji';

export interface PageTitleProps {
  value: string;
  icon: string | null;
  onChange: (title: string) => void;
  /** Enter or Down at the end of the title moves the caret into the body. */
  onLeave: () => void;
}

/**
 * The big page heading. It is a textarea rather than a document node: the title
 * lives in frontmatter, not in the markdown body, so it must never become an H1
 * in the file. A textarea has no ProseMirror plugins, so `:emoji` is matched here.
 */
export function PageTitle({ value, icon, onChange, onLeave }: PageTitleProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const caretAfter = useRef<number | null>(null);
  const [trigger, setTrigger] = useState<EmojiTrigger | null>(null);
  const [active, setActive] = useState(0);

  const items = useMemo(() => (trigger ? matchEmoji(trigger.query) : []), [trigger]);

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

  return (
    <div className="editor__title-row">
      {icon ? (
        <span className="editor__icon" aria-label="Page icon">
          {icon}
        </span>
      ) : null}
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
    </div>
  );
}

function sameTrigger(a: EmojiTrigger | null, b: EmojiTrigger | null): boolean {
  if (a === null || b === null) return a === b;
  return a.from === b.from && a.query === b.query;
}

export default PageTitle;
