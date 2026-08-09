import { describe, expect, it } from 'vitest';
import {
  HandleSchema,
  MAX_HANDLE_LENGTH,
  findMentions,
  isHandle,
  toHandle,
  uniqueHandle,
} from '../src/mentions.js';

describe('isHandle', () => {
  it('accepts a lowercase handle with inner dots, dashes and underscores', () => {
    expect(isHandle('ada')).toBe(true);
    expect(isHandle('ada.lovelace')).toBe(true);
    expect(isHandle('ada-lovelace_1')).toBe(true);
  });

  it('refuses uppercase, edge punctuation and anything too long', () => {
    expect(isHandle('Ada')).toBe(false);
    expect(isHandle('.ada')).toBe(false);
    expect(isHandle('ada.')).toBe(false);
    expect(isHandle('@ada')).toBe(false);
    expect(isHandle('ada lovelace')).toBe(false);
    expect(isHandle('a'.repeat(MAX_HANDLE_LENGTH + 1))).toBe(false);
  });
});

describe('HandleSchema', () => {
  it('drops a leading @ and lowercases', () => {
    expect(HandleSchema.parse(' @Ada.Lovelace ')).toBe('ada.lovelace');
  });

  it('rejects a handle that cannot be repaired', () => {
    expect(HandleSchema.safeParse('ada lovelace').success).toBe(false);
  });
});

describe('toHandle', () => {
  it('turns a display name into a dotted handle', () => {
    expect(toHandle('Ada Lovelace')).toBe('ada.lovelace');
  });

  it('strips accents so the handle stays ascii', () => {
    expect(toHandle('Émile Borel')).toBe('emile.borel');
  });

  it('uses the whole email address, punctuation included', () => {
    expect(toHandle('ada@example.com')).toBe('ada.example.com');
  });

  it('never ends on punctuation, even after the length cut', () => {
    const handle = toHandle(`${'a'.repeat(MAX_HANDLE_LENGTH - 1)} bcd`);
    expect(handle.length).toBeLessThanOrEqual(MAX_HANDLE_LENGTH);
    expect(isHandle(handle)).toBe(true);
  });

  it('falls back to "user" when nothing usable is left', () => {
    expect(toHandle('***')).toBe('user');
  });
});

describe('uniqueHandle', () => {
  it('returns the base when it is free', () => {
    expect(uniqueHandle('ada', () => false)).toBe('ada');
  });

  it('adds a numeric suffix until the handle is free', () => {
    const taken = new Set(['ada', 'ada.2']);
    expect(uniqueHandle('ada', (handle) => taken.has(handle))).toBe('ada.3');
  });

  it('keeps the suffixed handle within the length limit', () => {
    const base = 'a'.repeat(MAX_HANDLE_LENGTH);
    const handle = uniqueHandle(base, (candidate) => candidate === base);
    expect(handle.length).toBeLessThanOrEqual(MAX_HANDLE_LENGTH);
    expect(isHandle(handle)).toBe(true);
  });
});

describe('findMentions', () => {
  it('finds a mention at the start of a line and after a space', () => {
    expect(findMentions('@ada wrote this with @sam.rivers')).toEqual(['ada', 'sam.rivers']);
  });

  it('lowercases and never repeats a handle', () => {
    expect(findMentions('@Ada and @ada again')).toEqual(['ada']);
  });

  it('finds a mention inside brackets and emphasis', () => {
    expect(findMentions('(@ada) *@sam*')).toEqual(['ada', 'sam']);
  });

  it('ignores an email address', () => {
    expect(findMentions('write to ada@example.com')).toEqual([]);
  });

  it('ignores a mention inside inline code', () => {
    expect(findMentions('run `curl @ada` now')).toEqual([]);
  });

  it('ignores a mention inside a fenced block', () => {
    const markdown = ['before', '```sh', 'ping @ada', '```', 'after @sam'].join('\n');
    expect(findMentions(markdown)).toEqual(['sam']);
  });

  it('closes a fence only on the same marker, so a nested fence stays code', () => {
    const markdown = ['~~~', '```', '@ada', '```', '~~~', '@sam'].join('\n');
    expect(findMentions(markdown)).toEqual(['sam']);
  });

  it('finds nothing in an empty body', () => {
    expect(findMentions('')).toEqual([]);
  });
});
