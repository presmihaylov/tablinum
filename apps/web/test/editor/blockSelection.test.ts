import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { BlockSelection } from '../../src/editor/extensions';
import { serializeFragment } from '../../src/editor/markdown';
import { createTestEditor, toMarkdown } from './harness';

/**
 * The selection a drag over several blocks leaves behind. It has to cover whole blocks, so
 * Backspace takes the blocks away rather than fusing what is left of the first and the last.
 */

const PARAGRAPHS = ['Alpha.', '', 'Beta.', '', 'Gamma.', '', 'Delta.', ''].join('\n');
const LIST = ['Intro.', '', '- One', '- Two', '- Three', '', 'Outro.', ''].join('\n');

let editor: Editor | null = null;

function open(markdown: string): Editor {
  editor = createTestEditor(markdown);
  return editor;
}

/** The first position inside the paragraph or item that holds `text`. */
function inside(instance: Editor, text: string): number {
  let found: number | null = null;
  instance.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText && node.text?.includes(text) === true) found = pos + 1;
    return true;
  });
  if (found === null) throw new Error(`no text node holds ${text}`);
  return found;
}

/** Pick whole blocks across the two words, exactly as a drag over them would. */
function selectAcross(instance: Editor, first: string, last: string): void {
  const selection = BlockSelection.between(instance.state.doc, inside(instance, first), inside(instance, last));
  instance.view.dispatch(instance.state.tr.setSelection(selection));
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('a selection of whole blocks', () => {
  it('covers every block between the two ends', () => {
    const instance = open(PARAGRAPHS);

    selectAcross(instance, 'Beta.', 'Delta.');

    const selection = instance.state.selection;
    expect(selection).toBeInstanceOf(BlockSelection);
    expect((selection as BlockSelection).blocks()).toHaveLength(3);
  });

  it('takes the blocks away, leaving nothing of them behind', () => {
    const instance = open(PARAGRAPHS);

    selectAcross(instance, 'Beta.', 'Delta.');
    instance.commands.deleteSelection();

    // A plain text selection would fuse the halves of the first and the last into one line.
    expect(toMarkdown(instance)).toBe('Alpha.\n');
  });

  it('stays a text selection while both ends sit in one block', () => {
    const instance = open(PARAGRAPHS);
    const at = inside(instance, 'Beta.');

    const selection = BlockSelection.between(instance.state.doc, at, at + 3);

    expect(selection).not.toBeInstanceOf(BlockSelection);
  });

  it('picks the items of a list rather than the list around them', () => {
    const instance = open(LIST);

    selectAcross(instance, 'One', 'Two');
    instance.commands.deleteSelection();

    expect(toMarkdown(instance)).toBe('Intro.\n\n- Three\n\nOutro.\n');
  });

  it('copies out as the markdown of the blocks it covers', () => {
    const instance = open(PARAGRAPHS);

    selectAcross(instance, 'Beta.', 'Gamma.');
    const slice = instance.state.selection.content();

    expect(serializeFragment(slice.content, instance.schema)).toBe('Beta.\n\nGamma.');
  });

  it('gives way to a text selection once the blocks are gone', () => {
    const instance = open(PARAGRAPHS);

    selectAcross(instance, 'Alpha.', 'Delta.');
    instance.commands.deleteSelection();

    expect(instance.state.selection).toBeInstanceOf(TextSelection);
    // One empty paragraph is what the schema needs, so the blank line is the whole document.
    expect(toMarkdown(instance)).toBe('\n');
  });
});
