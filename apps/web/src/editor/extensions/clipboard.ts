import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { serializeFragment } from '../markdown';

export const clipboardPluginKey = new PluginKey('gitdocsClipboard');

/**
 * Copying out of the editor yields markdown, not the flattened text ProseMirror
 * produces by default. The gitdocs serializer is used so a copied block reads the
 * same as the file it came from.
 */
export const MarkdownCopy = Extension.create({
  name: 'gitdocsClipboard',
  priority: 60,

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: clipboardPluginKey,
        props: {
          clipboardTextSerializer: (slice) => serializeFragment(slice.content, editor.schema),
        },
      }),
    ];
  },
});

export default MarkdownCopy;
