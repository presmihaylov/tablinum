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

/** How far the pointer may travel and still count as a click rather than a drag. */
const SLOP = 4;
/** The class the rubber band carries. The stylesheet paints it. */
export const BAND_CLASS = 'gd-block-band';

/**
 * The mark the shell puts on every box of blank room around the document, and on nothing else.
 * An opt-in, because the boxes the document merely sits inside include the scroller and the
 * page itself, and telling those apart by measurement takes more rules than the mark does.
 * `warnUnmarked` below shouts when a shell marks nothing at all.
 */
export const BAND_CANVAS = '[data-band-canvas]';

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

/**
 * The box a drag paints between the point it started at and the pointer. It hangs off the body
 * and takes no pointer events, so nothing on the page clips it or is hidden behind it.
 */
class Band {
  #node: HTMLDivElement | null = null;

  draw(from: { x: number; y: number }, to: { x: number; y: number }): void {
    if (this.#node === null) {
      this.#node = document.createElement('div');
      this.#node.className = BAND_CLASS;
      this.#node.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.#node);
    }
    const style = this.#node.style;
    style.left = `${Math.min(from.x, to.x)}px`;
    style.top = `${Math.min(from.y, to.y)}px`;
    style.width = `${Math.abs(to.x - from.x)}px`;
    style.height = `${Math.abs(to.y - from.y)}px`;
  }

  clear(): void {
    this.#node?.remove();
    this.#node = null;
  }
}

/**
 * True when the point landed on the blank room itself. A button, a link or a block is its own
 * target, and a scroller reports its own bar as a press on the scroller, so none of them match.
 */
function besideDocument(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(BAND_CANVAS);
}

/** True when the point landed anywhere in that room: on the document, beside it, or on a grip. */
export function aroundDocument(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(BAND_CANVAS) !== null;
}

/**
 * True when the press is a plain one, so it asks for a fresh selection and nothing else.
 * `detail <= 1` is the first click of the count: a double click picks a word and a triple one
 * picks a paragraph, and both are the browser's to answer.
 */
function plainPress(event: MouseEvent): boolean {
  return event.button === 0 && !event.defaultPrevented && event.detail <= 1 && !event.shiftKey;
}

/** How a press starts out, or null when it is no business of this plugin. */
function pressPhase(view: EditorView, event: MouseEvent): 'beside' | 'on' | null {
  if (!plainPress(event)) return null;
  if (besideDocument(event.target)) return 'beside';
  const target = event.target;
  if (target instanceof Element && view.dom.contains(target)) return 'on';
  return null;
}

/** True when the point sits under the last block, in the blank room the editor keeps there. */
function belowLastBlock(view: EditorView, clientY: number): boolean {
  const doc = view.state.doc;
  const last = doc.lastChild;
  if (last === null) return false;
  const dom = view.nodeDOM(doc.content.size - last.nodeSize);
  if (!(dom instanceof HTMLElement)) return false;
  return clientY > dom.getBoundingClientRect().bottom;
}

/**
 * Put the caret on an empty line at the end of the document, adding that line only when the
 * last block is not already one. A click under a table or a database otherwise leaves a gap
 * cursor, and the reader has to press Enter before there is anything to write on.
 *
 * The line never reaches the file: the serializer writes the same bytes with it and without
 * it, so no save is queued. The round trip suite pins those bytes over the whole corpus,
 * because the day they differ every stray click here becomes a commit.
 *
 * It stays out of the undo stack as well, so Cmd+Z after a stray click takes back the last
 * real edit rather than a line the reader never typed.
 *
 * It is not free, though: the stream sends every transaction that changed the document, so a
 * click here does broadcast one step to the other readers of a shared page. They see an empty
 * line appear at the end, and it goes away on their next load.
 */
function landAtEnd(view: EditorView): void {
  if (!view.editable) return;
  const paragraph = view.state.schema.nodes.paragraph;
  if (paragraph === undefined) return;
  const { doc } = view.state;
  const last = doc.lastChild;
  const ready = last !== null && last.type === paragraph && last.content.size === 0;
  // Nothing to add when the line is already there: a second click only puts the caret back.
  const tr = ready ? view.state.tr : view.state.tr.insert(doc.content.size, paragraph.create());
  view.dispatch(
    tr
      .setMeta('addToHistory', false)
      .setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1))
      .scrollIntoView(),
  );
  view.focus();
}

/**
 * The run of whole blocks two positions cover, but only once they reach past one block.
 * Inside a single block the pair names words, which is not a block selection.
 */
function runAcross(view: EditorView, from: number, to: number): BlockSelection | null {
  const next = BlockSelection.between(view.state.doc, from, to);
  if (!(next instanceof BlockSelection) || next.blocks().length < 2) return null;
  return next;
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
  const next = runAcross(view, selection.from, selection.to);
  if (next === null) return;
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

/** Said at most once a page, however many editors a page mounts. */
let unmarkedWarned = false;

/**
 * Shout when the shell put the document inside no marked box at all. That is the one way the
 * opt-in above rots quietly: a band that never starts looks exactly like a page with nothing
 * to select. Deferred a tick, because the React wrapper moves the document into the page
 * after the view is built.
 */
function warnUnmarked(view: EditorView): void {
  if (!import.meta.env.DEV || unmarkedWarned) return;
  window.setTimeout(() => {
    // A headless editor stands in no shell, so it has nothing to mark and nothing to say.
    if (view.isDestroyed || !view.dom.isConnected) return;
    if (view.dom.closest(BAND_CANVAS) !== null || unmarkedWarned) return;
    unmarkedWarned = true;
    console.warn(
      `[tablinum] the document stands in no ${BAND_CANVAS} box: no drag beside it picks blocks, ` +
        'and no click below it gives a line to write on. Mark the blank room around it.',
    );
  }, 0);
}

/** A button that is down. The phase is where it went down, until the pointer makes it a drag. */
interface Press {
  phase: 'beside' | 'on' | 'dragging';
  /** The block the drag holds one end at, or null where the lookup found none. */
  anchor: number | null;
  start: { x: number; y: number };
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

          // A drag inside the document is the browser's until the button comes up, and the
          // release widens whatever it marked to whole blocks. Every plain press registers
          // this, and so does a shift click, which the band itself turns down: the band takes
          // over a plain drag only once the marked stretch reaches past one block, and it
          // never takes a shift click at all. A double or a triple click registers nothing,
          // because picking a word and picking a paragraph are the browser's to answer.
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
          warnUnmarked(view);
          const band = new Band();
          // The button that is down now, and nothing else: the two listeners `down` registers
          // live exactly as long as this record does, so their presence is the rest of the state.
          let press: Press | null = null;

          /** True once the pointer has travelled far enough to mean a drag and not a click. */
          const far = (from: Press, event: MouseEvent): boolean =>
            Math.abs(event.clientX - from.start.x) > SLOP ||
            Math.abs(event.clientY - from.start.y) > SLOP;

          /**
           * A drag beside the document begins. The caret and the focus land here rather than
           * on the press: a press beside the page title would otherwise take the caret out of
           * the title, and the caret it lands on flashes inside the document under a press
           * below it. There is nothing to hand over on the document, which has the caret.
           */
          const armBeside = (from: Press): void => {
            from.phase = 'dragging';
            if (from.anchor === null) return;
            view.dispatch(
              view.state.tr.setSelection(
                BlockSelection.between(view.state.doc, from.anchor, from.anchor),
              ),
            );
            view.focus();
          };

          // A press on the document leaves the words to the browser. Once the marked stretch
          // reaches past the block it began in, the reader is picking blocks, not words, so
          // the box takes the drag over from there.
          const crossedBlocks = (): boolean => {
            const selection = view.state.selection;
            if (!(selection instanceof TextSelection) || selection.empty) return false;
            return runAcross(view, selection.from, selection.to) !== null;
          };

          const move = (event: MouseEvent): void => {
            const from = press;
            if (from === null) return;
            if (from.phase === 'beside') {
              if (!far(from, event)) return;
              armBeside(from);
            }
            if (from.phase === 'on') {
              if (!crossedBlocks()) return;
              from.phase = 'dragging';
            }
            // Painted first, so the box follows the pointer even over a gap the lookup misses.
            band.draw(from.start, { x: event.clientX, y: event.clientY });
            const pos = blockPosAt(view, event.clientY);
            if (from.anchor === null || pos === null) return;
            const next = BlockSelection.between(view.state.doc, from.anchor, pos);
            if (next.eq(view.state.selection)) return;
            view.dispatch(view.state.tr.setSelection(next));
          };

          const up = (event: MouseEvent): void => {
            const from = press;
            cancel();
            // A press and a release on the same spot is a click, and a click under the last
            // block asks for a line to write on rather than for a run of blocks.
            if (from === null || from.phase === 'dragging' || far(from, event)) return;
            if (!belowLastBlock(view, event.clientY)) return;
            landAtEnd(view);
          };

          /** Drop the press and decide nothing. Teardown wants this; a release decides first. */
          const cancel = (): void => {
            press = null;
            band.clear();
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };

          const down = (event: MouseEvent): void => {
            const phase = pressPhase(view, event);
            if (phase === null) return;
            press = {
              phase,
              anchor: blockPosAt(view, event.clientY),
              start: { x: event.clientX, y: event.clientY },
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
            if (phase === 'on') return;
            // Beside the document there is nothing native to start, and letting the browser
            // start one would mark the whole page instead. The press decides nothing else:
            // `armBeside` answers a drag and `up` answers a click.
            event.preventDefault();
          };

          window.addEventListener('mousedown', down);

          return {
            destroy: () => {
              cancel();
              window.removeEventListener('mousedown', down);
            },
          };
        },
      }),
    ];
  },
});

export default BlockSelect;
