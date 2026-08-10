import {
  clampCursor,
  collapsed,
  cursorAt,
  findAll,
  offsetOf,
  spanOffsets,
  splice,
  splitBlocks,
  validation,
  wholePage,
  type Block,
  type Cursor,
  type CursorState,
  type Page,
  type Span,
} from '@tablinum/shared';
import type { TablinumClient } from './client.js';
import { resolvePage, type PageRef } from './refs.js';

/**
 * Working on a page the way a person does.
 *
 * A person opens a page, puts the caret somewhere, selects a few words and types over them.
 * These helpers do the same over the markdown of a page: `@tablinum/shared` owns the text
 * arithmetic, and everything here is the round trip to the server around it.
 */

/** A page open in front of the caller: its text, its blocks and where its caret sits. */
export interface Desk {
  page: Page;
  blocks: Block[];
  span: Span;
}

/** What one edit did, so the tool can report it without asking the server again. */
export interface Written {
  page: Page;
  cursor: CursorState;
  /** The text the edit took out. Empty when nothing was selected. */
  removed: string;
  /** The text the edit put in. Empty for an erase. */
  added: string;
}

const START: Cursor = { block: 0, offset: 0 };

/** Open a page and pick up the caret this caller left on it, or start at the top. */
export async function openDesk(client: TablinumClient, ref: PageRef): Promise<Desk> {
  const page = await resolvePage(client, ref);
  const blocks = splitBlocks(page.markdown);
  const held = await client.getCursor(page.id);
  const span: Span =
    held === null
      ? collapsed(START)
      : { anchor: clampCursor(blocks, held.anchor), head: clampCursor(blocks, held.head) };
  return { page, blocks, span };
}

/** The two ends of the current selection, as offsets into the markdown. */
export function selection(desk: Desk): { from: number; to: number } {
  return spanOffsets(desk.blocks, desk.span);
}

/** The markdown the current selection covers. Empty while the caret selects nothing. */
export function selected(desk: Desk): string {
  const { from, to } = selection(desk);
  return desk.page.markdown.slice(from, to);
}

/** True while the caret selects nothing, which is a plain caret rather than a selection. */
export function isCollapsed(desk: Desk): boolean {
  const { from, to } = selection(desk);
  return from === to;
}

/**
 * Where a phrase sits, as a span over it. `occurrence` is one based, the way a person counts.
 * A phrase that is not there, or not there that many times, is a validation error saying so.
 */
export function findSpan(desk: Desk, phrase: string, occurrence: number): Span {
  if (phrase.length === 0) throw validation('"find" is empty, so there is nothing to look for.');
  const found = findAll(desk.page.markdown, phrase);
  if (found.length === 0) {
    throw validation(
      `${JSON.stringify(phrase)} does not appear in ${desk.page.path}. ` +
        'Call tablinum_open_page to see the current text, and match it exactly, including case.',
    );
  }
  const at = found[occurrence - 1];
  if (at === undefined) {
    throw validation(
      `${JSON.stringify(phrase)} appears ${found.length} time${found.length === 1 ? '' : 's'} in ` +
        `${desk.page.path}, so there is no occurrence ${occurrence}.`,
    );
  }
  return {
    anchor: cursorAt(desk.blocks, at),
    head: cursorAt(desk.blocks, at + phrase.length),
  };
}

/** The whole of one block, or of a run of blocks, as a span. */
export function blockSpan(desk: Desk, first: number, last: number): Span {
  const from = clampCursor(desk.blocks, { block: first, offset: 0 });
  const end = clampCursor(desk.blocks, { block: last, offset: Number.MAX_SAFE_INTEGER });
  return { anchor: { block: from.block, offset: 0 }, head: end };
}

/** The whole page, the way Select all does. */
export function pageSpan(desk: Desk): Span {
  return wholePage(desk.blocks);
}

/** Move the caret without changing any text. */
export async function moveCaret(
  client: TablinumClient,
  desk: Desk,
  span: Span,
): Promise<CursorState> {
  return client.setCursor(desk.page.id, { anchor: span.anchor, head: span.head });
}

/**
 * Replace the characters a span covers, then leave the caret just after the new text, which is
 * where a person's caret ends up after typing.
 */
export async function replaceSpan(
  client: TablinumClient,
  desk: Desk,
  span: Span,
  text: string,
): Promise<Written> {
  const { from, to } = spanOffsets(desk.blocks, span);
  const removed = desk.page.markdown.slice(from, to);
  if (removed === text) {
    throw validation('That edit would leave the page exactly as it is, so nothing was written.');
  }

  const next = splice(desk.page.markdown, from, to, text);
  const page = await client.updatePage(desk.page.id, { markdown: next });
  const blocks = splitBlocks(page.markdown);
  const cursor = await client.setCursor(page.id, {
    anchor: cursorAt(blocks, from + text.length),
  });
  return { page, cursor, removed, added: text };
}

/** Where a cursor sits in the whole markdown, for a caller that only holds a desk. */
export function offsetIn(desk: Desk, cursor: Cursor): number {
  return offsetOf(desk.blocks, cursor);
}
