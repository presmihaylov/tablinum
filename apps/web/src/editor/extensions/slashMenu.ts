import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { SlashMenu } from '../ui/SlashMenu';
import { createSuggestionRenderer } from '../ui/suggestionRenderer';

export interface SlashMenuOptions {
  /** Opens the file picker for the "Image" command. */
  onPickImage: () => void;
  /** Opens the emoji popover for the "Emoji" command. */
  onPickEmoji: () => void;
}

export interface SlashCommandItem {
  id: string;
  title: string;
  hint: string;
  glyph: string;
  keywords: readonly string[];
  run: (editor: Editor, range: Range, options: SlashMenuOptions) => void;
}

export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    id: 'h1',
    title: 'Heading 1',
    hint: 'Big section heading',
    glyph: 'H1',
    keywords: ['h1', 'title', 'heading', 'big'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    hint: 'Medium section heading',
    glyph: 'H2',
    keywords: ['h2', 'subtitle', 'heading'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    hint: 'Small section heading',
    glyph: 'H3',
    keywords: ['h3', 'heading'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bulletList',
    title: 'Bulleted list',
    hint: 'A simple bulleted list',
    glyph: 'UL',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    title: 'Numbered list',
    hint: 'A list with numbering',
    glyph: 'OL',
    keywords: ['number', 'ordered', 'list', 'ol'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    title: 'To-do list',
    hint: 'Track tasks with checkboxes',
    glyph: 'TODO',
    keywords: ['todo', 'task', 'check', 'checkbox'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'codeBlock',
    title: 'Code block',
    hint: 'Code with syntax highlighting',
    glyph: 'CODE',
    keywords: ['code', 'fence', 'snippet', 'pre'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: 'blockquote',
    title: 'Quote',
    hint: 'Capture a quotation',
    glyph: 'QUOTE',
    keywords: ['quote', 'blockquote', 'citation'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    id: 'callout',
    title: 'Callout',
    hint: 'A highlighted note block',
    glyph: 'NOTE',
    keywords: ['callout', 'note', 'alert', 'warning', 'tip', 'info'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setCallout('NOTE').run(),
  },
  {
    id: 'horizontalRule',
    title: 'Divider',
    hint: 'A horizontal line',
    glyph: 'HR',
    keywords: ['divider', 'rule', 'line', 'separator', 'hr'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'table',
    title: 'Table',
    hint: 'A three by three table',
    glyph: 'TABLE',
    keywords: ['table', 'grid', 'rows', 'columns'],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: 'image',
    title: 'Image',
    hint: 'Upload a picture',
    glyph: 'IMG',
    keywords: ['image', 'picture', 'photo', 'upload'],
    run: (editor, range, options) => {
      editor.chain().focus().deleteRange(range).run();
      options.onPickImage();
    },
  },
  {
    id: 'emoji',
    title: 'Emoji',
    hint: 'Insert an emoji',
    glyph: 'EMOJI',
    keywords: ['emoji', 'smiley', 'symbol', 'reaction'],
    run: (editor, range, options) => {
      editor.chain().focus().deleteRange(range).run();
      options.onPickEmoji();
    },
  },
];

/** Case-insensitive prefix and substring match over the title and keywords. */
export function filterSlashCommands(query: string): SlashCommandItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter(
    (item) =>
      item.title.toLowerCase().includes(needle) ||
      item.keywords.some((keyword) => keyword.startsWith(needle)),
  );
}

export const slashMenuPluginKey = new PluginKey('gitdocsSlashMenu');

export const SlashMenuExtension = Extension.create<SlashMenuOptions>({
  name: 'gitdocsSlashMenu',

  addOptions() {
    return { onPickImage: () => undefined, onPickEmoji: () => undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        char: '/',
        pluginKey: slashMenuPluginKey,
        startOfLine: false,
        allowedPrefixes: [' '],
        items: ({ query }) => filterSlashCommands(query),
        command: ({ editor, range, props }) => props.run(editor, range, options),
        render: createSuggestionRenderer<SlashCommandItem>(SlashMenu),
      }),
    ];
  },
});

export default SlashMenuExtension;
