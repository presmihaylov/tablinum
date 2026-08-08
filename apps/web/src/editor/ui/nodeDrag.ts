import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

/** The node selection that starts at `pos`, or null when nothing selectable does. */
export function nodeSelectionAt(editor: Editor, pos: number): NodeSelection | null {
  try {
    return NodeSelection.create(editor.state.doc, pos);
  } catch {
    return null;
  }
}

/**
 * Handles live outside the editable DOM, so the drag carries no native ProseMirror
 * data. Setting `view.dragging` by hand is what makes the drop behave like an
 * in-document move.
 */
export function startNodeDrag(
  editor: Editor,
  pos: number,
  image: HTMLElement,
  transfer: DataTransfer,
): void {
  const selection = nodeSelectionAt(editor, pos);
  if (!selection) return;
  const { view } = editor;
  view.dispatch(view.state.tr.setSelection(selection));
  view.dragging = { slice: selection.content(), move: true };
  transfer.effectAllowed = 'move';
  transfer.setDragImage(image, 0, 0);
}
