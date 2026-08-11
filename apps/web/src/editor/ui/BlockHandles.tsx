import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection, type Selection } from '@tiptap/pm/state';
import { anchorIdAt } from '../blockLinks';
import { aroundDocument, BlockSelection } from '../extensions/blockSelection';
import { nodeSelectionAt, startNodeDrag, startSelectionDrag } from './nodeDrag';

interface HandleTarget {
  pos: number;
  top: number;
  element: HTMLElement;
}

export interface BlockHandlesProps {
  editor: Editor;
  /** The positioned box the handles are placed inside. */
  canvas: RefObject<HTMLDivElement>;
  /** Starts a comment on whatever is selected. Absent when the page holds no comments. */
  onComment?: () => void;
  /** Copies a link to the block this id names. Absent when the page has no address. */
  onCopyLink?: (anchorId: string) => void;
}

/**
 * The grip and the plus button that follow the pointer down the document.
 * They live outside the editable DOM, so the drag is handed to ProseMirror by
 * setting `view.dragging` rather than by relying on native drag data.
 */
export function BlockHandles({ editor, canvas, onComment, onCopyLink }: BlockHandlesProps) {
  const [target, setTarget] = useState<HandleTarget | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const locate = useCallback(
    (event: MouseEvent): void => {
      const box = canvas.current;
      // The menu names one block, so the pointer must not move the handles off it.
      if (open) return;
      if (!box) return;
      const root = editor.view.dom;
      // The same answer the rubber band gives: the handles stand wherever a band may start,
      // so a reader never drags a run of blocks in a place that shows no grip.
      if (!aroundDocument(event.target)) {
        setTarget(null);
        return;
      }
      // The pointer is beside a block as often as it is on one: in the gutter the handles
      // stand in, past the end of a short line, or in the margin between two blocks.
      const block = topLevelBlock(root, event.target) ?? blockAtY(root, event.clientY);
      if (!block) {
        setTarget(null);
        return;
      }
      const pos = blockPos(editor, block);
      if (pos === null) {
        setTarget(null);
        return;
      }
      const rect = block.getBoundingClientRect();
      setTarget({ pos, top: rect.top - box.getBoundingClientRect().top, element: block });
    },
    [editor, canvas, open],
  );

  useEffect(() => {
    window.addEventListener('mousemove', locate);
    return () => window.removeEventListener('mousemove', locate);
  }, [locate]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!target || !editor.isEditable) return null;

  const select = (): void => {
    const selection = nodeSelectionAt(editor, target.pos);
    if (!selection) return;
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
  };

  const blockRange = (): { from: number; to: number } | null => {
    const node = editor.state.doc.nodeAt(target.pos);
    if (!node) return null;
    return { from: target.pos, to: target.pos + node.nodeSize };
  };

  const commentOnBlock = (): void => {
    const range = blockRange();
    setOpen(false);
    if (!range || !onComment) return;
    const { doc } = editor.state;
    // `between` walks to the nearest text, so a block that is not a textblock still works.
    const selection = TextSelection.between(doc.resolve(range.from + 1), doc.resolve(range.to - 1));
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
    onComment();
  };

  const copyLink = (): void => {
    setOpen(false);
    const id = anchorIdAt(editor.state.doc, target.pos);
    if (id === null || !onCopyLink) return;
    onCopyLink(id);
  };

  const remove = (): void => {
    const range = blockRange();
    setOpen(false);
    if (!range) return;
    editor.chain().focus().deleteRange(range).run();
  };

  const startDrag = (event: ReactDragEvent<HTMLButtonElement>): void => {
    // The grip stands beside one block, but a run of blocks may already be picked. Dragging
    // the grip of one of them moves the whole run, which is what the reader marked it for.
    if (holdsTarget(editor.state.selection, target.pos)) {
      startSelectionDrag(editor, target.element, event.dataTransfer);
      return;
    }
    startNodeDrag(editor, target.pos, target.element, event.dataTransfer);
  };

  const insertBelow = (): void => {
    const node = editor.state.doc.nodeAt(target.pos);
    if (!node) return;
    const end = target.pos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(end, { type: 'paragraph' })
      .setTextSelection(end + 1)
      // The slash character opens the block menu, exactly as typing it would.
      .insertContent('/')
      .run();
  };

  // A table keeps its own row grips against its left edge, so these two stack into a
  // single column to stay clear of them.
  const stacked = target.element.tagName === 'TABLE';

  return (
    <div
      className={`gd-editor-handles${stacked ? ' gd-editor-handles--stacked' : ''}`}
      style={{ top: `${Math.round(target.top)}px` }}
    >
      <button
        type="button"
        className="gd-editor-handles__btn"
        title="Insert a block below"
        aria-label="Insert a block below"
        onMouseDown={(event) => event.preventDefault()}
        onClick={insertBelow}
      >
        +
      </button>
      <button
        type="button"
        draggable
        className="gd-editor-handles__btn gd-editor-handles__btn--grip"
        title="Drag to move, click for actions"
        aria-label="Block actions"
        aria-haspopup="menu"
        aria-expanded={open}
        // The dismiss listener runs on mousedown, so a plain toggle here would reopen it.
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => {
          select();
          setOpen((current) => !current);
        }}
        onDragStart={startDrag}
      >
        <span aria-hidden="true">⠿</span>
      </button>

      {open ? (
        <div className="gd-editor-blockmenu" role="menu" aria-label="Block actions" ref={menuRef}>
          {onCopyLink ? (
            <button
              type="button"
              role="menuitem"
              className="gd-editor-blockmenu__item"
              onClick={copyLink}
            >
              Copy link to block
            </button>
          ) : null}
          {onComment ? (
            <button
              type="button"
              role="menuitem"
              className="gd-editor-blockmenu__item"
              onClick={commentOnBlock}
            >
              Comment
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="gd-editor-blockmenu__item gd-editor-blockmenu__item--danger"
            onClick={remove}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** True when a block selection is up and `pos` names one of the blocks in it. */
function holdsTarget(selection: Selection, pos: number): boolean {
  return selection instanceof BlockSelection && pos >= selection.from && pos < selection.to;
}

/** The top-level block that holds `y`, or the next one down when `y` is in a gap. */
function blockAtY(root: HTMLElement, y: number): HTMLElement | null {
  // The children are laid out top to bottom, so their bottom edges are sorted.
  const children = root.children;
  let low = 0;
  let high = children.length - 1;
  let found: HTMLElement | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const child = children[mid];
    if (!(child instanceof HTMLElement)) return null;
    if (child.getBoundingClientRect().bottom >= y) {
      found = child;
      high = mid - 1;
      continue;
    }
    low = mid + 1;
  }
  return found;
}

function topLevelBlock(root: HTMLElement, node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof HTMLElement)) return null;
  if (!root.contains(node) || node === root) return null;
  let current: HTMLElement = node;
  while (current.parentElement && current.parentElement !== root) {
    current = current.parentElement;
  }
  return current.parentElement === root ? current : null;
}

function blockPos(editor: Editor, element: HTMLElement): number | null {
  try {
    const inside = editor.view.posAtDOM(element, 0);
    const resolved = editor.state.doc.resolve(inside);
    return resolved.depth === 0 ? inside : resolved.before(1);
  } catch {
    return null;
  }
}

export default BlockHandles;
