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
const Base = CodeBlockLowlight.extend({
  addStorage() {
    return { markdown: { parse: {} } };
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
