import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Code from '@tiptap/extension-code';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import ListItem from '@tiptap/extension-list-item';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Underline from '@tiptap/extension-underline';
import { Markdown } from 'tiptap-markdown';

import { ArrowRule } from './arrow';
import { UndoRedo } from './undoRedo';
import { BlockLink } from './blockLink';
import { BlockSelect } from './blockSelection';
import { Callout } from './callout';
import { MarkdownCopy } from './clipboard';
import { createCodeBlock } from './codeBlock';
import { CommentHighlight } from './commentHighlight';
import { CustomEmoji } from './customEmoji';
import { createDiagram } from './diagram';
import type { DiagramRequest } from './diagram';
import { MarkdownDialect } from './dialect';
import { EmojiSuggestion } from './emojiSuggestion';
import { createHtmlBlock, HtmlInline } from './htmlNodes';
import { ImageUpload } from './imageUpload';
import { ListShortcuts, OrderedListParen } from './lists';
import { MdEscape } from './mdEscape';
import { Mention } from './mention';
import { MentionSuggestion } from './mentionSuggestion';
import type { MentionCandidate } from '../../components/ui/PersonRow';
import { createPageEmbed } from './pageEmbed';
import type { EmbeddedPage } from './pageEmbed';
import { SlashMenuExtension } from './slashMenu';
import type { DatabaseKind } from './slashMenu';
import { TablinumTaskItem, TablinumTaskList } from './taskList';
import { Wikilink } from './wikilink';
import { WikilinkSuggestion } from './wikilinkSuggestion';
import type { WikilinkItem } from './wikilinkSuggestion';

export interface EditorExtensionOptions {
  placeholder: string;
  /** Opens a file picker for the slash menu's image command. */
  onPickImage: () => void;
  /** Opens the emoji popover for the slash menu's emoji command. */
  onPickEmoji: () => void;
  /** Opens the link prompt for the slash menu's video command. */
  onPickVideo: () => void;
  /** Opens the page picker for the slash menu's page command. */
  onPickPage: () => void;
  /** Opens a blank drawing canvas for the slash menu's diagram command. */
  onPickDiagram: () => void;
  /** Makes a database on a new child page for the slash menu's database commands. */
  onInsertDatabase: (kind: DatabaseKind) => void;
  /** Opens the drawing canvas on an existing diagram. */
  editDiagram: (request: DiagramRequest) => void;
  uploadImage: (file: File) => Promise<string | null>;
  searchPages: (query: string) => Promise<WikilinkItem[]>;
  /** Resolves people for the `@` menu. */
  searchPeople: (query: string) => Promise<MentionCandidate[]>;
  /** Fetches the page an embed names, or null when there is no page at that path. */
  loadPage: (path: string) => Promise<EmbeddedPage | null>;
  /** Opens a page in the shell, from an embed's header. */
  openPage: (path: string) => void;
  /** Focuses a comment thread, because its highlighted text was clicked. */
  openComment: (threadId: string | null) => void;
  /** React node views and menus are skipped when the editor runs without a UI. */
  interactive: boolean;
}

export const DEFAULT_EXTENSION_OPTIONS: EditorExtensionOptions = {
  placeholder: 'Type / for commands',
  onPickImage: () => undefined,
  onPickEmoji: () => undefined,
  onPickVideo: () => undefined,
  onPickPage: () => undefined,
  onPickDiagram: () => undefined,
  onInsertDatabase: () => undefined,
  editDiagram: () => undefined,
  uploadImage: () => Promise.resolve(null),
  searchPages: () => Promise.resolve([]),
  searchPeople: () => Promise.resolve([]),
  loadPage: () => Promise.resolve(null),
  openPage: () => undefined,
  openComment: () => undefined,
  interactive: true,
};

/**
 * The full schema, and the one list every editor surface is built from. Colour and text-align
 * extensions are deliberately absent: neither has a markdown representation. Typography is
 * absent for the same reason plus a worse one, since it rewrites characters and would break the
 * byte-identical round trip; only its `->` rule is taken, through `ArrowRule`.
 */
export function buildExtensions(overrides: Partial<EditorExtensionOptions> = {}): Extensions {
  const options: EditorExtensionOptions = { ...DEFAULT_EXTENSION_OPTIONS, ...overrides };

  const core: Extensions = [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      listItem: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      bulletList: { keepMarks: true, keepAttributes: false },
      orderedList: { keepMarks: true, keepAttributes: false },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    // The stock mark declares `excludes: '_'`, which deletes every other mark around a
    // code span at parse time, so `[`a`](/b)` loses its link on the way in.
    Code.extend({ excludes: '' }),
    // Markdown lets any block open an item. With the stock `paragraph block*` the DOM parser
    // cannot place `<li><pre>`, so it drops the block at doc level and destroys the list.
    ListItem.extend({ content: 'block+' }),
    ListShortcuts,
    OrderedListParen,
    ArrowRule,
    UndoRedo,
    createCodeBlock(options.interactive),
    Underline,
    Link.configure({
      openOnClick: false,
      // markdown-it runs with linkify off, so bare URLs must stay bare here too.
      autolink: false,
      linkOnPaste: true,
      HTMLAttributes: { class: 'gd-editor-link', rel: 'noopener noreferrer' },
    }),
    Image.configure({ inline: true, allowBase64: false, HTMLAttributes: { class: 'gd-editor-image' } }),
    Table.configure({ resizable: false, HTMLAttributes: { class: 'gd-editor-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    TablinumTaskList,
    TablinumTaskItem,
    Callout,
    Wikilink,
    Mention,
    CustomEmoji,
    createHtmlBlock(options.interactive),
    HtmlInline,
    createPageEmbed(options.interactive, { load: options.loadPage, open: options.openPage }),
    createDiagram(options.interactive, { edit: options.editDiagram }),
    CommentHighlight.configure({ onActivate: options.openComment }),
    BlockLink,
    MdEscape,
    Markdown.configure({
      html: true,
      linkify: false,
      breaks: false,
      tightLists: true,
      tightListClass: 'tight',
      bulletListMarker: '-',
      transformPastedText: true,
      // Copying is handled by the tablinum serializer instead.
      transformCopiedText: false,
    }),
    MarkdownDialect,
    MarkdownCopy,
    ImageUpload.configure({ upload: options.uploadImage }),
  ];

  if (!options.interactive) return core;

  return [
    ...core,
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading';
        // The decoration lands on the list, not the item, so a hint here draws over the first
        // checkbox. The box already says what the block is.
        if (node.type.name === 'taskList') return '';
        return options.placeholder;
      },
      showOnlyWhenEditable: true,
      includeChildren: false,
    }),
    SlashMenuExtension.configure({
      onPickImage: options.onPickImage,
      onPickEmoji: options.onPickEmoji,
      onPickVideo: options.onPickVideo,
      onPickPage: options.onPickPage,
      onPickDiagram: options.onPickDiagram,
      onInsertDatabase: options.onInsertDatabase,
    }),
    WikilinkSuggestion.configure({ search: options.searchPages }),
    MentionSuggestion.configure({ search: options.searchPeople }),
    EmojiSuggestion,
    BlockSelect,
  ];
}

export { BlockLink, LINKED_CLASS } from './blockLink';
export { BAND_CLASS, BlockSelection } from './blockSelection';
export { DRAFT_SPAN_ID } from './commentHighlight';
export type { CommentSpan } from './commentHighlight';
export { insertEmoji } from './customEmoji';
export type { WikilinkItem } from './wikilinkSuggestion';
export type { MentionCandidate } from '../../components/ui/PersonRow';
export type { EmbeddedPage } from './pageEmbed';
export type { DiagramRequest } from './diagram';
export { SLASH_COMMANDS, filterSlashCommands } from './slashMenu';
export type { DatabaseKind, SlashCommandItem } from './slashMenu';
