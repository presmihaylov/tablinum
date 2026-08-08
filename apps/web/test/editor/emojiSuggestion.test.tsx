import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { findEmojiTrigger, matchEmoji } from '../../src/editor/ui/emoji';
import { toMarkdown } from './harness';
import { mountEditor, settle, typeText } from './mount';

afterEach(() => cleanup());

async function type(text: string): Promise<Editor> {
  const editor = await mountEditor();
  await settle(() => {
    editor.commands.setTextSelection(1);
    typeText(editor, text);
  });
  return editor;
}

function plainText(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', ' ');
}

describe('emoji suggestion', () => {
  it('offers emoji once a colon has a query behind it', async () => {
    await type(':fir');

    const option = await screen.findByRole('option', { name: /fire/ });
    expect(option.textContent).toContain('🔥');
  });

  it('inserts the character when an emoji is clicked', async () => {
    const editor = await type('ship it :roc');

    fireEvent.click(await screen.findByRole('option', { name: /rocket/ }));

    await waitFor(() => expect(toMarkdown(editor)).toBe('ship it 🚀\n'));
  });

  it('picks the highlighted emoji with the arrow keys and Enter', async () => {
    const editor = await type(':cha');

    await screen.findByRole('option', { name: /chart up/ });
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await waitFor(() => expect(toMarkdown(editor)).toBe('📉\n'));
  });

  it('still offers the emoji when the closing colon is typed', async () => {
    await type(':fire:');

    expect(await screen.findByRole('option', { name: /fire/ })).toBeTruthy();
  });

  it('offers emoji from the first letter', async () => {
    await type(':f');

    expect(await screen.findByRole('option', { name: /fire/ })).toBeTruthy();
  });

  it('shows nothing for a bare colon', async () => {
    await type('see :');

    expect(screen.queryByRole('option')).toBeNull();
  });

  it('shows nothing for a colon that names no emoji', async () => {
    await type(':qqq');

    expect(screen.queryByRole('option')).toBeNull();
  });

  it('leaves a time of day alone', async () => {
    await type('ship at 10:30');

    expect(screen.queryByRole('option')).toBeNull();
  });

  it('closes on Escape and inserts nothing', async () => {
    const editor = await type(':fir');

    await screen.findByRole('option', { name: /fire/ });
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(plainText(editor)).toBe(':fir');
  });
});

describe('emoji lookup', () => {
  it('finds the token the caret sits at the end of', () => {
    expect(findEmojiTrigger('ship it :roc')).toEqual({ from: 8, query: 'roc' });
  });

  it('finds a token that opens the text', () => {
    expect(findEmojiTrigger(':roc')).toEqual({ from: 0, query: 'roc' });
  });

  it('keeps a closing colon out of the query', () => {
    expect(findEmojiTrigger(':fire:')).toEqual({ from: 0, query: 'fire' });
  });

  it('ignores a colon that follows a word or a digit', () => {
    expect(findEmojiTrigger('note: this')).toBeNull();
    expect(findEmojiTrigger('10:30')).toBeNull();
    expect(findEmojiTrigger('https://')).toBeNull();
  });

  it('ignores a token the caret has already left', () => {
    expect(findEmojiTrigger(':fire ok')).toBeNull();
  });

  it('puts the best match first', () => {
    expect(matchEmoji('smil').map((entry) => entry.name)).toEqual([
      'smile',
      'slight smile',
      'sweat smile',
      'grinning',
    ]);
  });

  it('beats a name that only contains the query with one that is the query', () => {
    expect(matchEmoji('star')[0]?.name).toBe('star');
    expect(matchEmoji('chart')[0]?.name).toBe('chart up');
    expect(matchEmoji('bug')[0]?.name).toBe('bug');
  });

  it('answers from the first letter, but not from a bare colon', () => {
    expect(matchEmoji('f').map((entry) => entry.char)).toContain('🔥');
    expect(matchEmoji('')).toEqual([]);
  });

  // 'ar' matches 14 of the list and 're' matches 15.
  it('caps how many it offers', () => {
    expect(matchEmoji('ar')).toHaveLength(12);
    expect(matchEmoji('re')).toHaveLength(12);
  });
});
