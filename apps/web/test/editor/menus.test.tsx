import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { toMarkdown } from './harness';
import { hoverTable, mountEditor, settle } from './mount';

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

  it('keeps away from a node that is picked whole', async () => {
    const editor = await mountEditor({ content: '![[eng/rollout]]\n' });
    await settle(() => editor.commands.setNodeSelection(0));

    // An insert can leave the new node picked. A node holds no text to mark, and the bar would
    // then sit over the page and swallow the next click.
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(bar('Text formatting')).toBeNull();
  });

  it('keeps out of the way inside a code block', async () => {
    const editor = await mountEditor({ content: '```js\nlet a = 1;\n```\n' });
    await select(editor, 1, 5);

    expect(bar('Text formatting')).toBeNull();
  });
});

describe('table controls', () => {
  it('appear once the pointer is over the table', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);

    expect(screen.getByLabelText('Add a column')).toBeTruthy();
    expect(screen.getByLabelText('Add a row')).toBeTruthy();
    expect(screen.getByLabelText('Select column 1')).toBeTruthy();
    expect(screen.getByLabelText('Select row 2')).toBeTruthy();
  });

  it('stay away while the pointer is elsewhere', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });

    expect(screen.queryByLabelText('Add a column')).toBeNull();
  });

  it('adds a column at the right edge', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Add a column')));

    expect(toMarkdown(editor)).toBe(
      ['| a | b |  |', '| --- | --- | --- |', '| 1 | 2 |  |', ''].join('\n'),
    );
  });

  it('adds a row at the bottom edge', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Add a row')));

    expect(toMarkdown(editor)).toBe(
      ['| a | b |', '| --- | --- |', '| 1 | 2 |', '|  |  |', ''].join('\n'),
    );
  });
});

describe('table toolbar', () => {
  it('stays away while the caret only sits in a table', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await select(editor, 4, 4);

    expect(bar('Table')).toBeNull();
  });

  it('offers the row actions once a grip selects a row', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Select row 1')));

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Delete row' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete column' })).toBeNull();
  });

  it('adds a row below the selected row', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Select row 1')));

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Row below' }));

    await waitFor(() =>
      expect(toMarkdown(editor)).toBe(
        ['| a | b |', '| --- | --- |', '|  |  |', '| 1 | 2 |', ''].join('\n'),
      ),
    );
  });

  it('deletes the selected row whole', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Select row 2')));

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Delete row' }));

    await waitFor(() => expect(toMarkdown(editor)).toBe(['| a | b |', '| --- | --- |', ''].join('\n')));
  });

  it('offers the column actions once a grip selects a column', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Select column 1')));

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Delete column' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete row' })).toBeNull();
  });

  it('adds a column right of the selected column', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Select column 1')));

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Column right' }));

    await waitFor(() =>
      expect(toMarkdown(editor)).toBe(
        ['| a |  | b |', '| --- | --- | --- |', '| 1 |  | 2 |', ''].join('\n'),
      ),
    );
  });

  it('deletes the selected column whole', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Select column 2')));

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Delete column' }));

    await waitFor(() =>
      expect(toMarkdown(editor)).toBe(['| a |', '| --- |', '| 1 |', ''].join('\n')),
    );
  });

  it('deletes the whole table from the corner grip', async () => {
    const editor = await mountEditor({ content: `${TABLE}\n` });
    await hoverTable(editor);
    await settle(() => fireEvent.click(screen.getByLabelText('Select the table')));

    await waitFor(() => expect(bar('Table')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));

    await waitFor(() => expect(toMarkdown(editor)).toBe('\n'));
  });
});
