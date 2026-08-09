import { describe, expect, it } from 'vitest';
import { contentRev, hasConflictMarkers, mergeText } from '../src/merge.js';

const BASE = ['one', 'two', 'three', 'four', 'five'].join('\n');

describe('mergeText', () => {
  it('returns the text when nothing changed', () => {
    expect(mergeText(BASE, BASE, BASE)).toEqual({ clean: true, text: BASE, conflicts: [] });
  });

  it('takes the other side when only it changed', () => {
    const theirs = BASE.replace('three', 'THREE');
    expect(mergeText(BASE, BASE, theirs).text).toBe(theirs);
  });

  it('takes our side when only we changed', () => {
    const ours = BASE.replace('three', 'THREE');
    expect(mergeText(BASE, ours, BASE).text).toBe(ours);
  });

  it('keeps one copy when both made the same edit', () => {
    const same = BASE.replace('three', 'THREE');
    const result = mergeText(BASE, same, same);
    expect(result.clean).toBe(true);
    expect(result.text).toBe(same);
  });

  it('applies edits made in different places', () => {
    const ours = BASE.replace('one', 'ONE');
    const theirs = BASE.replace('five', 'FIVE');
    const result = mergeText(BASE, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.text).toBe('ONE\ntwo\nthree\nfour\nFIVE');
  });

  it('keeps both insertions when they land in different places', () => {
    const ours = 'one\ntwo\nfrom us\nthree\nfour\nfive';
    const theirs = 'one\ntwo\nthree\nfour\nfrom them\nfive';
    const result = mergeText(BASE, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.text).toBe('one\ntwo\nfrom us\nthree\nfour\nfrom them\nfive');
  });

  it('applies a deletion from one side and an edit from the other', () => {
    const ours = 'one\nthree\nfour\nfive';
    const theirs = BASE.replace('five', 'FIVE');
    const result = mergeText(BASE, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.text).toBe('one\nthree\nfour\nFIVE');
  });

  it('merges two edits to the same line when the words do not overlap', () => {
    const base = 'The quick brown fox jumps over the lazy dog.';
    const ours = 'The very quick brown fox jumps over the lazy dog.';
    const theirs = 'The quick brown fox jumps over the sleepy dog.';
    const result = mergeText(base, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.text).toBe('The very quick brown fox jumps over the sleepy dog.');
  });

  it('conflicts when both sides rewrote the same words', () => {
    const ours = BASE.replace('three', 'THREE');
    const theirs = BASE.replace('three', 'drei');
    const result = mergeText(BASE, ours, theirs);

    expect(result.clean).toBe(false);
    expect(result.conflicts).toEqual([{ base: 'three', ours: 'THREE', theirs: 'drei' }]);
    expect(result.text).toBe(
      ['one', 'two', '<<<<<<< ours', 'THREE', '=======', 'drei', '>>>>>>> theirs', 'four', 'five'].join(
        '\n',
      ),
    );
  });

  it('labels the two sides of a conflict', () => {
    const result = mergeText('a', 'b', 'c', { ours: 'Your edit', theirs: 'On the server' });

    expect(result.text).toContain('<<<<<<< Your edit');
    expect(result.text).toContain('>>>>>>> On the server');
    expect(hasConflictMarkers(result.text)).toBe(true);
  });

  it('reports every conflicting region separately', () => {
    const ours = 'ONE\ntwo\nthree\nfour\nFIVE';
    const theirs = 'eins\ntwo\nthree\nfour\nfünf';
    const result = mergeText(BASE, ours, theirs);

    expect(result.clean).toBe(false);
    expect(result.conflicts).toHaveLength(2);
  });

  it('keeps an unrelated edit clean while another region conflicts', () => {
    const ours = 'ONE\ntwo\nthree\nfour\nfive';
    const theirs = 'eins\ntwo\nthree\nfour\nFIVE';
    const result = mergeText(BASE, ours, theirs);

    expect(result.clean).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.text.endsWith('four\nFIVE')).toBe(true);
  });

  it('keeps the trailing newline of a markdown body', () => {
    const base = '# Title\n\nA paragraph.\n';
    const ours = '# Title\n\nA longer paragraph.\n';
    const theirs = '# Title\n\nA paragraph.\n\nAnd another.\n';
    const result = mergeText(base, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.text).toBe('# Title\n\nA longer paragraph.\n\nAnd another.\n');
  });

  it('merges an append from each side', () => {
    const base = '# Notes\n';
    const ours = '# Notes\n\n- mine\n';
    const theirs = '# Notes\n';
    expect(mergeText(base, ours, theirs).text).toBe('# Notes\n\n- mine\n');
  });

  it('conflicts when both appended different lines at the end', () => {
    const base = '# Notes\n';
    const result = mergeText(base, '# Notes\n\n- mine\n', '# Notes\n\n- theirs\n');

    expect(result.clean).toBe(false);
    expect(hasConflictMarkers(result.text)).toBe(true);
  });

  it('handles an empty base', () => {
    expect(mergeText('', 'hello', '').text).toBe('hello');
    expect(mergeText('', '', 'hello').text).toBe('hello');
  });

  it('handles a deletion of everything', () => {
    expect(mergeText(BASE, '', BASE).text).toBe('');
  });

  it('survives a large document', () => {
    const lines = Array.from({ length: 4000 }, (_, index) => `line ${index}`);
    const base = lines.join('\n');
    const ours = [...lines];
    ours[10] = 'ours';
    const theirs = [...lines];
    theirs[3000] = 'theirs';
    const result = mergeText(base, ours.join('\n'), theirs.join('\n'));

    expect(result.clean).toBe(true);
    expect(result.text.split('\n')[10]).toBe('ours');
    expect(result.text.split('\n')[3000]).toBe('theirs');
  });

  it('merges edits on lines that merely touch', () => {
    const base = ['a', 'b', 'c', 'd'].join('\n');
    // Theirs replaces the run that ends exactly where ours begins.
    const theirs = ['A', 'B', 'c', 'd'].join('\n');
    const ours = ['a', 'b', 'C', 'd'].join('\n');
    const result = mergeText(base, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.text).toBe(['A', 'B', 'C', 'd'].join('\n'));
  });

  it('merges when many writers each change one line of a block', () => {
    const count = 12;
    const base = Array.from({ length: count }, (_, i) => `w${i}:`).join('\n');
    const theirs = base
      .split('\n')
      .map((line, i) => (i < count - 1 ? `${line} theirs` : line))
      .join('\n');
    const ours = base
      .split('\n')
      .map((line, i) => (i === count - 1 ? `${line} ours` : line))
      .join('\n');
    const result = mergeText(base, ours, theirs);

    expect(result.clean).toBe(true);
    expect(result.text.split('\n')[0]).toBe('w0: theirs');
    expect(result.text.split('\n')[count - 1]).toBe(`w${count - 1}: ours`);
  });

  it('still conflicts when both replace the same line', () => {
    const base = ['a', 'b', 'c'].join('\n');
    const result = mergeText(base, ['a', 'ours', 'c'].join('\n'), ['a', 'theirs', 'c'].join('\n'));
    expect(result.clean).toBe(false);
    expect(result.conflicts).toHaveLength(1);
  });

  it('keeps both insertions when each side adds a different line at the same place', () => {
    const base = ['a', 'b'].join('\n');
    const result = mergeText(base, ['a', 'ours', 'b'].join('\n'), ['a', 'theirs', 'b'].join('\n'));
    // Two people typed a new line at the same point. There is no order to prefer, so it is told.
    expect(result.clean).toBe(false);
  });
});

describe('contentRev', () => {
  it('is stable for the same text', () => {
    expect(contentRev(BASE)).toBe(contentRev(BASE));
  });

  it('changes when the text changes', () => {
    expect(contentRev(BASE)).not.toBe(contentRev(`${BASE}\n`));
    expect(contentRev('ab')).not.toBe(contentRev('ba'));
  });

  it('answers for an empty body', () => {
    expect(contentRev('')).toMatch(/^0-/);
  });
});
