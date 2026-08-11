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

/**
 * The tiers of the ladder, best first. Each one keeps a band of its own, so a caller can
 * name the loosest kind of match it will take. Inside a band the score falls with the
 * length of the candidate, which breaks the tie a one-letter query would otherwise leave.
 */
const EXACT = 1000;
const PREFIX = 900;
const WORD_START = 800;
const SUBSTRING = 700;
const FUZZY = 500;
const SUBSEQUENCE = 400;

/** How far above `FUZZY` the closest typo may reach. Kept small, so it never passes a substring. */
const FUZZY_SPREAD = 100;

/**
 * Least similarity a typo may leave and still name the same thing.
 *
 * The score is `1 - edits / longest`, so 0.7 allows one edit in a word of four letters
 * or more and two in a word of seven or more. "cat" against "car" scores 0.667 and fails.
 */
const FUZZY_FLOOR = 0.7;

/** Below this a single edit makes a different word, so "cat" must never find "car". */
const FUZZY_MIN_LENGTH = 4;

/**
 * Least score a match on the NAME of a thing may have: every tier except the loosest.
 * A subsequence reads the typed letters scattered anywhere in the text, which is right
 * for a command list and far too loose for the name of a page.
 */
export const NAME_MATCH_FLOOR = FUZZY;

const WORD_SPLIT = /[\s/\-_.]+/;

/** Higher is better. Null means the candidate does not match at all. */
export function scoreMatch(text: string, query: string): number | null {
  if (query.length === 0) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack === needle) return EXACT;
  if (haystack.startsWith(needle)) return PREFIX - haystack.length;

  const wordStart = haystack.split(WORD_SPLIT).some((word) => word.startsWith(needle));
  if (wordStart) return WORD_START - haystack.length;

  const at = haystack.indexOf(needle);
  if (at >= 0) return SUBSTRING - at - haystack.length * 0.01;

  // A typo is a closer answer than letters found scattered, so this tier sits above that one.
  const typo = fuzzyScore(haystack, needle);
  if (typo !== null) return typo;

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
  return SUBSEQUENCE - gaps;
}

/**
 * A subsequence reads the typed letters in order, so it forgives a dropped letter but
 * never a swapped pair: "onbaording" misses "onboarding". This tier catches both.
 */
function fuzzyScore(haystack: string, needle: string): number | null {
  if (needle.length < FUZZY_MIN_LENGTH) return null;
  let best = similarity(haystack, needle);
  for (const word of haystack.split(WORD_SPLIT)) {
    best = Math.max(best, similarity(word, needle));
  }
  if (best < FUZZY_FLOOR) return null;
  return FUZZY + ((best - FUZZY_FLOOR) / (1 - FUZZY_FLOOR)) * FUZZY_SPREAD;
}

/** 0..1, where 1 is the same string. Divided by the longer side, so length counts. */
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - editDistance(a, b) / longest;
}

/** Levenshtein distance over two rows, which is all the algorithm ever needs. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(
        Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost),
      );
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
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

/**
 * Filter and rank palette rows. An empty query keeps the given order.
 * `minScore` names the loosest tier the caller will take; see `NAME_MATCH_FLOOR`.
 * A tie keeps the given order, so the caller decides what comes first.
 */
export function filterActions<T extends Matchable>(
  items: readonly T[],
  query: string,
  minScore = 0,
): T[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [...items];
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = scoreItem(item, trimmed);
    if (score === null || score < minScore) return;
    scored.push({ item, score, index });
  });
  scored.sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));
  return scored.map((entry) => entry.item);
}
