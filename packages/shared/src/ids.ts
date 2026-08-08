import type { PageId } from './types.js';

/** Crockford base32: no I, L, O or U, so ids never spell anything and never mistype. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;
export const ULID_LENGTH = TIME_LEN + RANDOM_LEN;
export const PAGE_ID_PREFIX = 'pg_';

const PAGE_ID_RE = /^pg_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const MAX_TIME = 281474976710655; // 2^48 - 1

let lastTime = -1;
const lastRandom = new Uint8Array(RANDOM_LEN);

function fillRandom(target: Uint8Array): void {
  const bytes = new Uint8Array(target.length);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < target.length; i += 1) {
    // Each output char carries 5 bits, so fold a byte down into the alphabet range.
    target[i] = bytes[i]! % ALPHABET.length;
  }
}

/** Bump the random part in place so two ULIDs in the same millisecond stay ordered. */
function incrementRandom(target: Uint8Array): void {
  for (let i = target.length - 1; i >= 0; i -= 1) {
    const next = target[i]! + 1;
    if (next < ALPHABET.length) {
      target[i] = next;
      return;
    }
    target[i] = 0;
  }
  fillRandom(target); // overflowed all 80 bits; astronomically unlikely
}

function assertTime(time: number): void {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
    throw new RangeError(`ULID timestamp out of range: ${time}`);
  }
}

function encodeTime(time: number): string {
  let rest = time;
  let out = '';
  for (let i = 0; i < TIME_LEN; i += 1) {
    out = ALPHABET[rest % ALPHABET.length]! + out;
    rest = Math.floor(rest / ALPHABET.length);
  }
  return out;
}

function randomChars(): string {
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i += 1) out += ALPHABET[lastRandom[i]!];
  return out;
}

/** Generate a monotonic ULID (26 Crockford base32 chars). */
export function newUlid(now: number = Date.now()): string {
  assertTime(now);
  // A repeated or backwards clock reuses the last timestamp and bumps the random part,
  // so ids stay strictly increasing and stay unique.
  if (now <= lastTime) {
    incrementRandom(lastRandom);
    return encodeTime(lastTime) + randomChars();
  }
  lastTime = now;
  fillRandom(lastRandom);
  return encodeTime(now) + randomChars();
}

/** Generate a fresh, stable page id. */
export function newPageId(now: number = Date.now()): PageId {
  return PAGE_ID_PREFIX + newUlid(now);
}

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && PAGE_ID_RE.test(value);
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && PAGE_ID_RE.test(PAGE_ID_PREFIX + value);
}

/** Milliseconds since epoch encoded in a page id, or null if the id is malformed. */
export function pageIdTime(id: string): number | null {
  if (!isPageId(id)) return null;
  let time = 0;
  for (const char of id.slice(PAGE_ID_PREFIX.length, PAGE_ID_PREFIX.length + TIME_LEN)) {
    time = time * ALPHABET.length + ALPHABET.indexOf(char);
  }
  return time;
}

const DIACRITICS_RE = /[\u0300-\u036f]/g;
const NON_SLUG_RE = /[^a-z0-9]+/g;
const MAX_SLUG_LENGTH = 80;

/**
 * Turn a title into a safe single path segment used as the markdown filename.
 * The result is always a valid page-path segment: non-empty, lowercase, no slashes,
 * no dots, no leading or trailing dash.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(NON_SLUG_RE, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  if (slug.length === 0) return 'untitled';
  // "index" is the reserved basename of a page that has children.
  if (slug === 'index') return 'index-page';
  return slug;
}

/** Append "-2", "-3", ... until the slug is not in `taken`. */
export function uniqueSlug(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(title);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
