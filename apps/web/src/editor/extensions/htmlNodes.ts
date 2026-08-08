import { Node, mergeAttributes } from '@tiptap/core';
import type { Attributes } from '@tiptap/core';
import { DATA, decodeRaw, encodeRaw } from '../markdown';

/**
 * Raw HTML and HTML comments are kept verbatim as atoms. Re-rendering them as
 * live DOM would let ProseMirror rewrite the author's markup, so the source
 * travels percent-encoded on a data attribute and never round-trips through
 * a parser.
 */
function rawAttribute(): Attributes {
  return {
    raw: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeRaw(element.getAttribute(DATA.html) ?? ''),
      renderHTML: (attributes: Record<string, unknown>) => ({
        [DATA.html]: encodeRaw(typeof attributes['raw'] === 'string' ? attributes['raw'] : ''),
      }),
    },
  };
}

export const HtmlBlock = Node.create({
  name: 'htmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,

  addAttributes() {
    return rawAttribute();
  },

  parseHTML() {
    return [{ tag: `div[${DATA.html}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const raw = typeof node.attrs['raw'] === 'string' ? node.attrs['raw'] : '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'gd-editor-html gd-editor-html--block' }),
      raw,
    ];
  },

  renderText({ node }) {
    return typeof node.attrs['raw'] === 'string' ? node.attrs['raw'] : '';
  },
});

export const HtmlInline = Node.create({
  name: 'htmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return rawAttribute();
  },

  parseHTML() {
    return [{ tag: `span[${DATA.html}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const raw = typeof node.attrs['raw'] === 'string' ? node.attrs['raw'] : '';
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'gd-editor-html gd-editor-html--inline' }),
      raw,
    ];
  },

  renderText({ node }) {
    return typeof node.attrs['raw'] === 'string' ? node.attrs['raw'] : '';
  },
});
