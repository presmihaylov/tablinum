import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { SHORTCODE_PATTERN, customEmojiUrl, shortcodeOf, shortcodeToken } from '@tablinum/shared';
import { isCustomEmoji } from '../../lib/customEmoji';
import { DATA } from '../markdown';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customEmoji: {
      insertCustomEmoji: (attributes: { shortcode: string }) => ReturnType;
    };
  }
}

const stringAttr = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * `:parrot:`, an atomic inline image somebody uploaded.
 *
 * The shortcode is the whole node. The file keeps the plain `:parrot:` text and the picture is
 * resolved when it is drawn, so a page read outside tablinum still says what it means and the
 * content repo never holds a binary.
 */
export const CustomEmoji = Node.create({
  name: 'customEmoji',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      shortcode: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute(DATA.emoji) ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          [DATA.emoji]: stringAttr(attributes['shortcode']),
        }),
      },
    };
  },

  parseHTML() {
    // The span is what the markdown parser writes; the img is what a copy out of the editor holds.
    return [{ tag: `span[${DATA.emoji}]` }, { tag: `img[${DATA.emoji}]`, priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const shortcode = stringAttr(node.attrs['shortcode']);
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        class: 'gd-editor-emoji-inline',
        src: customEmojiUrl(shortcode),
        alt: shortcodeToken(shortcode),
        draggable: 'false',
      }),
    ];
  },

  renderText({ node }) {
    return shortcodeToken(stringAttr(node.attrs['shortcode']));
  },

  addInputRules() {
    return [
      new InputRule({
        find: new RegExp(`:(${SHORTCODE_PATTERN}):$`),
        handler: ({ state, range, match }) => {
          const shortcode = match[1] ?? '';
          // No steps means no match, which is how a rule declines a name nobody uploaded.
          if (!isCustomEmoji(shortcode)) return;
          state.tr.replaceWith(range.from, range.to, this.type.create({ shortcode }));
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertCustomEmoji:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { shortcode: attributes.shortcode } }),
    };
  },
});

/** Puts a picked emoji at the caret: a unicode one is text, an uploaded one is a node. */
export function insertEmoji(editor: Editor | null, emoji: string): void {
  if (!editor) return;
  const shortcode = shortcodeOf(emoji);
  if (shortcode === null) {
    editor.chain().focus().insertContent(emoji).run();
    return;
  }
  editor.chain().focus().insertCustomEmoji({ shortcode }).run();
}

export default CustomEmoji;
