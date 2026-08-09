import { Extension, wrappingInputRule } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';

/**
 * `1)` is an ordered marker in CommonMark, but the stock rule only knows `1.`, so the line
 * stayed a paragraph and the bracket was escaped on save. The delimiter travels on the list,
 * or the serializer would write the item back as `1.`.
 */
export const OrderedListParen = Extension.create({
  name: 'tablinumOrderedListParen',

  addInputRules() {
    const type = this.editor.schema.nodes['orderedList'];
    if (type === undefined) return [];
    return [
      wrappingInputRule({
        find: /^(\d+)\)\s$/,
        type,
        getAttributes: (match) => ({ start: Number(match[1]), delimiter: ')' }),
        joinPredicate: (match, node) =>
          node.childCount + Number(node.attrs['start']) === Number(match[1]),
      }),
    ];
  },
});

/**
 * The keys that turn a list back into paragraphs. They are held here, above the list
 * extensions, because each stock shortcut calls `toggleList` directly.
 */
export const ListShortcuts = Extension.create({
  name: 'tablinumListShortcuts',
  priority: 200,

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-7': () =>
        toggleOrLift(this.editor, 'orderedList', 'listItem', () =>
          this.editor.commands.toggleOrderedList(),
        ),
      'Mod-Shift-8': () =>
        toggleOrLift(this.editor, 'bulletList', 'listItem', () =>
          this.editor.commands.toggleBulletList(),
        ),
      'Mod-Shift-9': () =>
        toggleOrLift(this.editor, 'taskList', 'taskItem', () =>
          this.editor.commands.toggleTaskList(),
        ),
    };
  },
});

/**
 * `toggleList` unwraps a list only when the selection resolves to a range inside it. Under
 * a whole-document selection the range sits at doc level, so the command took its wrap
 * branch instead: it nested the list in a second one and wrote every checkbox out as text.
 */
function toggleOrLift(
  editor: Editor,
  list: string,
  item: string,
  toggle: () => boolean,
): boolean {
  const { $from, $to } = editor.state.selection;
  const range = $from.blockRange($to);
  if (!editor.isActive(list) || (range !== null && range.depth > 0)) return toggle();

  const inside = inlineRange(editor.state);
  // A `can()` dry run is no help here: `setTextSelection` does nothing without a dispatch,
  // so the lift would be judged against the very selection it replaces. A lift that cannot
  // apply leaves the document alone, which is the right answer anyway.
  if (inside !== null) editor.chain().setTextSelection(inside).liftListItem(item).run();
  // Each stock shortcut sits in its own keymap, so `false` hands the key straight to the
  // command being avoided.
  return true;
}

/** The same span, moved onto the nearest text positions a block command can work with. */
function inlineRange(state: EditorState): { from: number; to: number } | null {
  const { from, to } = state.selection;
  const start = TextSelection.findFrom(state.doc.resolve(from), 1, true);
  const end = TextSelection.findFrom(state.doc.resolve(to), -1, true);
  if (start === null || end === null || start.from > end.to) return null;
  return { from: start.from, to: end.to };
}
