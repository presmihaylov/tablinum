import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { RemoteCaret } from '../lib/docRoom';

export const caretsKey = new PluginKey<CaretState>('gdRemoteCarets');

interface CaretState {
  carets: Map<string, RemoteCaret>;
}

type CaretAction =
  | { kind: 'set'; caret: RemoteCaret }
  | { kind: 'drop'; client: string }
  | { kind: 'clear' };

function dispatch(view: EditorView, action: CaretAction): void {
  view.dispatch(view.state.tr.setMeta(caretsKey, action));
}

/** Put another tab's caret on screen, or move one that is already there. */
export function setCaret(view: EditorView, caret: RemoteCaret): void {
  dispatch(view, { kind: 'set', caret });
}

/** Take one tab's caret off screen, because it left the page. */
export function dropCaret(view: EditorView, client: string): void {
  dispatch(view, { kind: 'drop', client });
}

/** Take every caret off screen, because the document underneath them was replaced. */
export function clearCarets(view: EditorView): void {
  dispatch(view, { kind: 'clear' });
}

function clamp(position: number, size: number): number {
  if (!Number.isFinite(position) || position < 0) return 0;
  return Math.min(position, size);
}

/** How long a name tag stays up after its caret moves. */
const NAME_MS = 1_600;

function caretWidget(caret: RemoteCaret): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'gd-caret gd-caret--active';
  wrapper.style.setProperty('--gd-caret-color', caret.user.color);

  const name = document.createElement('span');
  name.className = 'gd-caret__name';
  name.textContent = caret.user.name;
  wrapper.appendChild(name);

  // A widget is rebuilt when its caret moves, so this shows the name on every move and
  // then gets out of the way of the text it sits above.
  setTimeout(() => wrapper.classList.remove('gd-caret--active'), NAME_MS);
  return wrapper;
}

function decorationsFor(carets: Map<string, RemoteCaret>, doc: ProseNode): DecorationSet {
  const size = doc.content.size;
  const decorations: Decoration[] = [];

  for (const caret of carets.values()) {
    const anchor = clamp(caret.anchor, size);
    const head = clamp(caret.head, size);
    // side: 1 keeps the marker after text typed at the same spot, so a person's own
    // characters never appear on the far side of somebody else's caret.
    decorations.push(
      Decoration.widget(head, () => caretWidget(caret), { side: 1, key: `caret-${caret.client}` }),
    );
    if (anchor === head) continue;
    decorations.push(
      Decoration.inline(Math.min(anchor, head), Math.max(anchor, head), {
        class: 'gd-caret__range',
        style: `--gd-caret-color: ${caret.user.color}`,
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * Everyone else's caret and selection, drawn over the shared document. Positions are mapped
 * through every transaction, so a caret keeps its place while the text around it moves.
 */
export function remoteCarets(): Plugin<CaretState> {
  return new Plugin<CaretState>({
    key: caretsKey,
    state: {
      init: (): CaretState => ({ carets: new Map() }),
      apply(tr, value): CaretState {
        const action: CaretAction | undefined = tr.getMeta(caretsKey);
        let carets = value.carets;

        if (tr.docChanged && carets.size > 0) {
          carets = new Map(
            [...carets].map(([id, caret]) => [
              id,
              { ...caret, anchor: tr.mapping.map(caret.anchor), head: tr.mapping.map(caret.head) },
            ]),
          );
        }
        if (action === undefined) return carets === value.carets ? value : { carets };
        if (action.kind === 'clear') return { carets: new Map() };

        const next = new Map(carets);
        if (action.kind === 'drop') next.delete(action.client);
        if (action.kind === 'set') next.set(action.caret.client, action.caret);
        return { carets: next };
      },
    },
    props: {
      decorations(state): DecorationSet | undefined {
        const value = caretsKey.getState(state);
        if (value === undefined || value.carets.size === 0) return undefined;
        return decorationsFor(value.carets, state.doc);
      },
    },
  });
}
