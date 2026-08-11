import { z } from 'zod';

/**
 * Mentions.
 *
 * A mention is plain `@handle` text in the markdown. Nothing is encoded, so a page that is
 * read outside tablinum, by a person or by an agent, still shows who was named. That is also
 * why a handle cannot simply be swapped in the account database: a rename has to rewrite the
 * text of every page and every comment that carries it, which renameMentions() below does.
 */

/** Longest handle the server stores, including no `@`. */
export const MAX_HANDLE_LENGTH = 32;

/**
 * How long a person waits between two handle changes.
 *
 * Each change rewrites every page that names them and makes a commit, so an unbounded rename
 * is a way to churn the repository. One a day is enough for a person who mistyped their own.
 */
export const HANDLE_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Whoever wrote something: a person or an agent. Both author pages and comments, so the parts
 * that only need a name and an id take this instead of a whole account.
 */
export interface Writer {
  id: string;
  name: string;
}

/**
 * The body of a handle, without the leading `@`. Lowercase, starts and ends with a letter or
 * a digit. Exported as a string so the editor can build its own rule from the same source.
 */
export const HANDLE_PATTERN = '[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?';

/** The same rule in words. It sits beside the pattern so a refusal cannot describe another one. */
export const HANDLE_HINT = 'A handle looks like "ada.lovelace": letters and digits, joined by . - or _.';

const HANDLE_RE = new RegExp(`^${HANDLE_PATTERN}$`);

export const isHandle = (value: unknown): value is string =>
  typeof value === 'string' && HANDLE_RE.test(value);

/**
 * A handle as it is written down: no leading `@`, lower case.
 *
 * The browser, the API and the account database all take a handle a person typed, so all three
 * spell it the same way through this one function rather than each repeating the rule.
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

export const HandleSchema = z.string().transform(normalizeHandle).refine(isHandle, HANDLE_HINT);

/**
 * A mention must start a word, so `mail@example.com` is an address and not a mention of
 * `example`. An opening bracket or quote counts as a start, so `(@ada)` works.
 */
const MENTION_RE = new RegExp(`(^|[\\s([{<"'*_~])@(${HANDLE_PATTERN})`, 'gi');

/** Turns a name or an email address into a handle: "Ada Lovelace" becomes "ada.lovelace". */
export function toHandle(source: string): string {
  const plain = source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const dotted = plain.replace(/[^a-z0-9]+/g, '.');
  const trimmed = dotted
    .replace(/^\.+/, '')
    .slice(0, MAX_HANDLE_LENGTH)
    .replace(/\.+$/, '');
  return isHandle(trimmed) ? trimmed : 'user';
}

/**
 * Adds a numeric suffix until the handle is free. `taken` answers for the store, so this stays
 * a pure function and is testable without a database.
 */
export function uniqueHandle(base: string, taken: (handle: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = String(n);
    const stem = base.slice(0, MAX_HANDLE_LENGTH - suffix.length - 1).replace(/[.\-_]+$/, '');
    const candidate = `${stem}.${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error(`Cannot find a free handle for ${JSON.stringify(base)}`);
}

/**
 * Every handle mentioned in a markdown body, lowercased, in the order it appears and without
 * repeats. Code is removed first: `@ada` in a shell example names nobody.
 */
export function findMentions(markdown: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of stripCode(markdown).matchAll(MENTION_RE)) {
    const handle = match[2]?.toLowerCase();
    if (handle === undefined || seen.has(handle)) continue;
    seen.add(handle);
    found.push(handle);
  }
  return found;
}

/**
 * The same markdown with every `@from` written as `@to`.
 *
 * Only whole mentions are touched: `@ada.lovelace.2` is somebody else and stays, and code is
 * left exactly as it was, so `@ada` in a shell example is not rewritten either. Both rules are
 * the ones findMentions() reads by, so anything it finds is what this changes.
 */
export function renameMentions(markdown: string, from: string, to: string): string {
  const wanted = from.toLowerCase();
  if (wanted === to) return markdown;

  const lines: string[] = [];
  for (const { line, fenced } of eachLine(markdown)) {
    lines.push(fenced ? line : renameInLine(line, wanted, to));
  }
  return lines.join('\n');
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_CODE_RE = /`[^`\n]*`/g;

/**
 * Every line of a body, each said to be inside a fenced code block or not. The fence lines
 * themselves count as fenced.
 *
 * There is one state machine because there used to be two: stripCode() and renameMentions()
 * each carried their own copy, including the rule that a fence closes only on the same
 * character and never on a shorter run. What findMentions() reads and what renameMentions()
 * writes agree now because they walk the same generator, not because somebody copied it right.
 */
function* eachLine(markdown: string): Generator<{ line: string; fenced: boolean }> {
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      yield { line, fenced: true };
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      yield { line, fenced: true };
      continue;
    }
    yield { line, fenced: false };
  }
}

/** Inline code blanked to the same width, so an offset into it still points at `line`. */
function maskInlineCode(line: string): string {
  return line.replace(INLINE_CODE_RE, (code) => ' '.repeat(code.length));
}

function renameInLine(line: string, from: string, to: string): string {
  // The mask is what the regex walks, so a mention inside backticks is passed over and a
  // mention right after them still sees a word start, which is what stripCode() gives
  // findMentions() when it turns the same span into whitespace.
  const masked = maskInlineCode(line);
  let out = '';
  let cursor = 0;
  MENTION_RE.lastIndex = 0;
  for (let match = MENTION_RE.exec(masked); match !== null; match = MENTION_RE.exec(masked)) {
    const handle = match[2];
    if (handle === undefined || handle.toLowerCase() !== from) continue;
    const at = match.index + (match[1]?.length ?? 0);
    out += line.slice(cursor, at) + `@${to}`;
    cursor = at + 1 + handle.length;
  }
  return out + line.slice(cursor);
}

function stripCode(markdown: string): string {
  const kept: string[] = [];
  for (const { line, fenced } of eachLine(markdown)) {
    if (!fenced) kept.push(line.replace(INLINE_CODE_RE, ' '));
  }
  return kept.join('\n');
}
