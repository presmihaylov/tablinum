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

import { Callout } from './callout';
import { MarkdownCopy } from './clipboard';
import { createCodeBlock } from './codeBlock';
import { MarkdownDialect } from './dialect';
import { EmojiSuggestion } from './emojiSuggestion';
import { createHtmlBlock, HtmlInline } from './htmlNodes';
import { ImageUpload } from './imageUpload';
import { ListShortcuts, OrderedListParen } from './lists';
import { MdEscape } from './mdEscape';
import { createPageEmbed } from './pageEmbed';
import type { EmbeddedPage } from './pageEmbed';
import { SlashMenuExtension } from './slashMenu';
import { GitdocsTaskItem, GitdocsTaskList } from './taskList';
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
  uploadImage: (file: File) => Promise<string | null>;
  searchPages: (query: string) => Promise<WikilinkItem[]>;
  /** Fetches the page an embed names, or null when there is no page at that path. */
  loadPage: (path: string) => Promise<EmbeddedPage | null>;
  /** Opens a page in the shell, from an embed's header. */
  openPage: (path: string) => void;
  /** React node views and menus are skipped when the editor runs without a UI. */
  interactive: boolean;
}

export const DEFAULT_EXTENSION_OPTIONS: EditorExtensionOptions = {
  placeholder: 'Type / for commands',
  onPickImage: () => undefined,
  onPickEmoji: () => undefined,
  onPickVideo: () => undefined,
  onPickPage: () => undefined,
  uploadImage: () => Promise.resolve(null),
  searchPages: () => Promise.resolve([]),
  loadPage: () => Promise.resolve(null),
  openPage: () => undefined,
  interactive: true,
};

/**
 * The full schema. Typography, colour and text-align extensions are deliberately
 * absent: none of them has a markdown representation, and Typography actively
 * rewrites characters, which would break the byte-identical round trip.
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
    GitdocsTaskList,
    GitdocsTaskItem,
    Callout,
    Wikilink,
    createHtmlBlock(options.interactive),
    HtmlInline,
    createPageEmbed(options.interactive, { load: options.loadPage, open: options.openPage }),
    MdEscape,
    Markdown.configure({
      html: true,
      linkify: false,
      breaks: false,
      tightLists: true,
      tightListClass: 'tight',
      bulletListMarker: '-',
      transformPastedText: true,
      // Copying is handled by the gitdocs serializer instead.
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
      placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : options.placeholder),
      showOnlyWhenEditable: true,
      includeChildren: false,
    }),
    SlashMenuExtension.configure({
      onPickImage: options.onPickImage,
      onPickEmoji: options.onPickEmoji,
      onPickVideo: options.onPickVideo,
      onPickPage: options.onPickPage,
    }),
    WikilinkSuggestion.configure({ search: options.searchPages }),
    EmojiSuggestion,
  ];
}

export type { WikilinkItem } from './wikilinkSuggestion';
export type { EmbeddedPage } from './pageEmbed';
export { SLASH_COMMANDS, filterSlashCommands } from './slashMenu';
export type { SlashCommandItem } from './slashMenu';
