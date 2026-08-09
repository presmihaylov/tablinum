import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { CustomEmoji } from '@tablinum/shared';
import { setCustomEmoji } from '../../src/lib/customEmoji';
import { EmojiPicker } from '../../src/editor/ui/EmojiPicker';
import { matchEmoji } from '../../src/editor/ui/emoji';
import { createTestEditor, roundtrip, toMarkdown } from './harness';
import { mountEditor, settle, typeText } from './mount';

const PARROT: CustomEmoji = {
  id: 'ce_01J8XYZABCDEFGHJKMNPQRSTV',
  shortcode: 'parrot',
  mime: 'image/gif',
  userId: 'us_01J8XYZABCDEFGHJKMNPQRSTV',
  created: '2026-08-08T10:00:00.000Z',
};

beforeEach(() => setCustomEmoji([PARROT]));

afterEach(() => {
  cleanup();
  setCustomEmoji([]);
});

async function type(text: string): Promise<Editor> {
  const editor = await mountEditor();
  await settle(() => {
    editor.commands.setTextSelection(1);
    typeText(editor, text);
  });
  return editor;
}

describe('custom emoji in the document', () => {
  it('renders an uploaded shortcode as an image', () => {
    const editor = createTestEditor('hello :parrot:');
    try {
      const html = editor.getHTML();
      expect(html).toContain('src="/api/v1/emoji/parrot/image"');
      expect(html).toContain('alt=":parrot:"');
    } finally {
      editor.destroy();
    }
  });

  it('keeps the shortcode text in the file', () => {
    expect(roundtrip('hello :parrot: there\n')).toBe('hello :parrot: there\n');
  });

  it('writes no html into the markdown', () => {
    expect(roundtrip(':parrot:\n')).not.toContain('<');
  });

  it('leaves a name nobody uploaded as plain text', () => {
    const editor = createTestEditor('ship :nope: now');
    try {
      expect(editor.getHTML()).not.toContain('data-gd-emoji');
      expect(toMarkdown(editor)).toBe('ship :nope: now\n');
    } finally {
      editor.destroy();
    }
  });

  it('leaves a time of day alone', () => {
    expect(roundtrip('ship at 10:30:45\n')).toBe('ship at 10:30:45\n');
  });
});

describe('custom emoji in the suggestion menu', () => {
  it('offers an uploaded emoji before the unicode ones', () => {
    expect(matchEmoji('par')[0]?.name).toBe('parrot');
  });

  it('inserts the node when the uploaded emoji is clicked', async () => {
    const editor = await type('ship it :parr');

    fireEvent.click(await screen.findByRole('option', { name: /parrot/ }));

    await waitFor(() => expect(toMarkdown(editor)).toBe('ship it :parrot:\n'));
  });

  it('turns the typed shortcode into the node once the closing colon lands', async () => {
    const editor = await type('yes :parrot:');

    await waitFor(() => expect(toMarkdown(editor)).toBe('yes :parrot:\n'));
    expect(editor.getHTML()).toContain('src="/api/v1/emoji/parrot/image"');
  });
});

describe('custom emoji in the picker', () => {
  it('shows the uploaded ones in their own section', () => {
    render(<EmojiPicker anchor={{ left: 10, top: 10 }} onPick={() => undefined} onClose={() => undefined} />);

    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'parrot' })).toBeTruthy();
  });

  it('gives the shortcode token back when one is chosen', () => {
    const picked: string[] = [];
    render(
      <EmojiPicker
        anchor={{ left: 10, top: 10 }}
        onPick={(value) => picked.push(value)}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'parrot' }));

    expect(picked).toEqual([':parrot:']);
  });

  it('has no custom section when nothing is uploaded', () => {
    setCustomEmoji([]);
    render(<EmojiPicker anchor={{ left: 10, top: 10 }} onPick={() => undefined} onClose={() => undefined} />);

    expect(screen.queryByText('Custom')).toBeNull();
  });
});
