import { useCallback, useEffect, useState } from 'react';
import type { DragEvent as ReactDragEvent, RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { nodeSelectionAt, startNodeDrag } from './nodeDrag';

interface HandleTarget {
  pos: number;
  top: number;
  element: HTMLElement;
}

export interface BlockHandlesProps {
  editor: Editor;
  /** The positioned box the handles are placed inside. */
  canvas: RefObject<HTMLDivElement>;
}

/**
 * The grip and the plus button that follow the pointer down the document.
 * They live outside the editable DOM, so the drag is handed to ProseMirror by
 * setting `view.dragging` rather than by relying on native drag data.
 */
export function BlockHandles({ editor, canvas }: BlockHandlesProps) {
  const [target, setTarget] = useState<HandleTarget | null>(null);

  const locate = useCallback(
    (event: MouseEvent): void => {
      const box = canvas.current;
      if (!box) return;
      const root = editor.view.dom;
      if (!nearDocument(root, event)) {
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
    [editor, canvas],
  );

  useEffect(() => {
    window.addEventListener('mousemove', locate);
    return () => window.removeEventListener('mousemove', locate);
  }, [locate]);

  if (!target || !editor.isEditable) return null;

  const select = (): void => {
    const selection = nodeSelectionAt(editor, target.pos);
    if (!selection) return;
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
  };

  const startDrag = (event: ReactDragEvent<HTMLButtonElement>): void => {
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
        title="Drag to move, click to select"
        aria-label="Drag to move the block"
        onClick={select}
        onDragStart={startDrag}
      >
        <span aria-hidden="true">⠿</span>
      </button>
    </div>
  );
}

/** The gutter the handles stand in, to the left of the editable box. */
const GUTTER = 72;
/** How far past the other three edges the pointer may go and still hold the handles. */
const EDGE = 24;

function nearDocument(root: HTMLElement, event: MouseEvent): boolean {
  const rect = root.getBoundingClientRect();
  return (
    event.clientX >= rect.left - GUTTER &&
    event.clientX <= rect.right + EDGE &&
    event.clientY >= rect.top - EDGE &&
    event.clientY <= rect.bottom + EDGE
  );
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
