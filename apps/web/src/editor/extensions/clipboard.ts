import { Extension } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
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
  // The plain-text half is what needs this. ProseMirror takes the first plugin that answers
  // `clipboardTextSerializer`, and tiptap's own `ClipboardTextSerializer` declares no priority,
  // so it runs at the default 100. Below 101 the core one wins and the markdown never ships.
  // `clipboardSerializer` below needs no bump: no other plugin in the tree declares it.
  priority: 101,

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: clipboardPluginKey,
        props: {
          clipboardSerializer: buildClipboardSerializer(editor.schema),
          clipboardTextSerializer: (slice) => serializeFragment(slice.content, editor.schema),
        },
      }),
    ];
  },
});

/**
 * The editor draws a task item as `<li><label><input></label><div><p>text</p></div></li>`,
 * because the checkbox has to sit outside the editable content. Every importer that reads
 * block tags takes that inner `<div><p>` for a block of its own, so Notion pastes an empty
 * to-do followed by a loose paragraph. The clipboard gets a flat `<li><input>text</li>`
 * instead. Only the copy is reshaped; the on-screen DOM is untouched.
 */
function buildClipboardSerializer(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  const renderItem = base.nodes['taskItem'];
  if (renderItem === undefined) return base;

  const flatTaskItem = (node: PMNode): { dom: HTMLElement } => {
    // The item's own `<li>` is kept, so every dialect attribute it renders - the marker, the
    // source number, the blank-line gap - survives a copy and the file still round trips.
    const { dom } = DOMSerializer.renderSpec(document, renderItem(node));
    const box = document.createElement('input');
    box.setAttribute('type', 'checkbox');
    if (node.attrs['checked'] === true) box.setAttribute('checked', 'checked');
    dom.replaceChildren(box);
    node.forEach((child, _offset, index) => {
      // The label goes in as inline content. A `<p>` around it is exactly what makes an
      // importer open a second block.
      if (index === 0 && child.type.name === 'paragraph') {
        dom.append(serializer.serializeFragment(child.content));
        return;
      }
      dom.append(serializer.serializeNode(child));
    });
    return { dom };
  };

  // `flatTaskItem` reads `serializer` on a copy, long after this returns. It has to be the
  // custom one, so a task list nested inside an item is flattened as well.
  const serializer = new DOMSerializer({ ...base.nodes, taskItem: flatTaskItem }, base.marks);
  return serializer;
}

export default MarkdownCopy;
