import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { MentionMenu } from '../ui/MentionMenu';
import { createSuggestionRenderer } from '../ui/suggestionRenderer';

export interface MentionItem {
  id: string;
  handle: string;
  name: string;
  color: string;
  avatarRev: string | null;
}

export interface MentionSuggestionOptions {
  /** Resolves people for the typed query. Supplied by the editor shell. */
  search: (query: string) => Promise<MentionItem[]>;
}

export const mentionPluginKey = new PluginKey('tablinumMention');

export const MentionSuggestion = Extension.create<MentionSuggestionOptions>({
  name: 'tablinumMentionSuggestion',

  addOptions() {
    return { search: () => Promise.resolve([]) };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        char: '@',
        pluginKey: mentionPluginKey,
        // Handles hold no spaces, and the default prefixes keep `mail@example.com` quiet.
        allowSpaces: false,
        items: ({ query }) => options.search(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertMention({ handle: props.handle }).run();
        },
        render: createSuggestionRenderer<MentionItem>(MentionMenu),
      }),
    ];
  },
});

export default MentionSuggestion;
