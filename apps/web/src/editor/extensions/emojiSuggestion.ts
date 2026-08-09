import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { shortcodeOf } from '@tablinum/shared';
import { EmojiMenu } from '../ui/EmojiMenu';
import { matchEmoji } from '../ui/emoji';
import type { EmojiEntry } from '../ui/emoji';
import { createSuggestionRenderer } from '../ui/suggestionRenderer';

export const emojiPluginKey = new PluginKey('tablinumEmoji');

/** `:query` at the caret offers emoji: a plain UTF-8 character, or an uploaded image. */
export const EmojiSuggestion = Extension.create({
  name: 'tablinumEmojiSuggestion',

  addProseMirrorPlugins() {
    return [
      Suggestion<EmojiEntry, EmojiEntry>({
        editor: this.editor,
        char: ':',
        pluginKey: emojiPluginKey,
        allowSpaces: false,
        // People type the closing colon of `:fire:` out of habit, so let the query
        // hold it rather than end the match on it.
        allowToIncludeChar: true,
        items: ({ query }) => matchEmoji(query),
        command: ({ editor, range, props }) => {
          const chain = editor.chain().focus().deleteRange(range);
          const shortcode = shortcodeOf(props.char);
          if (shortcode === null) {
            chain.insertContent(props.char).run();
            return;
          }
          chain.insertCustomEmoji({ shortcode }).run();
        },
        render: createSuggestionRenderer<EmojiEntry>(EmojiMenu),
      }),
    ];
  },
});

export default EmojiSuggestion;
