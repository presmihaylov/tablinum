import { describe, expect, it } from 'vitest';
import { collapseUnchanged, diffLines, type DiffRow } from '../src/lib/diff';

function render(rows: DiffRow[]): string[] {
  const sign = { same: ' ', add: '+', del: '-' };
  return rows.map((row) => `${sign[row.kind]}${row.text}`);
}

describe('diffLines', () => {
  it('reports no change for identical text', () => {
    const rows = diffLines('one\ntwo\n', 'one\ntwo\n');
    expect(rows.every((row) => row.kind === 'same')).toBe(true);
  });

  it('marks an added line', () => {
    expect(render(diffLines('one\ntwo', 'one\nmiddle\ntwo'))).toEqual([
      ' one',
      '+middle',
      ' two',
    ]);
  });

  it('marks a deleted line', () => {
    expect(render(diffLines('one\nmiddle\ntwo', 'one\ntwo'))).toEqual([
      ' one',
      '-middle',
      ' two',
    ]);
  });

  it('marks a changed line as a delete and an add', () => {
    expect(render(diffLines('one\ntwo', 'one\nTWO'))).toEqual([' one', '-two', '+TWO']);
  });

  it('handles an empty side', () => {
    expect(render(diffLines('', 'one'))).toEqual(['-', '+one']);
    expect(render(diffLines('one', ''))).toEqual(['-one', '+']);
  });

  it('keeps every line of both sides', () => {
    const before = 'a\nb\nc\nd\n';
    const after = 'a\nx\nc\ny\n';
    const rows = diffLines(before, after);
    expect(rows.filter((row) => row.kind !== 'add').map((row) => row.text)).toEqual(
      before.split('\n'),
    );
    expect(rows.filter((row) => row.kind !== 'del').map((row) => row.text)).toEqual(
      after.split('\n'),
    );
  });

  it('falls back to a whole replacement on a text too large to diff', () => {
    const before = Array.from({ length: 2100 }, (_, index) => `a${index}`).join('\n');
    const after = Array.from({ length: 2100 }, (_, index) => `b${index}`).join('\n');
    const rows = diffLines(before, after);
    expect(rows.filter((row) => row.kind === 'del')).toHaveLength(2100);
    expect(rows.filter((row) => row.kind === 'add')).toHaveLength(2100);
    expect(rows.some((row) => row.kind === 'same')).toBe(false);
  });
});

describe('collapseUnchanged', () => {
  it('leaves a short diff alone', () => {
    const rows = diffLines('one\ntwo', 'one\nTWO');
    expect(collapseUnchanged(rows)).toEqual(rows);
  });

  it('replaces a long run of unchanged lines with one gap', () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n');
    const after = before.replace('line 0', 'changed');
    const collapsed = collapseUnchanged(diffLines(before, after), 3);

    expect(collapsed.filter((row) => row === 'gap')).toHaveLength(1);
    // Two changed lines plus three lines of context after them.
    expect(collapsed.filter((row) => row !== 'gap')).toHaveLength(5);
  });

  it('keeps a gap for each separate run', () => {
    const lines = Array.from({ length: 60 }, (_, index) => `line ${index}`);
    const before = lines.join('\n');
    const after = lines.map((line, index) => (index === 10 || index === 50 ? 'changed' : line)).join('\n');
    const collapsed = collapseUnchanged(diffLines(before, after), 2);
    expect(collapsed.filter((row) => row === 'gap')).toHaveLength(3);
  });

  it('returns nothing but a gap when nothing changed', () => {
    const rows = diffLines('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nd\ne\nf\ng\nh');
    expect(collapseUnchanged(rows)).toEqual(['gap']);
  });
});
