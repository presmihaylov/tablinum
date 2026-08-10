import { describe, expect, it } from 'vitest';
import { renderCommentBody } from '../src/components/Comments/render';

/** What the browser really builds from a body, which is what the panel puts on the page. */
function asElement(body: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderCommentBody(body);
  return host;
}

describe('comment bodies', () => {
  it('renders the markdown a remark needs', () => {
    const html = renderCommentBody('**bold**, _italic_, `code`\n\n- one\n- two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('escapes raw HTML rather than build it', () => {
    const source = '<img src=x onerror="alert(1)"> and <script>alert(2)</script>';
    const host = asElement(source);

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(renderCommentBody(source)).toContain('&lt;img');
  });

  it('refuses a script destination in a link', () => {
    for (const body of ['[click](javascript:alert(1))', '[click](vbscript:msgbox)', '[x](data:text/html,x)']) {
      const host = asElement(body);
      expect(host.querySelector('a')).toBeNull();
      expect(renderCommentBody(body)).not.toContain('href=');
    }
  });

  it('sends a real link outward and never hands it this tab', () => {
    const html = renderCommentBody('[docs](https://example.com/handbook)');
    expect(html).toContain('href="https://example.com/handbook"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('escapes an autolinked address that carries markup', () => {
    const host = asElement('see https://example.com/"><script>alert(1)</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });
});

describe('mentions in a comment', () => {
  it('draws a handle as a chip', () => {
    const host = asElement('nice one @ada.lovelace');

    const chip = host.querySelector('.comment__mention');
    expect(chip?.textContent).toBe('@ada.lovelace');
    expect(chip?.classList.contains('comment__mention--me')).toBe(false);
  });

  it('marks a mention of the reader apart from the rest', () => {
    const host = document.createElement('div');
    host.innerHTML = renderCommentBody('@ada.lovelace and @sam.rivers', 'ada.lovelace');

    const chips = [...host.querySelectorAll('.comment__mention')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['@ada.lovelace', '@sam.rivers']);
    expect(chips[0]?.classList.contains('comment__mention--me')).toBe(true);
    expect(chips[1]?.classList.contains('comment__mention--me')).toBe(false);
  });

  // The rule the pages use, so one body reads the same in both places.
  it('leaves an address and a handle in code alone', () => {
    expect(asElement('write to mail@example.com').querySelector('.comment__mention')).toBeNull();
    expect(asElement('run `deploy @ada.lovelace`').querySelector('.comment__mention')).toBeNull();
  });

  it('reads a handle in brackets and one that opens the body', () => {
    expect(asElement('(@ada.lovelace)').querySelector('.comment__mention')?.textContent).toBe(
      '@ada.lovelace',
    );
    expect(asElement('@sam.rivers has it').querySelector('.comment__mention')?.textContent).toBe(
      '@sam.rivers',
    );
  });

  it('builds no markup out of a handle', () => {
    const html = renderCommentBody('@ada.lovelace');
    expect(html).toContain('<span class="comment__mention">@ada.lovelace</span>');
  });
});
