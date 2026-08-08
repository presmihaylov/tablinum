import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { WikilinkMenu } from '../ui/WikilinkMenu';
import { createSuggestionRenderer } from '../ui/suggestionRenderer';

export interface WikilinkItem {
  path: string;
  title: string;
}

export interface WikilinkSuggestionOptions {
  /** Resolves page candidates for the typed query. Supplied by the editor shell. */
  search: (query: string) => Promise<WikilinkItem[]>;
}

export const wikilinkPluginKey = new PluginKey('gitdocsWikilink');

export const WikilinkSuggestion = Extension.create<WikilinkSuggestionOptions>({
  name: 'gitdocsWikilinkSuggestion',

  addOptions() {
    return { search: () => Promise.resolve([]) };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<WikilinkItem, WikilinkItem>({
        editor: this.editor,
        char: '[[',
        pluginKey: wikilinkPluginKey,
        allowSpaces: true,
        allowedPrefixes: null,
        items: ({ query }) => options.search(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertWikilink({ target: props.path, alias: props.title })
            .run();
        },
        render: createSuggestionRenderer<WikilinkItem>(WikilinkMenu),
      }),
    ];
  },
});

export default WikilinkSuggestion;
