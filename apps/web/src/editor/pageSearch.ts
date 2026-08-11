import { filterActions, NAME_MATCH_FLOOR } from '../lib/palette';
import type { WikilinkItem } from './extensions';

/** Most rows either page menu draws, and so the most hits worth asking the index for. */
export const PAGE_MENU_ROWS = 8;

/**
 * The rows behind the `/page` picker and the `[[` menu.
 *
 * The index answers first, in its own bm25 order. It is already narrowed to the name of a
 * page by the `fields` parameter, so nothing here re-ranks it. The cached tree follows,
 * matched by name, which covers the two cases the index cannot: a page it has not caught
 * up with, and a name typed with a typo.
 *
 * One row per page id. After a rename the index still holds the old path for a moment, so
 * keying on the path would offer the same page twice and one row would not resolve.
 */
export function pageMenuRows(
  hits: readonly WikilinkItem[],
  known: readonly WikilinkItem[],
  query: string,
): WikilinkItem[] {
  const text = query.trim();
  if (text.length === 0) return [];

  const named = filterActions(
    known.map((page) => ({ label: page.title, keywords: [page.path], page })),
    text,
    NAME_MATCH_FLOOR,
  ).map((row) => row.page);

  const seen = new Set<string>();
  const rows: WikilinkItem[] = [];
  for (const page of [...hits, ...named]) {
    if (seen.has(page.id)) continue;
    seen.add(page.id);
    rows.push(page);
    if (rows.length === PAGE_MENU_ROWS) break;
  }
  return rows;
}
