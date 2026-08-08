import { describe, expect, it } from 'vitest';
import { CORPUS } from './corpus';
import { roundtrip } from './harness';

/**
 * THE contract of the editor: opening a page and saving it again must not change
 * one byte of the file. Anything less turns every page view into a git diff.
 */
describe('markdown round trip', () => {
  for (const [name, source] of Object.entries(CORPUS)) {
    it(`is byte-identical: ${name}`, () => {
      expect(roundtrip(source)).toBe(source);
    });
  }

  it('is idempotent across a second pass', () => {
    for (const source of Object.values(CORPUS)) {
      const once = roundtrip(source);
      expect(roundtrip(once)).toBe(once);
    }
  });

  /**
   * Markdown block context is not compositional: two lists that touch merge into
   * one, and a `---` under a paragraph becomes a heading. The corpus is therefore
   * joined with a comment fence, which is the neutral separator markdown has.
   */
  it('keeps the whole corpus stable when concatenated into one document', () => {
    const document = Object.values(CORPUS)
      .map((entry) => entry.replace(/^\n+/, '').replace(/\n*$/, ''))
      .join('\n\n<!-- fence -->\n\n');
    const source = `${document}\n`;
    expect(roundtrip(source)).toBe(source);
  });

  it('preserves CRLF line endings', () => {
    const source = '# Title\r\n\r\n- one\r\n- two\r\n';
    expect(roundtrip(source)).toBe(source);
  });

  it('handles an empty document', () => {
    expect(roundtrip('')).toBe('');
  });
});

/**
 * Constructs that do NOT survive today. Each one is a git diff produced by
 * opening a page and closing it. `it.fails` passes while the bug is present, so
 * fixing one turns this suite red and the entry moves up into CORPUS.
 */
const KNOWN_CHURN: Record<string, string> = {
  // Structure loss: a hand-numbered nested list keeps its numbers but is re-indented.
  'nested ordered list numbered 1/2/3': '1. one\n   2. two\n      3. three\n',

  // Whitespace and marker normalisation.
  'nested list indented four spaces': '- one\n    - two\n        - three\n',
  'nested list indented three spaces': '- one\n   - two\n      - three\n',
  'list items with trailing spaces': '- one  \n- two   \n',
  'table header with trailing spaces': '| a | b |  \n| --- | --- |\n| 1 | 2 |\n',
  'table row with trailing spaces': '| a | b |\n| --- | --- |\n| 1 | 2 |   \n',
  'fence indented two spaces': '  ```js\n  let a = 1;\n  ```\n',
  'fence left unclosed at end of file': '```js\nlet a = 1;\n',
  'inline code padded with spaces': 'Use ` a ` here.\n',
  'blockquote with a lazy continuation': '> one\ntwo\n',
  'blockquote with no space after the marker': '>one\n>two\n',
  'image title in single quotes': "![A diagram](/a.png 'Figure 1')\n",
  'image title in parentheses': '![A diagram](/a.png (Figure 1))\n',
  'image title holding an escaped quote': '![d](/a.png "He said \\"hi\\"")\n',
  'document mixing CRLF and LF': '# T\r\n\n- a\r\n',
};

describe('markdown round trip: known churn', () => {
  for (const [name, source] of Object.entries(KNOWN_CHURN)) {
    it.fails(`still churns: ${name}`, () => {
      expect(roundtrip(source)).toBe(source);
    });
  }
});

/**
 * An empty callout as the last block used to append one blank line on every save,
 * without limit. Repeated saves must settle on the source bytes.
 */
describe('markdown round trip: convergence', () => {
  for (const source of ['> [!NOTE]\n', '# T\n\n> [!NOTE]\n', '> [!TIP]\n> Body.\n']) {
    it(`never grows: ${JSON.stringify(source)}`, () => {
      let current = source;
      for (let pass = 0; pass < 6; pass += 1) {
        current = roundtrip(current);
        expect(current).toBe(source);
      }
    });
  }
});
