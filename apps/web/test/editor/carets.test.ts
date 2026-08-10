import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { DecorationSet } from '@tiptap/pm/view';
import type { RemoteCaret } from '../../src/lib/docRoom';
import {
  caretsKey,
  clearCarets,
  dropCaret,
  positionOfCursor,
  remoteCarets,
  setCaret,
} from '../../src/editor/carets';
import { createTestEditor } from './harness';

function caret(client: string, anchor: number, head = anchor): RemoteCaret {
  return { client, user: { id: `u-${client}`, name: client, color: '#ef4444' }, anchor, head };
}

function withCarets(markdown: string): Editor {
  const editor = createTestEditor(markdown);
  editor.registerPlugin(remoteCarets());
  return editor;
}

function positions(editor: Editor): Record<string, [number, number]> {
  const state = caretsKey.getState(editor.state);
  const out: Record<string, [number, number]> = {};
  for (const [id, entry] of state?.carets ?? []) out[id] = [entry.anchor, entry.head];
  return out;
}

/** How many decorations the plugin is drawing right now. */
function decorationCount(editor: Editor): number {
  const plugin = editor.state.plugins.find((entry) => entry.spec.key === caretsKey);
  const source = plugin?.props.decorations?.call(plugin, editor.state);
  if (!(source instanceof DecorationSet)) return 0;
  return source.find().length;
}

describe('remote carets', () => {
  it('draws nothing until a caret arrives', () => {
    const editor = withCarets('one two three\n');
    expect(decorationCount(editor)).toBe(0);
    editor.destroy();
  });

  it('draws a marker for a collapsed caret and a range for a selection', () => {
    const editor = withCarets('one two three\n');
    setCaret(editor.view, caret('tab-b', 4));
    expect(decorationCount(editor)).toBe(1);

    setCaret(editor.view, caret('tab-c', 2, 6));
    // The second caret adds both its marker and the highlight over its selection.
    expect(decorationCount(editor)).toBe(3);
    editor.destroy();
  });

  it('moves a caret when text is typed in front of it', () => {
    const editor = withCarets('one two three\n');
    setCaret(editor.view, caret('tab-b', 10));
    editor.chain().setTextSelection(1).insertContent('XX').run();

    expect(positions(editor)['tab-b']).toEqual([12, 12]);
    editor.destroy();
  });

  it('leaves a caret alone when the text after it changes', () => {
    const editor = withCarets('one two three\n');
    setCaret(editor.view, caret('tab-b', 2));
    editor.chain().setTextSelection(12).insertContent('XX').run();

    expect(positions(editor)['tab-b']).toEqual([2, 2]);
    editor.destroy();
  });

  it('keeps one caret per tab, not one per message', () => {
    const editor = withCarets('one two three\n');
    setCaret(editor.view, caret('tab-b', 3));
    setCaret(editor.view, caret('tab-b', 8));
    expect(Object.keys(positions(editor))).toEqual(['tab-b']);
    expect(positions(editor)['tab-b']).toEqual([8, 8]);
    editor.destroy();
  });

  it('takes a caret away when its tab leaves', () => {
    const editor = withCarets('one two three\n');
    setCaret(editor.view, caret('tab-b', 3));
    setCaret(editor.view, caret('tab-c', 5));
    dropCaret(editor.view, 'tab-b');

    expect(Object.keys(positions(editor))).toEqual(['tab-c']);
    editor.destroy();
  });

  it('takes every caret away when the document underneath is replaced', () => {
    const editor = withCarets('one two three\n');
    setCaret(editor.view, caret('tab-b', 3));
    setCaret(editor.view, caret('tab-c', 5));
    clearCarets(editor.view);

    expect(positions(editor)).toEqual({});
    expect(decorationCount(editor)).toBe(0);
    editor.destroy();
  });

  it('holds a caret inside the document when the text it sat on is deleted', () => {
    const editor = withCarets('one two three\n');
    const end = editor.state.doc.content.size;
    setCaret(editor.view, caret('tab-b', end - 1));
    editor.chain().setTextSelection({ from: 1, to: end - 1 }).deleteSelection().run();

    const [anchor, head] = positions(editor)['tab-b'] ?? [-1, -1];
    expect(anchor).toBeLessThanOrEqual(editor.state.doc.content.size);
    expect(head).toBeGreaterThanOrEqual(0);
    // A position that survived a delete must still be drawable.
    expect(decorationCount(editor)).toBe(1);
    editor.destroy();
  });
});

const AGENT_PAGE = '# Deploy\n\nRun the pipeline from main.\n\n- build\n- ship\n';

describe('an agent caret, said in blocks and offsets', () => {
  function inside(markdown: string, block: number, offset: number) {
    const editor = createTestEditor(markdown);
    try {
      const at = positionOfCursor(editor.state.doc, { block, offset });
      const where = editor.state.doc.resolve(at);
      return { at, parentOffset: where.parentOffset, text: where.parent.textContent };
    } finally {
      editor.destroy();
    }
  }

  it('lands on the block it names', () => {
    expect(inside(AGENT_PAGE, 1, 0).text).toBe('Run the pipeline from main.');
    expect(inside(AGENT_PAGE, 1, 0).parentOffset).toBe(0);
  });

  it('counts characters inside a paragraph exactly', () => {
    expect(inside(AGENT_PAGE, 1, 4).parentOffset).toBe(4);
  });

  it('holds the caret inside a block when the offset runs past its end', () => {
    const end = inside(AGENT_PAGE, 1, 900);
    expect(end.parentOffset).toBe('Run the pipeline from main.'.length);
  });

  it('holds the caret in the last block when the block runs past the end', () => {
    expect(inside(AGENT_PAGE, 99, 0).text).toContain('build');
  });

  it('treats a caret before the start of the page as the start of the page', () => {
    expect(inside(AGENT_PAGE, -3, -9).at).toBe(1);
  });

  it('gives a position the document can always resolve', () => {
    const editor = createTestEditor(AGENT_PAGE);
    for (const block of [0, 1, 2, 3]) {
      for (const offset of [0, 3, 1000]) {
        const at = positionOfCursor(editor.state.doc, { block, offset });
        expect(() => editor.state.doc.resolve(at)).not.toThrow();
      }
    }
    editor.destroy();
  });
});
