import { describe, expect, it } from 'vitest';
import type { PageId } from '@tablinum/shared';
import { RevHistory } from '../src/rev-history.js';

const page = 'pg_one' as PageId;
const other = 'pg_two' as PageId;

describe('RevHistory', () => {
  it('gives back the body a rev named', () => {
    const history = new RevHistory();
    history.record(page, 'r1', 'hello');
    expect(history.find(page, 'r1')).toBe('hello');
  });

  it('answers null for a rev it never saw', () => {
    const history = new RevHistory();
    expect(history.find(page, 'nope')).toBeNull();
  });

  it('keeps pages apart', () => {
    const history = new RevHistory();
    history.record(page, 'r1', 'mine');
    expect(history.find(other, 'r1')).toBeNull();
  });

  it('drops the oldest rev once the page is full', () => {
    const history = new RevHistory(3);
    for (const rev of ['r1', 'r2', 'r3', 'r4']) history.record(page, rev, rev);

    expect(history.find(page, 'r1')).toBeNull();
    expect(history.find(page, 'r4')).toBe('r4');
  });

  it('re-recording a rev does not use up a slot', () => {
    const history = new RevHistory(2);
    history.record(page, 'r1', 'one');
    history.record(page, 'r1', 'one');
    history.record(page, 'r2', 'two');

    expect(history.find(page, 'r1')).toBe('one');
    expect(history.find(page, 'r2')).toBe('two');
  });

  it('stays inside its byte budget', () => {
    const history = new RevHistory(64, 100);
    for (let i = 0; i < 50; i += 1) history.record(page, `r${i}`, 'x'.repeat(20));

    expect(history.bytes).toBeLessThanOrEqual(100);
    expect(history.find(page, 'r49')).toBe('x'.repeat(20));
  });

  it('evicts the least recently touched page first', () => {
    const history = new RevHistory(1, 10);
    history.record(page, 'r1', 'x'.repeat(10));
    history.record(other, 'r1', 'y'.repeat(10));

    expect(history.find(page, 'r1')).toBeNull();
    expect(history.find(other, 'r1')).toBe('y'.repeat(10));
  });

  it('forgets a page on request', () => {
    const history = new RevHistory();
    history.record(page, 'r1', 'hello');
    history.forget(page);

    expect(history.find(page, 'r1')).toBeNull();
    expect(history.bytes).toBe(0);
  });

  it('reports nothing held after a clear', () => {
    const history = new RevHistory();
    history.record(page, 'r1', 'hello');
    history.clear();

    expect(history.size).toBe(0);
    expect(history.bytes).toBe(0);
  });
});
