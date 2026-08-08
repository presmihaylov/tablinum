import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PageEmbedView } from '../ui/PageEmbedView';
import { DATA } from '../markdown';

/** Everything the view needs about the page an embed names. */
export interface EmbeddedPage {
  path: string;
  title: string;
  icon: string | null;
  markdown: string;
}

export interface PageEmbedOptions {
  /** Fetches the embedded page, or null when there is no page at that path. */
  load: (path: string) => Promise<EmbeddedPage | null>;
  /** Opens the embedded page in the shell. */
  open: (path: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageEmbed: {
      insertPageEmbed: (target: string) => ReturnType;
    };
  }
}

/** `![[path]]` alone on a line: another page of the same repo, shown in place. */
export const PageEmbed = Node.create<PageEmbedOptions>({
  name: 'pageEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,

  addOptions() {
    return { load: () => Promise.resolve(null), open: () => undefined };
  },

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute(DATA.embed) ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          [DATA.embed]: typeof attributes['target'] === 'string' ? attributes['target'] : '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[${DATA.embed}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = typeof node.attrs['target'] === 'string' ? node.attrs['target'] : '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'gd-editor-pageembed gd-editor-pageembed--flat' }),
      `![[${target}]]`,
    ];
  },

  renderText({ node }) {
    return `![[${typeof node.attrs['target'] === 'string' ? node.attrs['target'] : ''}]]`;
  },

  addCommands() {
    return {
      insertPageEmbed:
        (target) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { target } }),
    };
  },
});

const WithPreview = PageEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PageEmbedView);
  },
});

export function createPageEmbed(interactive: boolean, options: PageEmbedOptions) {
  return (interactive ? WithPreview : PageEmbed).configure(options);
}

export default PageEmbed;
