import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
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
import { HtmlBlock, HtmlInline } from './htmlNodes';
import { ImageUpload } from './imageUpload';
import { MdEscape } from './mdEscape';
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
  uploadImage: (file: File) => Promise<string | null>;
  searchPages: (query: string) => Promise<WikilinkItem[]>;
  /** React node views and menus are skipped when the editor runs without a UI. */
  interactive: boolean;
}

export const DEFAULT_EXTENSION_OPTIONS: EditorExtensionOptions = {
  placeholder: 'Type / for commands',
  onPickImage: () => undefined,
  onPickEmoji: () => undefined,
  uploadImage: () => Promise.resolve(null),
  searchPages: () => Promise.resolve([]),
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
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      bulletList: { keepMarks: true, keepAttributes: false },
      orderedList: { keepMarks: true, keepAttributes: false },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
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
    HtmlBlock,
    HtmlInline,
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
    }),
    WikilinkSuggestion.configure({ search: options.searchPages }),
  ];
}

export type { WikilinkItem } from './wikilinkSuggestion';
export { SLASH_COMMANDS, filterSlashCommands } from './slashMenu';
export type { SlashCommandItem } from './slashMenu';
