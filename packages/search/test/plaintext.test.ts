import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToPlainText } from '../src/plaintext.js';

describe('markdownToPlainText', () => {
  it('returns an empty string for empty input', () => {
    expect(markdownToPlainText('')).toBe('');
    expect(markdownToPlainText('   \n\n  ')).toBe('');
  });

  it('strips YAML frontmatter', () => {
    const md = ['---', 'id: pg_1', 'title: Deploy', 'tags: [ops]', '---', '', 'Body text.'].join(
      '\n',
    );
    expect(markdownToPlainText(md)).toBe('Body text.');
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

  it('drops link reference definitions', () => {
    expect(markdownToPlainText('Text.\n\n[ref]: https://example.com/x')).toBe('Text.');
  });

  it('keeps image alt text', () => {
    expect(markdownToPlainText('![a diagram](/_assets/pg_1/x.png)')).toBe('a diagram');
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

    const text = markdownToPlainText(md);
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

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });
});
