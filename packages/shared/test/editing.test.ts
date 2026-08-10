import { describe, expect, it } from 'vitest';
import {
  clampCursor,
  collapsed,
  cursorAt,
  findAll,
  offsetOf,
  spanOffsets,
  spanText,
  splice,
  splitBlocks,
  wholePage,
} from '../src/editing.js';

const PAGE = ['# Title', '', 'The first paragraph.', '', '- one', '- two', '', 'The end.'].join('\n');

describe('splitBlocks', () => {
  it('cuts a page where the blank lines are', () => {
    const blocks = splitBlocks(PAGE);
    expect(blocks.map((block) => block.text)).toEqual([
      '# Title',
      'The first paragraph.',
      '- one\n- two',
      'The end.',
    ]);
    expect(blocks.map((block) => block.index)).toEqual([0, 1, 2, 3]);
  });

  it('points every block at the text it came from', () => {
    for (const block of splitBlocks(PAGE)) {
      expect(PAGE.slice(block.start, block.end)).toBe(block.text);
    }
  });

  it('keeps a blank line inside a fence out of it', () => {
    const page = ['Before.', '', '```js', 'const a = 1;', '', 'const b = 2;', '```', '', 'After.'].join('\n');
    const blocks = splitBlocks(page);
    expect(blocks).toHaveLength(3);
    expect(blocks[1].text).toContain('const b = 2;');
    expect(blocks[2].text).toBe('After.');
  });

  it('is not closed by a fence of another kind', () => {
    const page = ['~~~text', 'a', '```', 'b', '~~~', '', 'After.'].join('\n');
    const blocks = splitBlocks(page);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain('```');
  });

  it('gives an empty page one empty block, so there is somewhere to stand', () => {
    expect(splitBlocks('')).toEqual([{ index: 0, start: 0, end: 0, text: '' }]);
  });

  it('ignores the blank lines at the edges of a page', () => {
    const blocks = splitBlocks('\n\nOnly this.\n\n');
    expect(blocks.map((block) => block.text)).toEqual(['Only this.']);
  });
});

describe('positions', () => {
  it('turns a cursor into an offset and back', () => {
    const blocks = splitBlocks(PAGE);
    const cursor = { block: 2, offset: 3 };
    const offset = offsetOf(blocks, cursor);
    expect(PAGE.slice(offset, offset + 2)).toBe('ne');
    expect(cursorAt(blocks, offset)).toEqual(cursor);
  });

  it('moves a cursor past the end of its block back onto the text', () => {
    const blocks = splitBlocks(PAGE);
    expect(clampCursor(blocks, { block: 0, offset: 500 })).toEqual({ block: 0, offset: 7 });
    expect(clampCursor(blocks, { block: 99, offset: 0 })).toEqual({ block: 3, offset: 0 });
    expect(clampCursor(blocks, { block: -4, offset: -9 })).toEqual({ block: 0, offset: 0 });
  });

  it('puts an offset in the gap between two blocks at the end of the first', () => {
    const blocks = splitBlocks(PAGE);
    const gap = blocks[0].end;
    expect(cursorAt(blocks, gap)).toEqual({ block: 0, offset: 7 });
  });

  it('reads a span in the order the text runs, whichever way it was made', () => {
    const blocks = splitBlocks(PAGE);
    const backwards = { anchor: { block: 3, offset: 4 }, head: { block: 1, offset: 4 } };
    const { from, to } = spanOffsets(blocks, backwards);
    expect(from).toBeLessThan(to);
    expect(spanText(PAGE, backwards)).toBe(PAGE.slice(from, to));
    expect(spanText(PAGE, backwards).startsWith('first')).toBe(true);
  });

  it('selects nothing when a caret is collapsed', () => {
    expect(spanText(PAGE, collapsed({ block: 1, offset: 2 }))).toBe('');
  });

  it('covers the page from the first character to the last', () => {
    const blocks = splitBlocks(PAGE);
    expect(spanText(PAGE, wholePage(blocks))).toBe(PAGE);
  });
});

describe('text edits', () => {
  it('replaces the characters a span covers', () => {
    const blocks = splitBlocks(PAGE);
    const span = { anchor: { block: 3, offset: 0 }, head: { block: 3, offset: 3 } };
    const { from, to } = spanOffsets(blocks, span);
    expect(splice(PAGE, from, to, 'That is')).toContain('That is end.');
  });

  it('finds every place a phrase appears, without overlaps', () => {
    expect(findAll('aaaa', 'aa')).toEqual([0, 2]);
    expect(findAll(PAGE, 'The')).toEqual([9, 44]);
    expect(findAll(PAGE, 'missing')).toEqual([]);
    expect(findAll(PAGE, '')).toEqual([]);
  });
});
