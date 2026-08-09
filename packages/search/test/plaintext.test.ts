import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToPlainText } from '../src/plaintext.js';

describe('markdownToPlainText', () => {
  it('returns an empty string for empty input', () => {
    expect(markdownToPlainText('')).toBe('');
    expect(markdownToPlainText('   \n\n  ')).toBe('');
  });

  it('strips YAML frontmatter only when asked', () => {
    const md = ['---', 'id: pg_1', 'title: Deploy', '---', '', 'Body text.'].join(
      '\n',
    );
    expect(markdownToPlainText(md, { stripFrontmatter: true })).toBe('Body text.');
  });

  it('keeps the first section of a body that opens with a thematic break', () => {
    const md = ['---', '', 'Lead paragraph.', '', '---', '', 'Second section.'].join('\n');
    expect(markdownToPlainText(md)).toBe('Lead paragraph.\n\nSecond section.');
  });

  it('keeps a horizontal rule that is not frontmatter', () => {
    expect(markdownToPlainText('Intro\n\n---\n\nOutro')).toBe('Intro\n\nOutro');
  });

  it('strips fenced code blocks', () => {
    const md = ['Before.', '```ts', 'const secret = 1;', '```', 'After.'].join('\n');
    const text = markdownToPlainText(md);
    expect(text).toContain('Before.');
    expect(text).toContain('After.');
    expect(text).not.toContain('secret');
  });

  it('strips tilde fences and unterminated fences', () => {
    expect(markdownToPlainText('Before.\n~~~\ncode here\n~~~\nAfter.')).toBe('Before.\nAfter.');
    expect(markdownToPlainText('Before.\n```\ncode here')).toBe('Before.');
  });

  it('keeps a shorter fence marker inside a longer fence', () => {
    const md = ['````', '```', 'nested', '```', '````', 'After.'].join('\n');
    expect(markdownToPlainText(md)).toBe('After.');
  });

  it('keeps the text of inline code', () => {
    expect(markdownToPlainText('Run `pnpm build` now.')).toBe('Run pnpm build now.');
  });

  it('strips HTML tags but keeps their text', () => {
    expect(markdownToPlainText('A <em>bold</em> claim.')).toBe('A bold claim.');
    expect(markdownToPlainText('One<br>two')).toBe('One two');
  });

  it('drops HTML comments, script and style blocks', () => {
    expect(markdownToPlainText('A <!-- hidden note --> B')).toBe('A B');
    expect(markdownToPlainText('A <script>alert(1)</script> B')).toBe('A B');
    expect(markdownToPlainText('A <style>p{color:red}</style> B')).toBe('A B');
  });

  it('keeps link text and drops the URL', () => {
    expect(markdownToPlainText('See [the runbook](https://example.com/x) now.')).toBe(
      'See the runbook now.',
    );
    expect(markdownToPlainText('See [the runbook](https://example.com "Title") now.')).toBe(
      'See the runbook now.',
    );
    expect(markdownToPlainText('See [the runbook][ref] now.')).toBe('See the runbook now.');
  });

  it('keeps link text that holds nested brackets', () => {
    expect(markdownToPlainText('See [the [beta] runbook](https://example.com/x) now.')).toBe(
      'See the [beta] runbook now.',
    );
  });

  it('drops a destination that holds balanced parentheses', () => {
    expect(markdownToPlainText('See [the runbook](https://example.com/a_(b)/c) now.')).toBe(
      'See the runbook now.',
    );
  });

  it('drops link reference definitions', () => {
    expect(markdownToPlainText('Text.\n\n[ref]: https://example.com/x')).toBe('Text.');
  });

  it('keeps image alt text', () => {
    expect(markdownToPlainText('![a diagram](/_assets/pg_1/x.png)')).toBe('a diagram');
    expect(markdownToPlainText('![a [beta] diagram](/_assets/pg_1/x.png)')).toBe(
      'a [beta] diagram',
    );
  });

  it('keeps the alt text of an image used as link text', () => {
    expect(markdownToPlainText('[![a diagram](/_assets/pg_1/x.png)](https://example.com)')).toBe(
      'a diagram',
    );
  });

  it('resolves wikilinks to their visible text', () => {
    expect(markdownToPlainText('See [[eng/deploy]].')).toBe('See eng/deploy.');
    expect(markdownToPlainText('See [[eng/deploy|the runbook]].')).toBe('See the runbook.');
  });

  it('unwraps autolinks', () => {
    expect(markdownToPlainText('Visit <https://example.com/docs> today.')).toBe(
      'Visit https://example.com/docs today.',
    );
  });

  it('strips heading markers', () => {
    expect(markdownToPlainText('# Title\n\n## Sub ##\n\nBody')).toBe('Title\n\nSub\n\nBody');
  });

  it('strips blockquote and list markers', () => {
    expect(markdownToPlainText('> quoted line')).toBe('quoted line');
    expect(markdownToPlainText('- one\n- two\n1. three')).toBe('one\ntwo\nthree');
    expect(markdownToPlainText('- [ ] todo\n- [x] done')).toBe('todo\ndone');
  });

  it('flattens tables', () => {
    const md = ['| Name | Owner |', '| --- | --- |', '| Deploy | ops |'].join('\n');
    const text = markdownToPlainText(md);
    expect(text).not.toContain('|');
    expect(text).not.toContain('---');
    expect(text).toContain('Deploy');
    expect(text).toContain('ops');
  });

  it('strips emphasis markers', () => {
    expect(markdownToPlainText('A **bold** and *italic* and ~~struck~~ word.')).toBe(
      'A bold and italic and struck word.',
    );
    expect(markdownToPlainText('An __underlined__ and _slanted_ word.')).toBe(
      'An underlined and slanted word.',
    );
  });

  it('leaves snake_case identifiers intact', () => {
    expect(markdownToPlainText('The value of some_config_key matters.')).toBe(
      'The value of some_config_key matters.',
    );
  });

  it('resolves backslash escapes', () => {
    expect(markdownToPlainText('A literal \\* star and a \\_ score.')).toBe(
      'A literal * star and a _ score.',
    );
  });

  it('drops footnote references', () => {
    expect(markdownToPlainText('A claim[^1] stands.')).toBe('A claim stands.');
  });

  it('keeps the prose of a footnote definition', () => {
    expect(markdownToPlainText('A claim[^1] stands.\n\n[^1]: The supporting note.')).toBe(
      'A claim stands.\n\nThe supporting note.',
    );
  });

  it('keeps an escaped pipe as a literal pipe', () => {
    const md = ['| Name | Rule |', '| --- | --- |', '| Deploy | a \\| b |'].join('\n');
    expect(markdownToPlainText(md)).toBe('Name Rule\nDeploy a | b');
  });

  it('removes control characters, including the snippet delimiters', () => {
    const md = 'before\u0001middle\u0002after';
    const text = markdownToPlainText(md);
    expect(text).not.toContain('\u0001');
    expect(text).not.toContain('\u0002');
    expect(text).toBe('before middle after');
  });

  it('collapses runs of blank lines and spaces', () => {
    expect(markdownToPlainText('a\n\n\n\n\nb   c\t\td')).toBe('a\n\nb c d');
  });

  it('normalizes CRLF line endings', () => {
    expect(markdownToPlainText('# Title\r\n\r\nBody\r\n')).toBe('Title\n\nBody');
  });

  it('handles a realistic page end to end', () => {
    const md = [
      '---',
      'id: pg_01J8',
      'title: Deploy runbook',
      '---',
      '',
      '# Deploy runbook',
      '',
      'Ship with `make deploy`. See [the checklist](https://example.com/c) and [[eng/rollback]].',
      '',
      '```bash',
      'kubectl apply -f manifest.yaml',
      '```',
      '',
      '- [x] Freeze the branch',
      '- [ ] Announce in <b>#eng</b>',
    ].join('\n');

    const text = markdownToPlainText(md, { stripFrontmatter: true });
    expect(text).toBe(
      [
        'Deploy runbook',
        '',
        'Ship with make deploy. See the checklist and eng/rollback.',
        '',
        'Freeze the branch',
        'Announce in #eng',
      ].join('\n'),
    );
    expect(text).not.toContain('kubectl');
  });
});

// These inputs take 3 ms and 135 ms here, and about 500 ms under a loaded runner. The
// quadratic patterns they replace took 49 s and 16 s on the same bytes, so a budget in
// seconds leaves room for a slow machine and still fails loudly on a regression. The long
// per-test timeout keeps that failure an assertion with a number in it.
const SLOW_TEST_MS = 60_000;

describe('bounded work', () => {
  it(
    'reads a long run of backticks in linear time',
    () => {
      const backticks = `a${'`'.repeat(2_000_000)}`;
      const start = performance.now();
      markdownToPlainText(backticks);
      expect(performance.now() - start).toBeLessThan(2000);
    },
    SLOW_TEST_MS,
  );

  it(
    'reads a long run of emphasis markers in linear time',
    () => {
      const emphasis = ' _a'.repeat(200_000);
      const start = performance.now();
      markdownToPlainText(emphasis);
      expect(performance.now() - start).toBeLessThan(4000);
    },
    SLOW_TEST_MS,
  );

  it('truncates a body past the index budget', () => {
    expect(markdownToPlainText('x'.repeat(300 * 1024)).length).toBeLessThanOrEqual(256 * 1024);
  });

  it('keeps the start of a body it truncates', () => {
    const text = markdownToPlainText(`Intro.\n\n${'x'.repeat(300 * 1024)}`);
    expect(text.startsWith('Intro.')).toBe(true);
  });
});

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });
});
