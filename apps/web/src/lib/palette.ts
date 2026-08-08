/** A row of the command palette that is not a search hit. */
export interface PaletteAction {
  id: string;
  label: string;
  group: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

export interface Matchable {
  label: string;
  keywords?: string[];
}

/** Higher is better. Null means the candidate does not match at all. */
export function scoreMatch(text: string, query: string): number | null {
  if (query.length === 0) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 900 - haystack.length;

  const wordStart = haystack.split(/[\s/\-_.]+/).some((word) => word.startsWith(needle));
  if (wordStart) return 800 - haystack.length;

  const at = haystack.indexOf(needle);
  if (at >= 0) return 700 - at - haystack.length * 0.01;

  return subsequenceScore(haystack, needle);
}

function subsequenceScore(haystack: string, needle: string): number | null {
  let cursor = 0;
  let gaps = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 400 - gaps;
}

/** Best score across a row's label and its keywords. */
export function scoreItem(item: Matchable, query: string): number | null {
  const candidates = [item.label, ...(item.keywords ?? [])];
  let best: number | null = null;
  for (const candidate of candidates) {
    const score = scoreMatch(candidate, query);
    if (score === null) continue;
    if (best === null || score > best) best = score;
  }
  return best;
}

/** Filter and rank palette rows. An empty query keeps the given order. */
export function filterActions<T extends Matchable>(items: readonly T[], query: string): T[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [...items];
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = scoreItem(item, trimmed);
    if (score === null) return;
    scored.push({ item, score, index });
  });
  scored.sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));
  return scored.map((entry) => entry.item);
}
