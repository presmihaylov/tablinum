import { useCallback, useEffect, useState } from 'react';
import type { DragEvent as ReactDragEvent, RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

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
      const block = topLevelBlock(root, event.target);
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
    const box = canvas.current;
    if (!box) return;
    const clear = (): void => setTarget(null);
    box.addEventListener('mousemove', locate);
    box.addEventListener('mouseleave', clear);
    return () => {
      box.removeEventListener('mousemove', locate);
      box.removeEventListener('mouseleave', clear);
    };
  }, [locate, canvas]);

  if (!target || !editor.isEditable) return null;

  const select = (): void => {
    const selection = nodeSelection(editor, target.pos);
    if (!selection) return;
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
  };

  const startDrag = (event: ReactDragEvent<HTMLButtonElement>): void => {
    const selection = nodeSelection(editor, target.pos);
    if (!selection) return;
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(selection));
    view.dragging = { slice: selection.content(), move: true };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(target.element, 0, 0);
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

  return (
    <div className="gd-editor-handles" style={{ top: `${Math.round(target.top)}px` }}>
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

function nodeSelection(editor: Editor, pos: number): NodeSelection | null {
  try {
    return NodeSelection.create(editor.state.doc, pos);
  } catch {
    return null;
  }
}

export default BlockHandles;
