import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { MentionCandidate } from '../../components/ui/PersonRow';
import { MentionMenu } from '../ui/MentionMenu';
import { createSuggestionRenderer } from '../ui/suggestionRenderer';

export interface MentionSuggestionOptions {
  /** Resolves people for the typed query. Supplied by the editor shell. */
  search: (query: string) => Promise<MentionCandidate[]>;
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
      Suggestion<MentionCandidate, MentionCandidate>({
        editor: this.editor,
        char: '@',
        pluginKey: mentionPluginKey,
        // Handles hold no spaces, and the default prefixes keep `mail@example.com` quiet.
        allowSpaces: false,
        items: ({ query }) => options.search(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertMention({ handle: props.handle }).run();
        },
        render: createSuggestionRenderer<MentionCandidate>(MentionMenu),
      }),
    ];
  },
});

export default MentionSuggestion;
