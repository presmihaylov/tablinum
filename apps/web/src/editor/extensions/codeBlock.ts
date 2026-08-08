import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CodeBlockView } from '../ui/CodeBlockView';
import { LANG_PREFIX } from '../markdown';
import { lowlight } from './languages';

/**
 * `tiptap-markdown` ships a default parse hook for this node name that rewrites
 * the rendered `<pre>`. The dialect already emits exactly the markup the schema
 * wants, so the hook is shadowed with an empty one.
 */
/** Two spaces, not a tab: the character survives every markdown reader the same way. */
const INDENT = '  ';

const Base = CodeBlockLowlight.extend({
  addStorage() {
    return { markdown: { parse: {} } };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Tab moved the browser focus out of the editor and lost the caret. `Shift-Tab` stays
      // unbound on purpose, so the keyboard can still leave the block. `Mod-Enter` also
      // leaves it: `setHardBreak` tries `exitCode` first.
      Tab: () => {
        if (!this.editor.isActive(this.name)) return false;
        return this.editor.commands.command(({ tr }) => {
          tr.insertText(INDENT);
          return true;
        });
      },
    };
  },
});

const WithPicker = Base.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});

export function createCodeBlock(withLanguagePicker: boolean) {
  const extension = withLanguagePicker ? WithPicker : Base;
  return extension.configure({
    lowlight,
    languageClassPrefix: LANG_PREFIX,
    HTMLAttributes: { class: 'gd-editor-code' },
  });
}
