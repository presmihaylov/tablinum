import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { WikilinkMenu } from '../ui/WikilinkMenu';
import { createSuggestionRenderer } from '../ui/suggestionRenderer';

export interface WikilinkItem {
  /** The page id. Two sources feed the menus, and only the id survives a rename. */
  id: string;
  path: string;
  title: string;
  /** The emoji of the page, or a `:shortcode:` for a custom one. Absent when it has none. */
  icon?: string;
}

export interface WikilinkSuggestionOptions {
  /** Resolves page candidates for the typed query. Supplied by the editor shell. */
  search: (query: string) => Promise<WikilinkItem[]>;
}

export const wikilinkPluginKey = new PluginKey('tablinumWikilink');

export const WikilinkSuggestion = Extension.create<WikilinkSuggestionOptions>({
  name: 'tablinumWikilinkSuggestion',

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
