import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { MentionItem } from '../../src/editor/extensions';
import { createTestEditor, roundtrip, toMarkdown } from './harness';
import { mountEditor, settle, typeText } from './mount';

const PEOPLE: MentionItem[] = [
  { id: 'us_1', handle: 'ada.lovelace', name: 'Ada Lovelace', color: '#123456', avatarRev: null },
  { id: 'us_2', handle: 'sam.rivers', name: 'Sam Rivers', color: '#654321', avatarRev: null },
];

let headless: Editor | null = null;

afterEach(() => {
  headless?.destroy();
  headless = null;
  cleanup();
});

async function openMenu(
  search: (query: string) => Promise<MentionItem[]>,
  text: string,
): Promise<Editor> {
  const editor = await mountEditor({ searchPeople: search });
  await settle(() => {
    editor.commands.setTextSelection(1);
    typeText(editor, text);
  });
  return editor;
}

function plainText(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' ');
}

describe('mention menu', () => {
  it('inserts @handle when a person is clicked', async () => {
    const editor = await openMenu(async () => PEOPLE, '@ada');

    const option = await screen.findByRole('option', { name: /Ada Lovelace/ });
    fireEvent.click(option);

    await waitFor(() => expect(toMarkdown(editor)).toBe('@ada.lovelace\n'));
  });

  it('sends the typed query to the search hook', async () => {
    const search = vi.fn((query: string) => Promise.resolve(query ? PEOPLE : []));
    await openMenu(search, '@sam');

    await waitFor(() => expect(search.mock.calls.length).toBeGreaterThan(0));
    expect(search.mock.calls.at(-1)?.[0]).toBe('sam');
  });

  it('shows the name and the handle of everybody the search returns', async () => {
    await openMenu(async () => PEOPLE, '@a');

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain('Ada Lovelace');
    expect(options[0]?.textContent).toContain('@ada.lovelace');
    expect(options[1]?.textContent).toContain('Sam Rivers');
  });

  it('picks the highlighted person with the arrow keys and Enter', async () => {
    const editor = await openMenu(async () => PEOPLE, '@a');

    await screen.findByRole('option', { name: /Ada Lovelace/ });
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await waitFor(() => expect(toMarkdown(editor)).toBe('@sam.rivers\n'));
  });

  it('keeps the words around the mention', async () => {
    const editor = await openMenu(async () => PEOPLE, 'ask @ada');

    const option = await screen.findByRole('option', { name: /Ada Lovelace/ });
    fireEvent.click(option);

    await waitFor(() => expect(toMarkdown(editor)).toBe('ask @ada.lovelace\n'));
  });

  it('keeps typing after the mention, without eating a character', async () => {
    const editor = await openMenu(async () => PEOPLE, '@ada');

    const option = await screen.findByRole('option', { name: /Ada Lovelace/ });
    await settle(() => fireEvent.click(option));
    await settle(() => typeText(editor, ' please review'));

    await waitFor(() => expect(toMarkdown(editor)).toBe('@ada.lovelace please review\n'));
  });

  it('says so when nobody matches', async () => {
    await openMenu(async () => [], '@zzz');

    expect(await screen.findByText('Nobody found')).toBeTruthy();
  });

  it('closes on Escape and inserts nothing', async () => {
    const editor = await openMenu(async () => PEOPLE, '@ada');

    await screen.findByRole('option', { name: /Ada Lovelace/ });
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(plainText(editor)).toBe('@ada');
  });

  it('opens no menu inside an email address', async () => {
    await openMenu(async () => PEOPLE, 'ada@ex');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole('option')).toBeNull();
  });
});

describe('mention command and markdown', () => {
  it('writes the handle', () => {
    headless = createTestEditor('');
    headless.commands.insertMention({ handle: 'ada.lovelace' });
    expect(toMarkdown(headless)).toBe('@ada.lovelace\n');
  });

  it('marks the mention in the rendered HTML', () => {
    headless = createTestEditor('Ask @ada.lovelace about it.');
    const html = headless.getHTML();
    expect(html).toContain('gd-editor-mention');
    expect(html).toContain('@ada.lovelace');
  });

  it('leaves an email address as plain text', () => {
    headless = createTestEditor('Write to ada@example.com.');
    expect(headless.getHTML()).not.toContain('gd-editor-mention');
  });

  it('round-trips a mention byte for byte', () => {
    const source = 'Ask @ada.lovelace, then @sam.\n';
    expect(roundtrip(source)).toBe(source);
  });
});
