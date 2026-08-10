import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { BAND_CLASS, BlockSelection } from '../../src/editor/extensions';
import { serializeFragment } from '../../src/editor/markdown';
import { mountEditor, settle } from './mount';

/**
 * The box the pointer paints beside the document, and what the grip does once a run of blocks
 * stands marked. jsdom does no layout, so the position lookup finds nothing; the box is drawn
 * before that lookup on purpose, which is what these tests hold in place.
 */

afterEach(() => {
  cleanup();
  document.querySelector(`.${BAND_CLASS}`)?.remove();
});

function band(): HTMLElement | null {
  return document.querySelector(`.${BAND_CLASS}`);
}

/** The position each top-level block starts at, in order. */
function blockStarts(editor: Editor): number[] {
  const found: number[] = [];
  let at = 0;
  editor.state.doc.forEach((child) => {
    found.push(at);
    at += child.nodeSize;
  });
  return found;
}

/** Mark a run of whole blocks, exactly as a finished drag beside them would. */
function markRun(editor: Editor, first: number, last: number): void {
  const starts = blockStarts(editor);
  const from = starts[first];
  const to = starts[last];
  if (from === undefined || to === undefined) throw new Error('no such block');
  const selection = BlockSelection.between(editor.state.doc, from + 1, to + 1);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

/** Moves the pointer onto a block, which is what brings the grip up. */
async function hover(editor: Editor, text: string): Promise<void> {
  const block = [...editor.view.dom.children].find((child) => child.textContent === text);
  if (!block) throw new Error(`no block reads "${text}"`);
  await settle(() => fireEvent.mouseMove(block));
}

/** A data transfer with the two members a drag start writes to. */
function transfer(): DataTransfer {
  const stub = { effectAllowed: 'none', setDragImage: vi.fn() };
  return stub as unknown as DataTransfer;
}

describe('the box a drag paints beside the document', () => {
  it('follows the pointer, and goes away when the button comes up', async () => {
    await mountEditor({ content: 'one\n\ntwo\n\nthree\n' });

    await settle(() => fireEvent.mouseDown(document.body, { clientX: 0, clientY: 0 }));
    expect(band()).toBeNull();

    await settle(() => fireEvent.mouseMove(window, { clientX: 30, clientY: 90 }));

    const box = band();
    expect(box).not.toBeNull();
    expect(box?.style.left).toBe('0px');
    expect(box?.style.width).toBe('30px');
    expect(box?.style.height).toBe('90px');

    await settle(() => fireEvent.mouseUp(window));
    expect(band()).toBeNull();
  });

  it('is drawn from whichever corner the drag started in', async () => {
    await mountEditor({ content: 'one\n\ntwo\n' });

    await settle(() => fireEvent.mouseDown(document.body, { clientX: 20, clientY: 20 }));
    await settle(() => fireEvent.mouseMove(window, { clientX: 4, clientY: 6 }));

    expect(band()?.style.left).toBe('4px');
    expect(band()?.style.top).toBe('6px');
    expect(band()?.style.width).toBe('16px');
  });

  it('stays away while the pointer moves without a drag', async () => {
    await mountEditor({ content: 'one\n\ntwo\n' });

    await settle(() => fireEvent.mouseMove(window, { clientX: 30, clientY: 90 }));

    expect(band()).toBeNull();
  });

  it('never starts on a button, so the grip keeps working', async () => {
    const editor = await mountEditor({ content: 'one\n\ntwo\n' });
    await hover(editor, 'one');

    const grip = screen.getByRole('button', { name: 'Block actions' });
    await settle(() => fireEvent.mouseDown(grip, { clientX: 0, clientY: 0 }));
    await settle(() => fireEvent.mouseMove(window, { clientX: 30, clientY: 90 }));

    expect(band()).toBeNull();
  });
});

describe('the grip of a marked run', () => {
  it('carries every block of the run, so a drop moves them together', async () => {
    const editor = await mountEditor({ content: 'one\n\ntwo\n\nthree\n' });
    markRun(editor, 1, 2);
    await hover(editor, 'two');

    const grip = screen.getByRole('button', { name: 'Block actions' });
    await settle(() => fireEvent.dragStart(grip, { dataTransfer: transfer() }));

    const dragging = editor.view.dragging;
    expect(dragging?.move).toBe(true);
    const slice = dragging?.slice;
    if (!slice) throw new Error('the drag carries nothing');
    expect(serializeFragment(slice.content, editor.schema)).toBe('two\n\nthree');
  });

  it('carries one block when the grip stands beside a block outside the run', async () => {
    const editor = await mountEditor({ content: 'one\n\ntwo\n\nthree\n' });
    markRun(editor, 1, 2);
    await hover(editor, 'one');

    const grip = screen.getByRole('button', { name: 'Block actions' });
    await settle(() => fireEvent.dragStart(grip, { dataTransfer: transfer() }));

    const slice = editor.view.dragging?.slice;
    if (!slice) throw new Error('the drag carries nothing');
    expect(serializeFragment(slice.content, editor.schema)).toBe('one');
  });
});
