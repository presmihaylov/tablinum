import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { BlockSelection } from '../extensions';
import { FloatingBar } from './FloatingBar';

const MARKS = [
  { name: 'bold', label: 'B', title: 'Bold  Cmd+B', className: 'is-bold' },
  { name: 'italic', label: 'i', title: 'Italic  Cmd+I', className: 'is-italic' },
  { name: 'strike', label: 'S', title: 'Strikethrough  Cmd+Shift+X', className: 'is-strike' },
  { name: 'code', label: '<>', title: 'Inline code  Cmd+E', className: 'is-code' },
] as const;

function hasTextSelection(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  if (editor.isActive('codeBlock')) return false;
  // A whole node holds no text to mark, and an insert leaves one picked, so the bar would land
  // over the page. A whole-cell selection belongs to the table toolbar, not to this one.
  if (editor.state.selection instanceof NodeSelection) return false;
  // A run of whole blocks is a thing to move or to drop, not a phrase to mark.
  if (editor.state.selection instanceof BlockSelection) return false;
  return !(editor.state.selection instanceof CellSelection);
}

interface MarkMenuProps {
  editor: Editor;
  /** Starts a comment on the selected text. Absent when the page has no comment panel. */
  onComment?: () => void;
}

/** The selection toolbar: the inline marks markdown can express, plus comments. */
export function MarkMenu({ editor, onComment }: MarkMenuProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkOpen) inputRef.current?.focus();
  }, [linkOpen]);

  const openLink = (): void => {
    const current = editor.getAttributes('link')['href'];
    setHref(typeof current === 'string' ? current : '');
    setLinkOpen(true);
  };

  const applyLink = (): void => {
    const value = href.trim();
    setLinkOpen(false);
    if (value.length === 0) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
  };

  return (
    <FloatingBar editor={editor} shouldShow={hasTextSelection} label="Text formatting">
      {linkOpen ? (
        <>
          <input
            ref={inputRef}
            className="gd-editor-bar__input"
            value={href}
            placeholder="Paste a link, or a page path"
            aria-label="Link address"
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setLinkOpen(false);
              }
            }}
          />
          <button type="button" className="gd-editor-bar__btn" onClick={applyLink}>
            Apply
          </button>
        </>
      ) : (
        <>
          {MARKS.map((mark) => (
            <button
              key={mark.name}
              type="button"
              title={mark.title}
              aria-label={mark.title}
              aria-pressed={editor.isActive(mark.name)}
              className={`gd-editor-bar__btn ${mark.className}${
                editor.isActive(mark.name) ? ' is-active' : ''
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().focus().toggleMark(mark.name).run()}
            >
              {mark.label}
            </button>
          ))}
          <span className="gd-editor-bar__sep" />
          <button
            type="button"
            title="Link"
            aria-label="Link"
            aria-pressed={editor.isActive('link')}
            className={`gd-editor-bar__btn${editor.isActive('link') ? ' is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openLink}
          >
            Link
          </button>
          {onComment === undefined ? null : (
            <button
              type="button"
              title="Comment"
              aria-label="Comment"
              className="gd-editor-bar__btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onComment}
            >
              Comment
            </button>
          )}
        </>
      )}
    </FloatingBar>
  );
}

export default MarkMenu;
