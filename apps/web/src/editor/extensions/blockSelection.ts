import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

export const blockSelectionPluginKey = new PluginKey('tablinumBlockSelection');

/** The class the selected blocks carry. The stylesheet paints the whole band from it. */
export const SELECTED_CLASS = 'gd-block-selected';

/** The band left of the document the handles stand in. A drag may start there. */
const GUTTER = 72;
/** How far right of the document a drag may start. */
const EDGE = 24;

/**
 * A run of whole sibling blocks. Both ends sit between blocks rather than inside text, so a
 * delete takes the blocks themselves and not only the words in them.
 */
export class BlockSelection extends Selection {
  eq(other: Selection): boolean {
    return other instanceof BlockSelection && other.from === this.from && other.to === this.to;
  }

  map(doc: ProseMirrorNode, mapping: Mappable): Selection {
    const from = mapping.map(this.from, 1);
    const to = mapping.map(this.to, -1);
    if (to <= from) return Selection.near(doc.resolve(Math.min(from, doc.content.size)));
    return BlockSelection.between(doc, from, to);
  }

  override content(): Slice {
    return this.$from.doc.slice(this.from, this.to);
  }

  toJSON(): { type: string; from: number; to: number } {
    return { type: 'tablinumBlock', from: this.from, to: this.to };
  }

  static override fromJSON(doc: ProseMirrorNode, json: { from: number; to: number }): Selection {
    return BlockSelection.between(doc, json.from, json.to);
  }

  /**
   * The shortest run of whole sibling blocks that covers both positions. Two paragraphs give
   * the paragraphs; two items of one list give the items, not the list around them.
   */
  static between(doc: ProseMirrorNode, a: number, b: number): Selection {
    const range = siblingRange(doc, a, b);
    if (range === null) return Selection.near(doc.resolve(clamp(Math.min(a, b), 0, doc.content.size)));
    return new BlockSelection(doc.resolve(range.from), doc.resolve(range.to));
  }

  /** The whole blocks this selection covers, each as a position range. */
  blocks(): Array<{ from: number; to: number }> {
    const parent = this.$from.parent;
    const found: Array<{ from: number; to: number }> = [];
    let at = this.$from.pos - this.$from.parentOffset;
    parent.forEach((child) => {
      const start = at;
      at += child.nodeSize;
      if (start >= this.from && at <= this.to) found.push({ from: start, to: at });
    });
    return found;
  }
}

// The browser paints nothing for this selection, so the decorations below are the whole picture.
BlockSelection.prototype.visible = false;

// Registered so a state round trip keeps the selection. A hot reload runs this file again, and
// the second call would throw over an id already in the table.
try {
  Selection.jsonID('tablinumBlock', BlockSelection);
} catch {
  // already registered
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Widen two positions to whole blocks that share one parent. The deepest common ancestor
 * decides the granularity, so the range never reaches wider than the pair asks for.
 */
function siblingRange(doc: ProseMirrorNode, a: number, b: number): { from: number; to: number } | null {
  if (doc.childCount === 0) return null;
  const $a = doc.resolve(clamp(Math.min(a, b), 0, doc.content.size));
  const $b = doc.resolve(clamp(Math.max(a, b), 0, doc.content.size));
  const shared = $a.sharedDepth($b.pos);
  // Both ends inside one paragraph or one code block: the children there are words, not blocks.
  if ($a.node(shared).inlineContent) return null;
  const from = shared >= $a.depth ? $a.pos : $a.before(shared + 1);
  const to = shared >= $b.depth ? $b.pos : $b.after(shared + 1);
  if (to <= from) return null;
  return { from, to };
}

function decorate(state: EditorState): DecorationSet {
  const selection = state.selection;
  if (!(selection instanceof BlockSelection)) return DecorationSet.empty;
  const found = selection
    .blocks()
    .map((block) => Decoration.node(block.from, block.to, { class: SELECTED_CLASS }));
  return DecorationSet.create(state.doc, found);
}

/** The position of the block beside `clientY`, reached by aiming at the left of the text column. */
function blockPosAt(view: EditorView, clientY: number): number | null {
  const rect = view.dom.getBoundingClientRect();
  try {
    const found = view.posAtCoords({
      left: rect.left + 4,
      top: clamp(clientY, rect.top + 1, rect.bottom - 1),
    });
    return found?.pos ?? null;
  } catch {
    // The lookup needs a laid-out document, which a detached or headless one is not.
    return null;
  }
}

/** True when a drag from this point belongs to the gutter rather than to a control on it. */
function startsInGutter(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (view.dom.contains(target)) return false;
  if (target.closest('button, a, input, textarea, [role="menu"], [contenteditable="true"]')) return false;
  const rect = view.dom.getBoundingClientRect();
  return (
    event.clientX >= rect.left - GUTTER &&
    event.clientX <= rect.right + EDGE &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

/**
 * A drag that crossed a block boundary becomes a block selection once the button comes up.
 * Halfway through the first block and halfway through the last is never what the reader meant
 * by dragging over them, and Backspace would leave the two halves fused into one block.
 */
function snapToBlocks(view: EditorView): void {
  if (view.isDestroyed) return;
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return;
  const next = BlockSelection.between(view.state.doc, selection.from, selection.to);
  // One block covered means the reader picked words inside it, which is not a block selection.
  if (!(next instanceof BlockSelection) || next.blocks().length < 2) return;
  view.dispatch(view.state.tr.setSelection(next));
}

function collapse(view: EditorView, side: -1 | 1): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof BlockSelection)) return false;
  const at = side < 0 ? selection.from : selection.to;
  const tr = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at), side));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Selecting whole blocks by dragging, either beside them in the gutter or across them.
 * ProseMirror's own selections cover one node or one run of text; this one covers several
 * blocks, so Backspace and Delete take all of them away at once.
 */
export const BlockSelect = Extension.create({
  name: 'tablinumBlockSelect',

  addKeyboardShortcuts() {
    const view = (): EditorView => this.editor.view;
    return {
      Escape: () => collapse(view(), -1),
      ArrowUp: () => collapse(view(), -1),
      ArrowLeft: () => collapse(view(), -1),
      ArrowDown: () => collapse(view(), 1),
      ArrowRight: () => collapse(view(), 1),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockSelectionPluginKey,

        props: {
          decorations: (state) => decorate(state),

          // A drag inside the document is the browser's until the button comes up.
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button !== 0 || event.detail > 1) return false;
              const snap = (): void => {
                window.removeEventListener('mouseup', snap);
                // The view writes the DOM selection into the state after this event runs.
                window.setTimeout(() => snapToBlocks(view), 0);
              };
              window.addEventListener('mouseup', snap);
              return false;
            },
          },
        },

        view: (view) => {
          let anchor: number | null = null;

          const move = (event: MouseEvent): void => {
            if (anchor === null) return;
            const pos = blockPosAt(view, event.clientY);
            if (pos === null) return;
            const next = BlockSelection.between(view.state.doc, anchor, pos);
            if (next.eq(view.state.selection)) return;
            view.dispatch(view.state.tr.setSelection(next));
          };

          const up = (): void => {
            anchor = null;
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };

          const down = (event: MouseEvent): void => {
            if (!startsInGutter(view, event)) return;
            const pos = blockPosAt(view, event.clientY);
            if (pos === null) return;
            anchor = pos;
            event.preventDefault();
            view.dispatch(view.state.tr.setSelection(BlockSelection.between(view.state.doc, pos, pos)));
            view.focus();
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          };

          window.addEventListener('mousedown', down);

          return {
            destroy: () => {
              up();
              window.removeEventListener('mousedown', down);
            },
          };
        },
      }),
    ];
  },
});

export default BlockSelect;
