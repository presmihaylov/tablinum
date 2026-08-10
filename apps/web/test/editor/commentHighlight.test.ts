import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { anchorFor, locateAnchor } from '../../src/editor/anchors';
import { commentHighlightKey, DRAFT_SPAN_ID } from '../../src/editor/extensions/commentHighlight';
import { createTestEditor, toMarkdown } from './harness';

const DOC = 'Run the pipeline every Friday.';

/** Every highlight the plugin has drawn, read off the rendered document. */
function highlights(editor: Editor): Array<{ className: string; text: string }> {
  return [...editor.view.dom.querySelectorAll('.gd-comment')].map((node) => ({
    className: node.className,
    text: node.textContent ?? '',
  }));
}

/** The decorated ranges, which is what a mapping test needs. */
function spans(editor: Editor): Array<{ threadId: unknown; from: number; to: number }> {
  const set = commentHighlightKey.getState(editor.state)?.decorations;
  if (set === undefined) throw new Error('The comment highlight plugin is not installed');
  return set.find().map((found) => ({ threadId: found.spec['threadId'], from: found.from, to: found.to }));
}

/** The document range of a phrase, found the way a thread finds it after a reload. */
function rangeOf(editor: Editor, phrase: string): { from: number; to: number } {
  const at = DOC.indexOf(phrase);
  const anchor = anchorFor(editor.state.doc, 1 + at, 1 + at + phrase.length);
  if (anchor === null) throw new Error('That selection produced no anchor');
  const range = locateAnchor(editor.state.doc, anchor);
  if (range === null) throw new Error('That anchor found nothing');
  return range;
}

describe('comment highlights', () => {
  it('draws a span for each thread and marks the one in focus', () => {
    const editor = createTestEditor(DOC);
    const first = rangeOf(editor, 'the pipeline');
    const second = rangeOf(editor, 'every Friday');

    editor.commands.setCommentSpans(
      [
        { id: 'ct_one', ...first, resolved: false },
        { id: 'ct_two', ...second, resolved: true },
      ],
      'ct_two',
    );

    expect(highlights(editor)).toEqual([
      { className: 'gd-comment', text: 'the pipeline' },
      { className: 'gd-comment gd-comment--resolved gd-comment--active', text: 'every Friday' },
    ]);
    editor.destroy();
  });

  it('marks the draft span apart from a real thread', () => {
    const editor = createTestEditor(DOC);
    const range = rangeOf(editor, 'the pipeline');
    editor.commands.setCommentSpans([{ id: DRAFT_SPAN_ID, ...range, resolved: false }], null);

    expect(highlights(editor)).toEqual([
      { className: 'gd-comment gd-comment--draft', text: 'the pipeline' },
    ]);
    editor.destroy();
  });

  it('NEVER puts anything in the markdown', () => {
    const editor = createTestEditor(DOC);
    const range = rangeOf(editor, 'the pipeline');
    const before = toMarkdown(editor);

    editor.commands.setCommentSpans([{ id: 'ct_one', ...range, resolved: false }], 'ct_one');
    const after = toMarkdown(editor);

    expect(after).toBe(before);
    expect(after).not.toContain('ct_one');
    expect(after).not.toContain('gd-comment');
    editor.destroy();
  });

  it('follows the text when somebody types in front of it', () => {
    const editor = createTestEditor(DOC);
    const range = rangeOf(editor, 'the pipeline');
    editor.commands.setCommentSpans([{ id: 'ct_one', ...range, resolved: false }], null);

    editor.commands.insertContentAt(1, 'Always ');

    expect(spans(editor)).toEqual([
      { threadId: 'ct_one', from: range.from + 7, to: range.to + 7 },
    ]);
    expect(highlights(editor)[0]?.text).toBe('the pipeline');
    editor.destroy();
  });

  it('drops a span that no longer fits the document', () => {
    const editor = createTestEditor(DOC);
    const size = editor.state.doc.content.size;
    editor.commands.setCommentSpans(
      [
        { id: 'ct_far', from: size + 10, to: size + 20, resolved: false },
        { id: 'ct_empty', from: 3, to: 3, resolved: false },
      ],
      null,
    );

    expect(spans(editor)).toEqual([]);
    editor.destroy();
  });

  it('reports the thread behind a click, and leaves the caret alone', () => {
    const seen: string[] = [];
    const editor = createTestEditor(DOC, { openComment: (id: string) => seen.push(id) });
    const range = rangeOf(editor, 'the pipeline');
    editor.commands.setCommentSpans(
      [
        { id: 'ct_one', ...range, resolved: false },
        { id: DRAFT_SPAN_ID, from: 1, to: 4, resolved: false },
      ],
      null,
    );

    // someProp hands back whatever the handler returned, so the caller only asks if it is falsy.
    const click = (pos: number): unknown =>
      editor.view.someProp('handleClick', (handler) =>
        handler(editor.view, pos, new MouseEvent('click')),
      );

    expect(click(range.from + 1)).toBeFalsy();
    expect(seen).toEqual(['ct_one']);

    // A click on the draft span names no thread, so nothing is focused.
    click(2);
    expect(seen).toEqual(['ct_one']);
    editor.destroy();
  });
});
