import type { Node as ProseNode } from '@tiptap/pm/model';
import { ANCHOR_CONTEXT_LENGTH, MAX_QUOTE_LENGTH, type CommentAnchor } from '@tablinum/shared';

/**
 * Text anchoring for comments.
 *
 * A comment never puts anything in the document, so nothing about it can reach the markdown
 * file. It quotes the text it is about instead, and the quote is looked up again here on every
 * load. Nothing is guessed: when the quote is gone the thread is reported as orphaned, and the
 * panel keeps showing it with the words it was written about.
 */

/** One run of text in the document, and where it starts in the flattened string. */
interface Segment {
  offset: number;
  pos: number;
  length: number;
}

export interface FlatDoc {
  /** Every text run, with a newline where one block ends and the next begins. */
  text: string;
  segments: Segment[];
}

export interface AnchorRange {
  from: number;
  to: number;
}

type Edge = 'start' | 'end';

/** The document as plain text, plus the map back to positions in it. */
export function flattenDoc(doc: ProseNode): FlatDoc {
  const segments: Segment[] = [];
  let text = '';

  const gap = (): void => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
  };

  doc.descendants((node, pos) => {
    if (node.isText && typeof node.text === 'string') {
      segments.push({ offset: text.length, pos, length: node.text.length });
      text += node.text;
      return false;
    }
    if (node.type.name === 'hardBreak') {
      gap();
      return false;
    }
    if (node.isBlock) gap();
    return true;
  });

  return { text, segments };
}

/** The document position of a character offset, or null when the offset is out of reach. */
function positionAt(flat: FlatDoc, offset: number, edge: Edge): number | null {
  for (const segment of flat.segments) {
    const first = segment.offset;
    const last = segment.offset + segment.length;
    const hit = edge === 'end' ? offset > first && offset <= last : offset >= first && offset < last;
    if (hit) return segment.pos + (offset - first);
  }
  return null;
}

/**
 * The character offset of a document position. A position between two blocks belongs to no
 * text run, so it falls back to the nearest run in the direction the caller is going.
 */
function offsetAt(flat: FlatDoc, pos: number, edge: Edge): number | null {
  for (const segment of flat.segments) {
    const first = segment.pos;
    const last = segment.pos + segment.length;
    const hit = edge === 'end' ? pos > first && pos <= last : pos >= first && pos < last;
    if (hit) return segment.offset + (pos - first);
  }
  return nearestOffset(flat, pos, edge);
}

function nearestOffset(flat: FlatDoc, pos: number, edge: Edge): number | null {
  if (edge === 'start') {
    const after = flat.segments.find((segment) => segment.pos >= pos);
    return after === undefined ? null : after.offset;
  }
  const before = [...flat.segments].reverse().find((segment) => segment.pos + segment.length <= pos);
  return before === undefined ? null : before.offset + before.length;
}

/**
 * Describe the selected text well enough to find it again. Null when the selection holds no
 * words, which the caller turns into a comment on the whole page.
 */
export function anchorFor(doc: ProseNode, from: number, to: number): CommentAnchor | null {
  const flat = flattenDoc(doc);
  const start = offsetAt(flat, from, 'start');
  const end = offsetAt(flat, to, 'end');
  if (start === null || end === null || end <= start) return null;

  // A very long selection is quoted only as far as the contract allows; the highlight then
  // covers that much of it, which is honest about what the thread can still find.
  const quote = flat.text.slice(start, Math.min(end, start + MAX_QUOTE_LENGTH));
  if (quote.trim().length === 0) return null;

  const after = start + quote.length;
  return {
    quote,
    prefix: flat.text.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
    suffix: flat.text.slice(after, after + ANCHOR_CONTEXT_LENGTH),
    start,
  };
}

function occurrences(text: string, quote: string): number[] {
  const out: number[] = [];
  let at = text.indexOf(quote);
  while (at !== -1) {
    out.push(at);
    at = text.indexOf(quote, at + 1);
  }
  return out;
}

/**
 * Which occurrence the thread meant. The words on both sides tell two identical quotes apart;
 * when they no longer do, the one nearest the original offset wins. Every candidate holds the
 * exact quoted text, so the thread can only ever land on the words it was written about.
 */
function pickOccurrence(hits: number[], text: string, anchor: CommentAnchor): number {
  const withContext = hits.filter((at) => {
    const before = text.slice(Math.max(0, at - anchor.prefix.length), at);
    const after = text.slice(at + anchor.quote.length, at + anchor.quote.length + anchor.suffix.length);
    return before === anchor.prefix && after === anchor.suffix;
  });
  const pool = withContext.length > 0 ? withContext : hits;
  return pool.reduce((best, at) =>
    Math.abs(at - anchor.start) < Math.abs(best - anchor.start) ? at : best,
  );
}

/** Where an anchor points now, or null when its text has left the page. */
export function locateAnchor(doc: ProseNode, anchor: CommentAnchor): AnchorRange | null {
  const flat = flattenDoc(doc);
  const hits = occurrences(flat.text, anchor.quote);
  if (hits.length === 0) return null;

  const at = pickOccurrence(hits, flat.text, anchor);
  const from = positionAt(flat, at, 'start');
  const to = positionAt(flat, at + anchor.quote.length, 'end');
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}
