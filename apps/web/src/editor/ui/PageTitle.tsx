import { useLayoutEffect, useRef } from 'react';

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
 * in the file.
 */
export function PageTitle({ value, icon, onChange, onLeave }: PageTitleProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  return (
    <div className="editor__title-row">
      {icon ? (
        <span className="editor__icon" aria-label="Page icon">
          {icon}
        </span>
      ) : null}
      <textarea
        ref={ref}
        className="editor__title"
        value={value}
        rows={1}
        spellCheck={false}
        placeholder="Untitled"
        aria-label="Page title"
        onChange={(event) => onChange(event.target.value.replace(/\n/g, ' '))}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          onLeave();
        }}
      />
    </div>
  );
}

export default PageTitle;
