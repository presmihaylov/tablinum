import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';

export interface FloatingBarProps {
  editor: Editor;
  /** Decides, on every transaction, whether the bar belongs on screen. */
  shouldShow: (editor: Editor) => boolean;
  label: string;
  children: ReactNode;
}

interface Spot {
  left: number;
  top: number;
  above: boolean;
}

const GAP = 8;
const EDGE = 90;

/**
 * A toolbar pinned to the selection. Positioning is done here rather than with a
 * popper library: the bar is one small box, and the caret rectangle is enough.
 */
export function FloatingBar({ editor, shouldShow, label, children }: FloatingBarProps) {
  const [spot, setSpot] = useState<Spot | null>(null);

  useEffect(() => {
    const update = (): void => setSpot(place(editor, shouldShow));
    update();
    editor.on('transaction', update);
    editor.on('focus', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      editor.off('transaction', update);
      editor.off('focus', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [editor, shouldShow]);

  if (!spot) return null;

  return createPortal(
    <div
      className="gd-editor-bar"
      role="toolbar"
      aria-label={label}
      style={{
        position: 'fixed',
        left: `${spot.left}px`,
        top: `${spot.top}px`,
        transform: spot.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        zIndex: 55,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function place(editor: Editor, shouldShow: (editor: Editor) => boolean): Spot | null {
  if (editor.isDestroyed || !editor.isEditable) return null;
  if (!shouldShow(editor)) return null;

  const { from, to } = editor.state.selection;
  const start = coords(editor, from);
  const end = coords(editor, to);
  if (!start || !end) return null;

  const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
  const above = start.top > 120;
  const limit = Math.max(EDGE, window.innerWidth - EDGE);
  return {
    left: Math.round(Math.min(Math.max(centre, EDGE), limit)),
    top: Math.round(above ? start.top - GAP : end.bottom + GAP),
    above,
  };
}

function coords(editor: Editor, pos: number): { left: number; right: number; top: number; bottom: number } | null {
  try {
    return editor.view.coordsAtPos(pos);
  } catch {
    return null;
  }
}

export default FloatingBar;
