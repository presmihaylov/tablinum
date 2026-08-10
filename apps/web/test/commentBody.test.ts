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
