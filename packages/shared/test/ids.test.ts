import { describe, expect, it } from 'vitest';
import {
  PAGE_ID_PREFIX,
  ULID_LENGTH,
  isPageId,
  isUlid,
  newPageId,
  newUlid,
  pageIdTime,
  slugify,
  uniqueSlug,
} from '../src/ids.js';

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

describe('newUlid', () => {
  it('is 26 Crockford base32 characters', () => {
    const ulid = newUlid();
    expect(ulid).toHaveLength(ULID_LENGTH);
    expect(ulid).toMatch(CROCKFORD);
  });

  it('never contains the ambiguous letters I, L, O or U', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(newUlid()).not.toMatch(/[ILOU]/);
    }
  });

  it('increases within the same millisecond', () => {
    const first = newUlid(1000);
    const second = newUlid(1000);
    const third = newUlid(1000);
    expect(second > first).toBe(true);
    expect(third > second).toBe(true);
  });

  it('sorts by timestamp', () => {
    const now = Date.now();
    const older = newUlid(now);
    const newer = newUlid(now + 1);
    expect(newer > older).toBe(true);
  });

  it('rejects timestamps outside the 48-bit range', () => {
    expect(() => newUlid(-1)).toThrow(RangeError);
    expect(() => newUlid(281474976710656)).toThrow(RangeError);
    expect(() => newUlid(1.5)).toThrow(RangeError);
  });
});

describe('newPageId', () => {
  it('is the prefix plus a ULID', () => {
    const id = newPageId();
    expect(id.startsWith(PAGE_ID_PREFIX)).toBe(true);
    expect(id).toHaveLength(PAGE_ID_PREFIX.length + ULID_LENGTH);
    expect(isPageId(id)).toBe(true);
  });

  it('is unique across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i += 1) ids.add(newPageId());
    expect(ids.size).toBe(2000);
  });
});

describe('isPageId', () => {
  it('accepts generated ids', () => {
    expect(isPageId(newPageId())).toBe(true);
  });

  const bad = [
    '',
    'pg_',
    'pg_ABC',
    'nt_01J8XYZABCDEFGHJKMNPQRST',
    '01J8XYZABCDEFGHJKMNPQRSTVW',
    `pg_${'A'.repeat(25)}`,
    `pg_${'A'.repeat(27)}`,
    `pg_${'a'.repeat(26)}`,
    `pg_${'I'.repeat(26)}`,
    `pg_${'L'.repeat(26)}`,
    `pg_${'O'.repeat(26)}`,
    `pg_${'U'.repeat(26)}`,
    'pg_01J8XYZABCDEFGHJKMNPQRS-',
  ];
  it.each(bad)('rejects %j', (value) => {
    expect(isPageId(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isPageId(undefined)).toBe(false);
    expect(isPageId(null)).toBe(false);
    expect(isPageId(123)).toBe(false);
  });

  it('isUlid checks the bare ULID', () => {
    expect(isUlid(newUlid())).toBe(true);
    expect(isUlid(newPageId())).toBe(false);
  });
});

describe('pageIdTime', () => {
  it('round-trips the timestamp', () => {
    // Ahead of any timestamp an earlier test used, so the monotonic clamp does not kick in.
    const now = Date.now() + 5;
    expect(pageIdTime(newPageId(now))).toBe(now);
  });

  it('returns null for a malformed id', () => {
    expect(pageIdTime('nope')).toBeNull();
    expect(pageIdTime('pg_lowercase')).toBeNull();
  });
});

describe('slugify', () => {
  const cases: Array<[string, string]> = [
    ['Deploy runbook', 'deploy-runbook'],
    ['Deploy   runbook', 'deploy-runbook'],
    ['  Hello, World!  ', 'hello-world'],
    ['Café Münchén', 'cafe-munchen'],
    ['Q3 2026 Plan', 'q3-2026-plan'],
    ['snake_case_title', 'snake-case-title'],
    ['../../etc/passwd', 'etc-passwd'],
    ['C:\\windows\\system32', 'c-windows-system32'],
    ['index', 'index-page'],
    ['Index', 'index-page'],
    ['---', 'untitled'],
    ['', 'untitled'],
    ['!!!', 'untitled'],
    ['你好', 'untitled'],
  ];
  it.each(cases)('slugify(%j) === %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('never produces a path separator or a dot', () => {
    const slug = slugify('a/b/../c.d.e');
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('.');
  });

  it('truncates without leaving a trailing dash', () => {
    const long = slugify(`${'x'.repeat(79)} y`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('-')).toBe(false);
    expect(slugify('a'.repeat(200))).toHaveLength(80);
  });
});

describe('uniqueSlug', () => {
  it('returns the plain slug when free', () => {
    expect(uniqueSlug('Deploy runbook', [])).toBe('deploy-runbook');
  });

  it('appends a counter when taken', () => {
    expect(uniqueSlug('Deploy', ['deploy'])).toBe('deploy-2');
    expect(uniqueSlug('Deploy', ['deploy', 'deploy-2'])).toBe('deploy-3');
    expect(uniqueSlug('Deploy', ['deploy', 'deploy-3'])).toBe('deploy-2');
  });
});
