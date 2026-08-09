import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { SlashMenu } from '../ui/SlashMenu';
import { createSuggestionRenderer } from '../ui/suggestionRenderer';

export interface SlashMenuOptions {
  /** Opens the file picker for the "Image" command. */
  onPickImage: () => void;
  /** Opens the emoji popover for the "Emoji" command. */
  onPickEmoji: () => void;
  /** Opens the link prompt for the "Video" command. */
  onPickVideo: () => void;
  /** Opens the page picker for the "Page" command. */
  onPickPage: () => void;
}

export interface SlashCommandItem {
  id: string;
  title: string;
  hint: string;
  glyph: string;
  keywords: readonly string[];
  /** Whether the command can run where the cursor is. An absent test means always. */
  available?: (editor: Editor) => boolean;
  run: (editor: Editor, range: Range, options: SlashMenuOptions) => void;
}

/**
 * GFM gives a table cell one line of inline content. A block put there is either written
 * back as bare text or, for a list or a table, it replaces the cell content outright.
 */
function outsideTableCell(editor: Editor): boolean {
  return !editor.isActive('tableCell') && !editor.isActive('tableHeader');
}

const LIST_ITEMS = ['listItem', 'taskItem'];
const LISTS = ['bulletList', 'orderedList', 'taskList'];

/** How many list items enclose the cursor. */
function listDepth($from: ResolvedPos): number {
  let count = 0;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (LIST_ITEMS.includes($from.node(depth).type.name)) count += 1;
  }
  return count;
}

/** Just past the outermost list around the cursor, or null when there is no list. */
function afterEnclosingList($from: ResolvedPos): number | null {
  for (let depth = 1; depth <= $from.depth; depth += 1) {
    if (LISTS.includes($from.node(depth).type.name)) return $from.after(depth);
  }
  return null;
}

export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    id: 'h1',
    title: 'Heading 1',
    hint: 'Big section heading',
    glyph: 'H1',
    keywords: ['h1', 'title', 'heading', 'big'],
    available: outsideTableCell,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    hint: 'Medium section heading',
    glyph: 'H2',
    keywords: ['h2', 'subtitle', 'heading'],
    available: outsideTableCell,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    hint: 'Small section heading',
    glyph: 'H3',
    keywords: ['h3', 'heading'],
    available: outsideTableCell,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bulletList',
    title: 'Bulleted list',
    hint: 'A simple bulleted list',
    glyph: 'UL',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
    available: outsideTableCell,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    title: 'Numbered list',
    hint: 'A list with numbering',
    glyph: 'OL',
    keywords: ['number', 'ordered', 'list', 'ol'],
    available: outsideTableCell,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    title: 'To-do list',
    hint: 'Track tasks with checkboxes',
    glyph: 'TODO',
    keywords: ['todo', 'task', 'check', 'checkbox'],
    available: outsideTableCell,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'codeBlock',
    title: 'Code block',
    hint: 'Code with syntax highlighting',
    glyph: 'CODE',
    keywords: ['code', 'fence', 'snippet', 'pre'],
    available: outsideTableCell,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: 'blockquote',
    title: 'Quote',
    hint: 'Capture a quotation',
    glyph: 'QUOTE',
    keywords: ['quote', 'blockquote', 'citation'],
    available: outsideTableCell,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    id: 'callout',
    title: 'Callout',
    hint: 'A highlighted note block',
    glyph: 'NOTE',
    keywords: ['callout', 'note', 'alert', 'warning', 'tip', 'info'],
    available: outsideTableCell,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setCallout('NOTE').run(),
  },
  {
    id: 'horizontalRule',
    title: 'Divider',
    hint: 'A horizontal line',
    glyph: 'HR',
    keywords: ['divider', 'rule', 'line', 'separator', 'hr'],
    available: outsideTableCell,
    run: (editor, range) => {
      // A rule written inside an item is indented under its marker, which reads back as
      // part of the item. It belongs after the whole list.
      const { $from } = editor.state.selection;
      const after = afterEnclosingList($from);
      const width = range.to - range.from;
      // The command was the whole item, so the item goes away with it.
      if (after === null || $from.parent.content.size === width) {
        const chain = editor.chain().focus().deleteRange(range);
        for (let depth = listDepth($from); depth > 0; depth -= 1) {
          chain.liftListItem('listItem').liftListItem('taskItem');
        }
        chain.setHorizontalRule().run();
        return;
      }
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContentAt(after - width, { type: 'horizontalRule' })
        .run();
    },
  },
  {
    id: 'table',
    title: 'Table',
    hint: 'A three by three table',
    glyph: 'TABLE',
    keywords: ['table', 'grid', 'rows', 'columns'],
    available: outsideTableCell,
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
    id: 'video',
    title: 'Video',
    hint: 'Embed a YouTube, Vimeo or Loom link',
    glyph: 'PLAY',
    keywords: ['video', 'embed', 'youtube', 'vimeo', 'loom', 'player', 'movie'],
    available: outsideTableCell,
    run: (editor, range, options) => {
      editor.chain().focus().deleteRange(range).run();
      options.onPickVideo();
    },
  },
  {
    id: 'page',
    title: 'Page',
    hint: 'Embed a page, or make a new one here',
    glyph: 'PAGE',
    keywords: ['page', 'embed', 'include', 'transclude', 'doc', 'link', 'new', 'sub', 'child'],
    available: outsideTableCell,
    run: (editor, range, options) => {
      editor.chain().focus().deleteRange(range).run();
      options.onPickPage();
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
export function filterSlashCommands(query: string, editor?: Editor): SlashCommandItem[] {
  const offered = SLASH_COMMANDS.filter((item) => isAvailable(item, editor));
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return offered;
  return offered.filter(
    (item) =>
      item.title.toLowerCase().includes(needle) ||
      item.keywords.some((keyword) => keyword.startsWith(needle)),
  );
}

function isAvailable(item: SlashCommandItem, editor: Editor | undefined): boolean {
  if (editor === undefined || item.available === undefined) return true;
  return item.available(editor);
}

export const slashMenuPluginKey = new PluginKey('tablinumSlashMenu');

export const SlashMenuExtension = Extension.create<SlashMenuOptions>({
  name: 'tablinumSlashMenu',

  addOptions() {
    return {
      onPickImage: () => undefined,
      onPickEmoji: () => undefined,
      onPickVideo: () => undefined,
      onPickPage: () => undefined,
    };
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
        items: ({ editor, query }) => filterSlashCommands(query, editor),
        command: ({ editor, range, props }) => {
          if (!isAvailable(props, editor)) return;
          props.run(editor, range, options);
        },
        render: createSuggestionRenderer<SlashCommandItem>(SlashMenu),
      }),
    ];
  },
});

export default SlashMenuExtension;
