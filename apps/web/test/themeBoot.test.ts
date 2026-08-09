import { beforeEach, describe, expect, it } from 'vitest';
import HTML from '../index.html?raw';
import SCRIPT from '../public/theme.js?raw';
import { writeStored } from '../src/lib/storage';

/** Run the boot script the way the browser does, against this test's document. */
function boot(): void {
  new Function(SCRIPT)();
}

describe('the pre-paint theme script', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('is a file, so the shell needs no inline script', () => {
    expect(HTML).toContain('<script src="/theme.js"></script>');
    expect(HTML).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });

  it('paints the theme the app stored', () => {
    writeStored('theme', 'dark');
    boot();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    writeStored('theme', 'light');
    boot();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('leaves the system palette alone when there is nothing to paint', () => {
    boot();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    writeStored('theme', 'system');
    boot();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    window.localStorage.setItem('tablinum.theme', 'not json');
    boot();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});
