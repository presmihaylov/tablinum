/**
 * User text -> a MATCH expression FTS5 cannot choke on.
 *
 * FTS5 raises a syntax error for stray quotes, `*`, `NEAR(`, `AND`/`OR`/`NOT` in
 * operator position and unbalanced parentheses. Rather than blacklisting those,
 * we keep only word characters and re-quote every term, so nothing the user types
 * is ever read as an operator.
 */

/** One phrase: an ordered run of terms that must appear together. */
export type Phrase = readonly string[];

/** A column of the index a match may be restricted to. */
export type SearchField = 'title' | 'body' | 'path';

/** Every column, in the declared order of pages_fts. */
export const SEARCH_FIELDS: readonly SearchField[] = ['title', 'body', 'path'];

const TOKEN_RE = /[\p{L}\p{N}_]+/gu;
const MAX_QUERY_LENGTH = 512;
const MAX_TOKENS = 24;

/** Double up embedded quotes, the only escape FTS5 string literals understand. */
function escapeTerm(term: string): string {
  return term.replace(/"/g, '""');
}

/**
 * Split raw user input into phrases.
 * Text inside double quotes becomes one phrase; everything else becomes single-term phrases.
 * An unterminated quote is treated as if it closed at the end of the input.
 */
export function parseQuery(raw: string): Phrase[] {
  if (typeof raw !== 'string') return [];
  const text = raw.slice(0, MAX_QUERY_LENGTH);
  const phrases: Phrase[] = [];
  let used = 0;

  const chunks = text.split('"');
  for (let index = 0; index < chunks.length; index += 1) {
    const tokens = chunks[index]?.match(TOKEN_RE) ?? [];
    if (tokens.length === 0) continue;
    const budgeted = tokens.slice(0, Math.max(0, MAX_TOKENS - used));
    if (budgeted.length === 0) break;
    used += budgeted.length;

    const insideQuotes = index % 2 === 1;
    if (insideQuotes) {
      phrases.push(budgeted);
      continue;
    }
    for (const token of budgeted) phrases.push([token]);
  }

  return phrases;
}

/**
 * `{title path}`, the FTS5 column filter. Null when the filter would name every
 * column, because that restricts nothing and only lengthens the expression.
 */
function columnFilter(fields: readonly SearchField[] | undefined): string | null {
  if (fields === undefined) return null;
  const wanted = SEARCH_FIELDS.filter((field) => fields.includes(field));
  if (wanted.length === 0 || wanted.length === SEARCH_FIELDS.length) return null;
  return `{${wanted.join(' ')}}`;
}

/**
 * Render phrases as an FTS5 MATCH expression. Phrases are ANDed together.
 * With `prefixLast`, the final phrase matches on a prefix so "depl" finds "deploy".
 * With `fields`, every phrase must hit inside those columns, so a word that reads
 * only in the body of a page no longer answers.
 */
export function toMatchExpression(
  phrases: readonly Phrase[],
  prefixLast: boolean,
  fields?: readonly SearchField[],
): string {
  const parts: string[] = [];
  for (let index = 0; index < phrases.length; index += 1) {
    const terms = phrases[index];
    if (terms === undefined || terms.length === 0) continue;
    const quoted = `"${terms.map(escapeTerm).join(' ')}"`;
    const isLast = index === phrases.length - 1;
    parts.push(prefixLast && isLast ? `${quoted}*` : quoted);
  }
  if (parts.length === 0) return '';

  // The colon binds to the one phrase or group that follows it, so the parentheses
  // are what carry the filter across every phrase of a multi-word query.
  const scope = columnFilter(fields);
  if (scope === null) return parts.join(' ');
  return `${scope} : (${parts.join(' ')})`;
}

/** Build both attempts for a raw query: the exact one first, the prefix one as a fallback. */
export function buildMatchExpressions(
  raw: string,
  fields?: readonly SearchField[],
): string[] {
  const phrases = parseQuery(raw);
  if (phrases.length === 0) return [];
  const exact = toMatchExpression(phrases, false, fields);
  const prefix = toMatchExpression(phrases, true, fields);
  if (exact.length === 0) return [];
  if (prefix === exact) return [exact];
  return [exact, prefix];
}

/** True when the error came from an unparsable MATCH expression rather than from the store. */
export function isFtsQueryError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes('fts5') ||
    message.includes('malformed match') ||
    message.includes('syntax error')
  );
}
