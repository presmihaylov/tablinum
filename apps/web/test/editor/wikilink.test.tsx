import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { WikilinkItem } from '../../src/editor/extensions';
import { createTestEditor, roundtrip, toMarkdown } from './harness';
import { mountEditor, settle, typeText } from './mount';

const PAGES: WikilinkItem[] = [
  { id: 'pg_setup', path: 'guides/setup', title: 'Setup guide', icon: '🧭' },
  { id: 'pg_deploy', path: 'guides/deploy', title: 'Deploy guide' },
];

let headless: Editor | null = null;

afterEach(() => {
  headless?.destroy();
  headless = null;
  cleanup();
});

async function openPicker(
  search: (query: string) => Promise<WikilinkItem[]>,
  text: string,
): Promise<Editor> {
  const editor = await mountEditor({ searchPages: search });
  await settle(() => {
    editor.commands.setTextSelection(1);
    typeText(editor, text);
  });
  return editor;
}

function plainText(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' ');
}

describe('wikilink picker', () => {
  it('inserts [[path|Title]] when a page is clicked', async () => {
    const editor = await openPicker(async () => PAGES, '[[gui');

    const option = await screen.findByRole('option', { name: /Setup guide/ });
    fireEvent.click(option);

    await waitFor(() => expect(toMarkdown(editor)).toBe('[[guides/setup|Setup guide]]\n'));
  });

  it('sends the typed query to the search hook', async () => {
    const search = vi.fn((query: string) => Promise.resolve(query ? PAGES : []));
    await openPicker(search, '[[deploy');

    await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(0));
    expect(search.mock.calls.at(-1)?.[0]).toBe('deploy');
  });

  it('shows every page the search returns', async () => {
    await openPicker(async () => PAGES, '[[gui');

    const options = await screen.findAllByRole('option');
    expect(options.map((item) => item.querySelector('.gd-editor-menu__title')?.textContent)).toEqual(
      ['Setup guide', 'Deploy guide'],
    );
  });

  it('draws the icon of a page, and the blank page for one without', async () => {
    await openPicker(async () => PAGES, '[[gui');

    const options = await screen.findAllByRole('option');
    expect(options[0]?.querySelector('.menu__page-icon')?.textContent).toBe('🧭');
    expect(options[1]?.querySelector('.menu__page-icon svg')).toBeTruthy();
  });

  it('picks the highlighted page with the arrow keys and Enter', async () => {
    const editor = await openPicker(async () => PAGES, '[[gui');

    await screen.findByRole('option', { name: /Setup guide/ });
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await waitFor(() => expect(toMarkdown(editor)).toBe('[[guides/deploy|Deploy guide]]\n'));
  });

  it('replaces the query text and keeps the words around it', async () => {
    const editor = await openPicker(async () => PAGES, 'see [[gui');

    const option = await screen.findByRole('option', { name: /Setup guide/ });
    fireEvent.click(option);

    await waitFor(() => expect(toMarkdown(editor)).toBe('see [[guides/setup|Setup guide]]\n'));
    expect(plainText(editor)).not.toContain('[[gui');
  });

  it('says so when the search finds no page', async () => {
    await openPicker(async () => [], '[[zzz');

    expect(await screen.findByText('No page found')).toBeTruthy();
  });

  it('closes on Escape and inserts nothing', async () => {
    const editor = await openPicker(async () => PAGES, '[[gui');

    await screen.findByRole('option', { name: /Setup guide/ });
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(plainText(editor)).toBe('[[gui');
  });
});

describe('wikilink command and markdown', () => {
  it('writes the target and the alias', () => {
    headless = createTestEditor('');
    headless.commands.insertWikilink({ target: 'guides/setup', alias: 'Setup guide' });
    expect(toMarkdown(headless)).toBe('[[guides/setup|Setup guide]]\n');
  });

  it('writes a bare target when there is no alias', () => {
    headless = createTestEditor('');
    headless.commands.insertWikilink({ target: 'guides/setup' });
    expect(toMarkdown(headless)).toBe('[[guides/setup]]\n');
  });

  it('links to the page route in the rendered HTML', () => {
    headless = createTestEditor('[[guides/setup|Setup guide]]');
    const html = headless.getHTML();
    expect(html).toContain('href="/p/guides/setup"');
    expect(html).toContain('Setup guide');
  });

  it('round-trips both wikilink shapes byte for byte', () => {
    const source = 'See [[guides/setup|Setup guide]] and [[api/index]].\n';
    expect(roundtrip(source)).toBe(source);
  });
});
