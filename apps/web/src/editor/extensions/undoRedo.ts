import { Extension } from '@tiptap/core';

/**
 * `Mod-z` right after an input rule fired takes that rule back, so the typed `->` returns.
 * `Shift-Mod-z` belongs in the same map and claims the press: prosemirror-keymap looks a shifted
 * press up again with `Shift-` stripped, which reaches this `Mod-z` and, in History's own map of
 * both keys, its whole-run undo. A shortcut sees no event, so it cannot read the shift key.
 */
export const UndoRedo = Extension.create({
  name: 'tablinumUndoRedo',
  // Ahead of the history extension, whose own `Mod-z` would otherwise take the key first.
  priority: 200,

  addKeyboardShortcuts() {
    return {
      // False when no rule just fired, and the key then falls through to history as always.
      'Mod-z': () => this.editor.commands.undoInputRule(),
      'Shift-Mod-z': () => {
        this.editor.commands.redo();
        return true;
      },
    };
  },
});
