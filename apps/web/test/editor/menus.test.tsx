import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { toMarkdown } from './harness';
import { mountEditor, settle } from './mount';

const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');

afterEach(cleanup);

function bar(label: string): HTMLElement | null {
  return screen.queryByRole('toolbar', { name: label });
}

async function select(editor: Editor, from: number, to: number): Promise<void> {
  await settle(() => editor.commands.setTextSelection({ from, to }));
}

describe('selection toolbar', () => {
  it('stays hidden while nothing is selected', async () => {
    const editor = await mountEditor({ content: 'Hello there\n' });
    await select(editor, 3, 3);

    expect(bar('Text formatting')).toBeNull();
  });

  it('appears over a text selection', async () => {
    const editor = await mountEditor({ content: 'Hello there\n' });
    await select(editor, 1, 6);

    await waitFor(() => expect(bar('Text formatting')).not.toBeNull());
    expect(screen.getByRole('button', { name: /Bold/ })).toBeTruthy();
  });

  it('applies a mark to the selected words', async () => {
    const editor = await mountEditor({ content: 'Hello there\n' });
    await select(editor, 1, 6);

    await waitFor(() => expect(bar('Text formatting')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Bold/ }));

    await waitFor(() => expect(toMarkdown(editor)).toBe('**Hello** there\n'));
  });

  it('turns a selection into a link', async () => {
    const editor = await mountEditor({ content: 'Hello there\n' });
    await select(editor, 1, 6);

    await waitFor(() => expect(bar('Text formatting')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('Link'));
    fireEvent.change(screen.getByLabelText('Link address'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.keyDown(screen.getByLabelText('Link address'), { key: 'Enter' });

    await waitFor(() => expect(toMarkdown(editor)).toBe('[Hello](https://example.com) there\n'));
  });

  it('keeps out of the way inside a code block', async () => {
    const editor = await mountEditor({ content: '```js\nlet a = 1;\n```\n' });
    await select(editor, 1, 5);

    expect(bar('Text formatting')).toBeNull();
  });
});

describe('table toolbar', () => {
  it('appears while the caret sits in a table', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await select(editor, 4, 4);

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    expect(bar('Text formatting')).toBeNull();
  });

  it('adds a row below the caret', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await select(editor, 4, 4);

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Row below' }));

    await waitFor(() =>
      expect(toMarkdown(editor)).toBe(
        ['| a | b |', '| --- | --- |', '|  |  |', '| 1 | 2 |', ''].join('\n'),
      ),
    );
  });

  it('adds a column to the right of the caret', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await select(editor, 4, 4);

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Column right' }));

    await waitFor(() =>
      expect(toMarkdown(editor)).toBe(
        ['| a |  | b |', '| --- | --- | --- |', '| 1 |  | 2 |', ''].join('\n'),
      ),
    );
  });

  it('deletes the whole table', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await select(editor, 4, 4);

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));

    await waitFor(() => expect(toMarkdown(editor)).toBe('\n'));
  });
});
