import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { EmojiMenu } from '../ui/EmojiMenu';
import { matchEmoji } from '../ui/emoji';
import type { EmojiEntry } from '../ui/emoji';
import { createSuggestionRenderer } from '../ui/suggestionRenderer';

export const emojiPluginKey = new PluginKey('gitdocsEmoji');

/** `:query` at the caret offers emoji. The character it inserts is plain UTF-8. */
export const EmojiSuggestion = Extension.create({
  name: 'gitdocsEmojiSuggestion',

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
          editor.chain().focus().deleteRange(range).insertContent(props.char).run();
        },
        render: createSuggestionRenderer<EmojiEntry>(EmojiMenu),
      }),
    ];
  },
});

export default EmojiSuggestion;
