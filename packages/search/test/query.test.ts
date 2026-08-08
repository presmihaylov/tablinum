import { describe, expect, it } from 'vitest';
import { buildMatchExpressions, isFtsQueryError, parseQuery, toMatchExpression } from '../src/query.js';

describe('parseQuery', () => {
  it('splits plain words into single-term phrases', () => {
    expect(parseQuery('deploy runbook')).toEqual([['deploy'], ['runbook']]);
  });

  it('keeps a quoted run of words as one phrase', () => {
    expect(parseQuery('"incident response" now')).toEqual([['incident', 'response'], ['now']]);
  });

  it('closes an unterminated quote at the end of the input', () => {
    expect(parseQuery('foo" OR "')).toEqual([['foo'], ['OR']]);
  });

  it('drops every character that is not a letter, digit or underscore', () => {
    expect(parseQuery('NEAR(foo, 3)')).toEqual([['NEAR'], ['foo'], ['3']]);
    expect(parseQuery('col:*')).toEqual([['col']]);
    expect(parseQuery('foo-bar')).toEqual([['foo'], ['bar']]);
  });

  it('returns nothing for input with no usable term', () => {
    for (const query of ['', '   ', '*', '***', '()', '^', '""', '-', '%%%']) {
      expect(parseQuery(query)).toEqual([]);
    }
  });

  it('keeps unicode words and digits', () => {
    expect(parseQuery('café 2026 naïve')).toEqual([['café'], ['2026'], ['naïve']]);
  });

  it('caps the number of terms', () => {
    const many = Array.from({ length: 60 }, (_, n) => `t${n}`).join(' ');
    expect(parseQuery(many)).toHaveLength(24);
  });

  it('caps the length of the input', () => {
    const long = `${'a'.repeat(600)} tail`;
    const phrases = parseQuery(long);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]?.[0]).toHaveLength(512);
  });
});

describe('toMatchExpression', () => {
  it('quotes every phrase and ANDs them', () => {
    expect(toMatchExpression([['deploy'], ['runbook']], false)).toBe('"deploy" "runbook"');
  });

  it('joins the terms of a phrase inside one pair of quotes', () => {
    expect(toMatchExpression([['incident', 'response']], false)).toBe('"incident response"');
  });

  it('marks only the last phrase as a prefix', () => {
    expect(toMatchExpression([['deploy'], ['run']], true)).toBe('"deploy" "run"*');
  });

  it('quotes words that FTS5 would read as operators', () => {
    expect(toMatchExpression([['AND'], ['OR'], ['NOT'], ['NEAR']], false)).toBe(
      '"AND" "OR" "NOT" "NEAR"',
    );
  });

  it('doubles an embedded quote', () => {
    expect(toMatchExpression([['a"b']], false)).toBe('"a""b"');
  });

  it('returns an empty string for no phrases', () => {
    expect(toMatchExpression([], false)).toBe('');
  });
});

describe('buildMatchExpressions', () => {
  it('returns the exact expression first and the prefix one second', () => {
    expect(buildMatchExpressions('depl')).toEqual(['"depl"', '"depl"*']);
  });

  it('returns nothing when the query has no usable term', () => {
    expect(buildMatchExpressions('*')).toEqual([]);
    expect(buildMatchExpressions('')).toEqual([]);
  });

  it('never produces an unbalanced quote', () => {
    const hostile = ['foo" OR "', '"""""', '"unterminated', 'a"b"c"'];
    for (const query of hostile) {
      for (const expression of buildMatchExpressions(query)) {
        const quotes = expression.split('"').length - 1;
        expect(quotes % 2).toBe(0);
      }
    }
  });
});

describe('isFtsQueryError', () => {
  it('recognises an FTS5 parse failure', () => {
    expect(isFtsQueryError(new Error('fts5: syntax error near "*"'))).toBe(true);
    expect(isFtsQueryError(new Error('malformed MATCH expression'))).toBe(true);
  });

  it('does not swallow an unrelated failure', () => {
    expect(isFtsQueryError(new Error('database is locked'))).toBe(false);
    expect(isFtsQueryError('not an error')).toBe(false);
  });
});
