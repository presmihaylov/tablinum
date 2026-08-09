import { Node, mergeAttributes } from '@tiptap/core';
import type { PagePath } from '@tablinum/shared';
import { pageHref } from '../../lib/href';
import { DATA } from '../markdown';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (attributes: { target: string; alias?: string | null }) => ReturnType;
    };
  }
}

/** `[[path|Label]]`, an atomic inline link to another page in the same repo. */
export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute(DATA.wikilink) ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          [DATA.wikilink]: typeof attributes['target'] === 'string' ? attributes['target'] : '',
        }),
      },
      alias: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(DATA.alias),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes['alias'] === 'string' ? { [DATA.alias]: attributes['alias'] } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `a[${DATA.wikilink}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = typeof node.attrs['target'] === 'string' ? node.attrs['target'] : '';
    const alias = typeof node.attrs['alias'] === 'string' ? node.attrs['alias'] : null;
    const label = alias === null || alias === '' ? target : alias;
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'gd-editor-wikilink',
        href: pageHref(toPagePath(target)),
      }),
      label,
    ];
  },

  renderText({ node }) {
    const target = typeof node.attrs['target'] === 'string' ? node.attrs['target'] : '';
    const alias = typeof node.attrs['alias'] === 'string' ? node.attrs['alias'] : null;
    return alias === null ? `[[${target}]]` : `[[${target}|${alias}]]`;
  },

  addCommands() {
    return {
      insertWikilink:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { target: attributes.target, alias: attributes.alias ?? null },
          }),
    };
  },
});

/** Wikilink targets are page paths; the shared type is a plain string alias. */
function toPagePath(target: string): PagePath {
  return target.replace(/^\/+/, '');
}

export default Wikilink;
