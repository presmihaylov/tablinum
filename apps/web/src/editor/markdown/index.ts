import type { Node as PMNode } from '@tiptap/pm/model';
import { applyFrame, captureFrame, DEFAULT_FRAME, stripFrame } from './frame';
import type { MarkdownFrame } from './frame';
import { serializeDoc } from './serializer';

export { configureMarkdownIt, LANG_PREFIX } from './markdownIt';
export { serializeDoc, serializeFragment } from './serializer';
export { applyFrame, captureFrame, stripFrame, DEFAULT_FRAME } from './frame';
export type { MarkdownFrame } from './frame';
export { escapeText } from './escape';
export type { EscapeContext } from './escape';
export { DATA, CALLOUT_TYPES, isCalloutType, toCalloutType } from './dialect';
export type { CalloutType } from './dialect';
export { decodeRaw, encodeRaw, escapeHtml } from './html';

/**
 * ProseMirror collapses HTML whitespace by default, which rewrites every run of two
 * or more spaces and every tab markdown-it produced. `true`, not `'full'`: `'full'`
 * also keeps the newlines markdown-it writes between block tags, which reopens the
 * document as a wall of hard breaks.
 */
export const PARSE_OPTIONS = { preserveWhitespace: true } as const;

/** Everything the editor needs to reproduce the file it loaded. */
export interface MarkdownSource {
  /** Block content with the outer blank lines removed, ready for the parser. */
  body: string;
  frame: MarkdownFrame;
}

export function readMarkdown(source: string): MarkdownSource {
  const frame = captureFrame(source);
  return { body: stripFrame(source, frame), frame };
}

export function writeMarkdown(doc: PMNode, frame: MarkdownFrame = DEFAULT_FRAME): string {
  return applyFrame(serializeDoc(doc), frame);
}
