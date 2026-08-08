import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { createTestEditor, roundtrip, toMarkdown } from './harness';

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
const RAGGED = '| name  | count |\n| ----- | ----- |\n| alpha | 1     |\n';

/** The position of the first text node spelling `text`, so a test can aim at a cell. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error(`no text node says ${JSON.stringify(text)}`);
  return found;
}

/** Runs one table edit with the caret in the named cell and returns the markdown. */
function edit(source: string, cell: string, run: (editor: Editor) => void): string {
  const editor = createTestEditor(source);
  try {
    editor.commands.setTextSelection(posOf(editor, cell));
    run(editor);
    return toMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

/**
 * A table keeps the bytes of every row the edit did not touch. Changing the column
 * count is the exception: GFM drops a table whose header and delimiter rows disagree
 * on the cell count, so a width change has to rewrite every row.
 */
describe('table editing', () => {
  it('appends a column and rewrites every row to the new width', () => {
    const out = edit(TABLE, 'b', (editor) => editor.commands.addColumnAfter());

    expect(out).toBe('| a | b |  |\n| --- | --- | --- |\n| 1 | 2 |  |\n');
    expect(roundtrip(out)).toBe(out);
  });

  it('drops a column and rewrites every row to the new width', () => {
    const out = edit(TABLE, 'b', (editor) => editor.commands.deleteColumn());

    expect(out).toBe('| a |\n| --- |\n| 1 |\n');
    expect(roundtrip(out)).toBe(out);
  });

  it('rewrites the padded rows too, so the widths still line up', () => {
    const out = edit(RAGGED, 'count', (editor) => editor.commands.addColumnAfter());

    expect(out).toBe('| name | count |  |\n| --- | --- | --- |\n| alpha | 1 |  |\n');
    expect(roundtrip(out)).toBe(out);
  });

  it('leaves the other rows alone when a row is appended', () => {
    const out = edit(RAGGED, 'alpha', (editor) => editor.commands.addRowAfter());

    expect(out).toBe('| name  | count |\n| ----- | ----- |\n| alpha | 1     |\n|  |  |\n');
    expect(roundtrip(out)).toBe(out);
  });

  it('leaves the other rows alone when a row is deleted', () => {
    const out = edit(RAGGED, 'alpha', (editor) => editor.commands.deleteRow());

    expect(out).toBe('| name  | count |\n| ----- | ----- |\n');
    expect(roundtrip(out)).toBe(out);
  });

  it('regenerates only the row whose cell changed', () => {
    const out = edit(RAGGED, 'alpha', (editor) =>
      editor.commands.insertContentAt(
        { from: posOf(editor, 'alpha'), to: posOf(editor, 'alpha') + 5 },
        'beta',
      ),
    );

    expect(out).toBe('| name  | count |\n| ----- | ----- |\n| beta | 1 |\n');
    expect(roundtrip(out)).toBe(out);
  });

  it('promotes the next row when the header row goes', () => {
    const out = edit(TABLE, 'a', (editor) => editor.commands.deleteRow());

    expect(out).toBe('| 1 | 2 |\n| --- | --- |\n');
    expect(roundtrip(out)).toBe(out);
  });

  it('keeps a short row short while the width holds', () => {
    const source = '| a | b |\n| --- | --- |\n| 1 |\n';
    const out = edit(source, '1', (editor) => editor.commands.addRowAfter());

    expect(out).toBe('| a | b |\n| --- | --- |\n| 1 |\n|  |  |\n');
    expect(roundtrip(out)).toBe(out);
  });
});
