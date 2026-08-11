import { Extension } from '@tiptap/core';

/**
 * `Mod-z` right after an input rule fired takes that rule back, so the `# ` or the `->` comes
 * back the way it was typed. Backspace already does this on its own, from the rule runner.
 *
 * `Shift-Mod-z` has to be bound here as well, and has to report the press as handled even when
 * there is nothing to redo. prosemirror-keymap answers a shifted press by looking the shifted
 * name up first and then, whatever that returned, looking the name up again with `Shift-`
 * stripped. Without this binding a redo press reaches the `Mod-z` entry above, and on the run
 * where no rule is pending it carries on to history and undoes the whole typed run instead.
 */
export const InputRuleUndo = Extension.create({
  name: 'tablinumInputRuleUndo',
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
