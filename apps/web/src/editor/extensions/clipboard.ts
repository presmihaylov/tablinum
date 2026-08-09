import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { serializeFragment } from '../markdown';

export const clipboardPluginKey = new PluginKey('tablinumClipboard');

/**
 * Copying out of the editor yields markdown, not the flattened text ProseMirror
 * produces by default. The tablinum serializer is used so a copied block reads the
 * same as the file it came from.
 */
export const MarkdownCopy = Extension.create({
  name: 'tablinumClipboard',
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
