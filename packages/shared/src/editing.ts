import { z } from 'zod';
import { PageIdSchema } from './schemas.js';
import type { PageId, PagePath } from './types.js';

/**
 * Editing a page the way a person does.
 *
 * Nobody rewrites a whole document to change a sentence. They put the caret in a paragraph,
 * select a few words, and type over them. These primitives give the same handles over the
 * markdown of a page, so an agent can work in the small steps a person works in.
 *
 * The unit of address is a block, which is what a page looks like on screen: one paragraph, one
 * heading, one fenced code block, one list. Blocks are separated by a blank line, and a blank
 * line inside a fence separates nothing. Inside a block a position is a character offset into
 * the markdown of that block, counted from its first character.
 */

/** One addressable block of a page, with where it sits in the markdown. */
export interface Block {
  /** Zero based, in reading order. */
  index: number;
  /** Offset of the first character of the block in the page markdown. */
  start: number;
  /** Offset just past the last character of the block. */
  end: number;
  /** The markdown of the block, without the blank line that ends it. */
  text: string;
}

/** Where a caret sits: which block, and how many characters into it. */
export interface Cursor {
  block: number;
  offset: number;
}

/** A caret with a selection. The two are equal while nothing is selected. */
export interface Span {
  /** Where the selection was started. */
  anchor: Cursor;
  /** Where the caret is now. */
  head: Cursor;
}

export const CursorSchema = z.object({
  block: z.number().int().min(0),
  offset: z.number().int().min(0),
});

export const SpanSchema = z.object({ anchor: CursorSchema, head: CursorSchema });

/** Where one caller is at work. The server holds one of these per page it is asked about. */
export interface CursorState extends Span {
  pageId: PageId;
  path: PagePath;
  /** When the caret was last put here, ISO 8601. */
  updated: string;
}

export const SetCursorBodySchema = z.object({
  anchor: CursorSchema,
  /** Omit to leave the caret where the anchor is, which selects nothing. */
  head: CursorSchema.optional(),
});
export type SetCursorBody = z.infer<typeof SetCursorBodySchema>;

export const CursorStateSchema = z.object({
  pageId: PageIdSchema,
  path: z.string(),
  anchor: CursorSchema,
  head: CursorSchema,
  updated: z.string(),
});

export const CursorResponseSchema = z.object({ cursor: CursorStateSchema.nullable() });
export type CursorResponse = z.infer<typeof CursorResponseSchema>;

const FENCE_RE = /^\s{0,3}(```+|~~~+)/;

/** The fence marker a line carries, or null when it carries none. */
function fenceMark(line: string): string | null {
  const found = FENCE_RE.exec(line);
  const mark = found === null ? undefined : found[1];
  return mark === undefined ? null : mark.slice(0, 3);
}

/** The fence still open after a line that carries `mark`. A fence is closed by its own kind. */
function nextFence(open: string | null, mark: string): string | null {
  if (open === null) return mark;
  if (open === mark) return null;
  return open;
}

/**
 * The blocks of a page, in reading order. A page with no text at all still has one block, empty,
 * so there is always somewhere to put the caret.
 */
export function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');

  let fence: string | null = null;
  let started: number | null = null;
  let at = 0;

  const close = (end: number): void => {
    if (started === null) return;
    blocks.push({
      index: blocks.length,
      start: started,
      end,
      text: markdown.slice(started, end),
    });
    started = null;
  };

  for (const line of lines) {
    const blank = fence === null && line.trim().length === 0;
    if (blank) close(at === 0 ? 0 : at - 1);
    if (!blank && started === null) started = at;

    const mark = fenceMark(line);
    if (mark !== null) fence = nextFence(fence, mark);

    // The newline that ends this line belongs to the block until the block ends.
    at += line.length + 1;
  }
  close(Math.min(at === 0 ? 0 : at - 1, markdown.length));

  if (blocks.length === 0) blocks.push({ index: 0, start: 0, end: 0, text: '' });
  return blocks;
}

/** Blocks are never empty by construction, so these fallbacks stand in for an impossible case. */
const NO_BLOCK: Block = { index: 0, start: 0, end: 0, text: '' };

function blockAt(blocks: Block[], index: number): Block {
  return blocks[index] ?? NO_BLOCK;
}

function lastBlock(blocks: Block[]): Block {
  return blockAt(blocks, blocks.length - 1);
}

function clampNumber(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(Math.trunc(value), low), high);
}

/** The same cursor, moved to the nearest place that really exists in these blocks. */
export function clampCursor(blocks: Block[], cursor: Cursor): Cursor {
  const index = clampNumber(cursor.block, 0, blocks.length - 1);
  const block = blockAt(blocks, index);
  return { block: index, offset: clampNumber(cursor.offset, 0, block.text.length) };
}

/** Where a cursor sits in the whole markdown. */
export function offsetOf(blocks: Block[], cursor: Cursor): number {
  const safe = clampCursor(blocks, cursor);
  return blockAt(blocks, safe.block).start + safe.offset;
}

/** The cursor for a character offset into the whole markdown. */
export function cursorAt(blocks: Block[], offset: number): Cursor {
  const at = clampNumber(offset, 0, Number.MAX_SAFE_INTEGER);
  for (const block of blocks) {
    if (at <= block.end) return { block: block.index, offset: Math.max(0, at - block.start) };
  }
  const last = lastBlock(blocks);
  return { block: last.index, offset: last.text.length };
}

/** The two ends of a span as offsets into the markdown, lowest first. */
export function spanOffsets(blocks: Block[], span: Span): { from: number; to: number } {
  const one = offsetOf(blocks, span.anchor);
  const other = offsetOf(blocks, span.head);
  return { from: Math.min(one, other), to: Math.max(one, other) };
}

/** The markdown a span covers. */
export function spanText(markdown: string, span: Span): string {
  const { from, to } = spanOffsets(splitBlocks(markdown), span);
  return markdown.slice(from, to);
}

/** A caret that selects nothing, sitting where this cursor is. */
export function collapsed(cursor: Cursor): Span {
  return { anchor: cursor, head: cursor };
}

/** Replace the characters between `from` and `to` with `text`. */
export function splice(markdown: string, from: number, to: number, text: string): string {
  return `${markdown.slice(0, from)}${text}${markdown.slice(to)}`;
}

/** Every offset the needle starts at, in reading order. Overlapping matches are not counted. */
export function findAll(markdown: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const found: number[] = [];
  let at = markdown.indexOf(needle);
  while (at >= 0) {
    found.push(at);
    at = markdown.indexOf(needle, at + needle.length);
  }
  return found;
}

/** The whole page as one span, the way Select all does. */
export function wholePage(blocks: Block[]): Span {
  const last = lastBlock(blocks);
  return {
    anchor: { block: 0, offset: 0 },
    head: { block: last.index, offset: last.text.length },
  };
}
