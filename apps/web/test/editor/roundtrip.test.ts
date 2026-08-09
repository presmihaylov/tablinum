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

  // Two passes over the whole corpus. It needs more than the default 5s on a
  // shared CI runner.
  it('is idempotent across a second pass', () => {
    for (const source of Object.values(CORPUS)) {
      const once = roundtrip(source);
      expect(roundtrip(once)).toBe(once);
    }
  }, 30_000);

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
  // Not a nested list: an ordered marker that does not start at 1 cannot interrupt a
  // paragraph, so lines 2 and 3 are lazy continuations of the first item and are written
  // back at that item's own indent.
  'nested ordered list numbered 1/2/3': '1. one\n   2. two\n      3. three\n',

  // Whitespace and marker normalisation. The parser reports one marker and one gap, never
  // the exact spaces around them, so each of these is written back in the canonical form.
  'nested list indented four spaces': '- one\n    - two\n        - three\n',
  'nested list indented three spaces': '- one\n   - two\n      - three\n',
  'item holding a nested list past the marker': '-   - inner\n',
  'list items with trailing spaces': '- one  \n- two   \n',
  'ordered list with a padded marker': '1.  one\n2.  two\n',
  'tab after a list marker': '-\tone\n',
  'task item with a tab after the checkbox': '- [x]\tdone\n',
  'indented top-level list': '   - one\n   - two\n',
  'paragraph continuation with an indent': 'Text.\n    more\n',
  'blank separator line holding spaces': '# A\n  \n\nB\n',
  'fence indented two spaces': '  ```js\n  let a = 1;\n  ```\n',
  'fence left unclosed at end of file': '```js\nlet a = 1;\n',
  'inline code padded with spaces': 'Use ` a ` here.\n',

  // A lazy continuation carries no marker of its own, so it is written back under the
  // block that owns it.
  'blockquote with a lazy continuation': '> one\ntwo\n',
  'list item with a lazy continuation': '- one\nAfter.\n',
  'blockquote with no space after the marker': '>one\n>two\n',

  // A link is a mark, and a mark needs text to sit on. An empty label leaves nothing to
  // carry the destination, so the whole link is dropped rather than reshaped.
  'link with an empty destination': '[a]()\n',
  'link with an empty label': '[](/b)\n',
  'image title in single quotes': "![A diagram](/a.png 'Figure 1')\n",
  'image title in parentheses': '![A diagram](/a.png (Figure 1))\n',
  'image title holding an escaped quote': '![d](/a.png "He said \\"hi\\"")\n',
  'document mixing CRLF and LF': '# T\r\n\n- a\r\n',

  // The nesting survives now, but the empty first line does not: the item's own content
  // starts on line two and is written back on the marker's line.
  'empty item holding a nested list': '-\n  - inner\n',

  // Accepted trade: an autolink cannot carry emphasis, so this becomes the equivalent
  // `[**https://example.com**](https://example.com)`. It used to become `<**url**>`,
  // which is not a link at all.
  'bold over an autolink': '**<https://example.com>**\n',
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
  const sources = [
    '> [!NOTE]\n',
    '# T\n\n> [!NOTE]\n',
    '> [!TIP]\n> Body.\n',
    // One indent for a whole list wrote this code block one column further out on every
    // save, without limit. The indent now follows each item's own marker.
    '9. nine\n\n       code\n\n10. ten\n',
    // A tight fence inside an item used to turn the list loose, and it took three passes
    // to settle on the loose form.
    '1. Run this:\n   ```sh\n   ls\n   ```\n2. Next step\n',
  ];
  for (const source of sources) {
    it(`never grows: ${JSON.stringify(source)}`, () => {
      let current = source;
      for (let pass = 0; pass < 6; pass += 1) {
        current = roundtrip(current);
        expect(current).toBe(source);
      }
    });
  }
});
