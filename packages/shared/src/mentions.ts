import { z } from 'zod';

/**
 * Mentions.
 *
 * A mention is plain `@handle` text in the markdown. Nothing is encoded, so a page that is
 * read outside gitdocs, by a person or by an agent, still shows who was named. The handle is
 * therefore permanent: renaming a person must never rewrite their pages.
 */

/** Longest handle the server stores, including no `@`. */
export const MAX_HANDLE_LENGTH = 32;

/**
 * The body of a handle, without the leading `@`. Lowercase, starts and ends with a letter or
 * a digit. Exported as a string so the editor can build its own rule from the same source.
 */
export const HANDLE_PATTERN = '[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?';

const HANDLE_RE = new RegExp(`^${HANDLE_PATTERN}$`);

export const isHandle = (value: unknown): value is string =>
  typeof value === 'string' && HANDLE_RE.test(value);

export const HandleSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, '').toLowerCase())
  .refine(isHandle, 'Expected a handle like "ada.lovelace"');

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

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_CODE_RE = /`[^`\n]*`/g;

function stripCode(markdown: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    kept.push(line.replace(INLINE_CODE_RE, ' '));
  }
  return kept.join('\n');
}
