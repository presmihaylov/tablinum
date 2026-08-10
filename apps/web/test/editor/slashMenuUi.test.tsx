import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { SLASH_COMMANDS } from '../../src/editor/extensions';
import { toMarkdown } from './harness';
import { mountEditor, settle, typeText } from './mount';

afterEach(cleanup);

async function openMenu(text: string): Promise<Editor> {
  const editor = await mountEditor();
  await settle(() => {
    editor.commands.setTextSelection(1);
    typeText(editor, text);
  });
  return editor;
}

function titles(): string[] {
  return screen
    .queryAllByRole('option')
    .map((item) => item.querySelector('.gd-editor-menu__title')?.textContent ?? '');
}

describe('slash menu', () => {
  it('opens on "/" with every block', async () => {
    await openMenu('/');

    await waitFor(() => expect(titles().length).toBe(SLASH_COMMANDS.length));
    expect(titles()).toContain('Heading 1');
    expect(titles()).toContain('Quote');
  });

  it('narrows the list as the query grows', async () => {
    await openMenu('/quo');

    await waitFor(() => expect(titles()).toEqual(['Quote']));
  });

  it('runs the highlighted block on Enter', async () => {
    const editor = await openMenu('/quo');

    await waitFor(() => expect(titles()).toEqual(['Quote']));
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await settle(() => typeText(editor, 'Words worth keeping'));
    expect(toMarkdown(editor)).toBe('> Words worth keeping\n');
  });

  it('runs the block that is clicked', async () => {
    const editor = await openMenu('/head');

    await waitFor(() => expect(titles()).toEqual(['Heading 1', 'Heading 2', 'Heading 3']));
    fireEvent.click(screen.getAllByRole('option')[2] as HTMLElement);

    await settle(() => typeText(editor, 'Small'));
    expect(toMarkdown(editor)).toBe('### Small\n');
  });

  it('walks the list with the arrow keys', async () => {
    const editor = await openMenu('/list');

    await waitFor(() => expect(titles()).toEqual(['Bulleted list', 'Numbered list', 'To-do list']));
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await settle(() => typeText(editor, 'First'));
    expect(toMarkdown(editor)).toBe('1. First\n');
  });

  it('says so when nothing matches', async () => {
    await openMenu('/zzzz');

    expect(await screen.findByText('No matching blocks')).toBeTruthy();
  });

  it('closes on Escape and leaves the text alone', async () => {
    const editor = await openMenu('/quo');

    await waitFor(() => expect(titles()).toEqual(['Quote']));
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(toMarkdown(editor)).toBe('/quo\n');
  });

  it('hands the image command to the shell', async () => {
    const onPickImage = vi.fn();
    const editor = await mountEditor({ onPickImage });
    await settle(() => {
      editor.commands.setTextSelection(1);
      typeText(editor, '/image');
    });

    await waitFor(() => expect(titles()).toEqual(['Image']));
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await waitFor(() => expect(onPickImage).toHaveBeenCalledTimes(1));
    expect(toMarkdown(editor)).toBe('\n');
  });

  it('hands the video command to the shell', async () => {
    const onPickVideo = vi.fn();
    const editor = await mountEditor({ onPickVideo });
    await settle(() => {
      editor.commands.setTextSelection(1);
      typeText(editor, '/video');
    });

    await waitFor(() => expect(titles()).toEqual(['Video']));
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await waitFor(() => expect(onPickVideo).toHaveBeenCalledTimes(1));
    expect(toMarkdown(editor)).toBe('\n');
  });

  it('hands the page command to the shell', async () => {
    const onPickPage = vi.fn();
    const editor = await mountEditor({ onPickPage });
    await settle(() => {
      editor.commands.setTextSelection(1);
      typeText(editor, '/page');
    });

    await waitFor(() => expect(titles()).toEqual(['Page', 'Database - Page']));
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await waitFor(() => expect(onPickPage).toHaveBeenCalledTimes(1));
    expect(toMarkdown(editor)).toBe('\n');
  });

  it('hands the emoji command to the shell', async () => {
    const onPickEmoji = vi.fn();
    const editor = await mountEditor({ onPickEmoji });
    await settle(() => {
      editor.commands.setTextSelection(1);
      typeText(editor, '/emoji');
    });

    await waitFor(() => expect(titles()).toEqual(['Emoji']));
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });

    await waitFor(() => expect(onPickEmoji).toHaveBeenCalledTimes(1));
  });
});
