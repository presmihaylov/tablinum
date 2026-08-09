import { Node, mergeAttributes } from '@tiptap/core';
import { DATA } from '../markdown';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mention: {
      insertMention: (attributes: { handle: string }) => ReturnType;
    };
  }
}

/**
 * `@handle`, an atomic inline reference to a person.
 *
 * The handle is the whole node: no id, no name and no link. A page read outside tablinum is
 * still readable, and a person who is renamed keeps every mention they were ever given.
 */
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      handle: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute(DATA.mention) ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          [DATA.mention]: typeof attributes['handle'] === 'string' ? attributes['handle'] : '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${DATA.mention}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const handle = typeof node.attrs['handle'] === 'string' ? node.attrs['handle'] : '';
    return ['span', mergeAttributes(HTMLAttributes, { class: 'gd-editor-mention' }), `@${handle}`];
  },

  renderText({ node }) {
    const handle = typeof node.attrs['handle'] === 'string' ? node.attrs['handle'] : '';
    return `@${handle}`;
  },

  addCommands() {
    return {
      insertMention:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { handle: attributes.handle } }),
    };
  },
});

export default Mention;
