import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { toMarkdown } from './harness';
import { mountEditor, settle } from './mount';

/** The menu the grip on the left opens: comment on the block, or delete it. */

afterEach(cleanup);

/** Moves the pointer onto a block, which is what brings the handles up. */
async function hover(editor: Editor, text: string): Promise<void> {
  const block = [...editor.view.dom.children].find((child) => child.textContent === text);
  if (!block) throw new Error(`no block reads "${text}"`);
  await settle(() => fireEvent.mouseMove(block));
}

async function openMenu(editor: Editor, text: string): Promise<void> {
  await hover(editor, text);
  await settle(() => fireEvent.click(screen.getByRole('button', { name: 'Block actions' })));
}

function menu(): HTMLElement | null {
  return screen.queryByRole('menu', { name: 'Block actions' });
}

describe('block handle menu', () => {
  it('stays shut until the grip is clicked', async () => {
    const editor = await mountEditor({ content: 'one\n\ntwo\n' });
    await hover(editor, 'one');

    expect(screen.getByRole('button', { name: 'Block actions' })).toBeTruthy();
    expect(menu()).toBeNull();
  });

  it('deletes the block it was opened on', async () => {
    const editor = await mountEditor({ content: 'one\n\ntwo\n' });
    await openMenu(editor, 'one');

    await settle(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })));

    expect(toMarkdown(editor)).toBe('two\n');
    expect(menu()).toBeNull();
  });

  it('selects the whole block before it asks for a comment', async () => {
    const onComment = vi.fn();
    const editor = await mountEditor({ content: 'one\n\ntwo\n', onComment });
    await openMenu(editor, 'two');

    await settle(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Comment' })));

    expect(onComment).toHaveBeenCalledTimes(1);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('two');
    // The block is untouched: a comment never writes anything into the document.
    expect(toMarkdown(editor)).toBe('one\n\ntwo\n');
  });

  it('offers no comment when the page holds none', async () => {
    const editor = await mountEditor({ content: 'one\n' });
    await openMenu(editor, 'one');

    expect(screen.queryByRole('menuitem', { name: 'Comment' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('shuts on a click somewhere else, and on Escape', async () => {
    const editor = await mountEditor({ content: 'one\n\ntwo\n' });

    await openMenu(editor, 'one');
    await settle(() => fireEvent.mouseDown(document.body));
    expect(menu()).toBeNull();

    await openMenu(editor, 'one');
    await settle(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(menu()).toBeNull();
  });

  it('shuts again on a second click of the grip', async () => {
    const editor = await mountEditor({ content: 'one\n' });
    await openMenu(editor, 'one');

    // A real click starts with a mousedown, which is what the dismiss listener watches.
    const grip = screen.getByRole('button', { name: 'Block actions' });
    await settle(() => {
      fireEvent.mouseDown(grip);
      fireEvent.click(grip);
    });

    expect(menu()).toBeNull();
  });

  it('keeps naming the same block while the menu is open', async () => {
    const editor = await mountEditor({ content: 'one\n\ntwo\n' });
    await openMenu(editor, 'one');

    // The pointer moves to the other paragraph, which used to move the handles with it.
    await hover(editor, 'two');
    await settle(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })));

    expect(toMarkdown(editor)).toBe('two\n');
  });
});
