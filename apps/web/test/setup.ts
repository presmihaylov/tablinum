import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { installArrowRewrite } from '../src/lib/arrow';

// main.tsx puts this on the document before React starts, so every field a test renders has it
// too. jsdom ships no `execCommand`, so the fallback path is the one exercised here; the real
// one is proved in e2e/arrow.spec.ts.
installArrowRewrite();

// jsdom ships no matchMedia; the theme provider asks for it on mount.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}

// jsdom ships no ClipboardEvent, and `pasteHTML` makes one when it is given no event.
class FakeClipboardEvent extends Event {
  readonly clipboardData: DataTransfer | null = null;
}

if (typeof globalThis.ClipboardEvent !== 'function') {
  Object.defineProperty(globalThis, 'ClipboardEvent', {
    writable: true,
    value: FakeClipboardEvent,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
