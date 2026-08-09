import { describe, expect, it } from 'vitest';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { MAX_QUOTE_LENGTH, type CommentAnchor } from '@tablinum/shared';
import { anchorFor, flattenDoc, locateAnchor } from '../../src/editor/anchors';
import { createTestEditor } from './harness';

/** The document positions of the first occurrence of a phrase, as a selection would give them. */
function rangeOf(doc: ProseNode, phrase: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (!node.isText || typeof node.text !== 'string') return true;
    const at = node.text.indexOf(phrase);
    if (at === -1) return false;
    found = { from: pos + at, to: pos + at + phrase.length };
    return false;
  });
  if (found === null) throw new Error(`The document does not hold ${JSON.stringify(phrase)}`);
  return found;
}

/** Build the anchor a user would get by selecting a phrase, in a document made from markdown. */
function anchorOf(markdown: string, phrase: string): CommentAnchor {
  const editor = createTestEditor(markdown);
  try {
    const { from, to } = rangeOf(editor.state.doc, phrase);
    const anchor = anchorFor(editor.state.doc, from, to);
    if (anchor === null) throw new Error('That selection produced no anchor');
    return anchor;
  } finally {
    editor.destroy();
  }
}

/** What the anchor points at now, read back as plain text. */
function textAt(markdown: string, anchor: CommentAnchor): string | null {
  const editor = createTestEditor(markdown);
  try {
    const range = locateAnchor(editor.state.doc, anchor);
    if (range === null) return null;
    return editor.state.doc.textBetween(range.from, range.to, '\n');
  } finally {
    editor.destroy();
  }
}

const DOC = ['# Deploy', '', 'Run the pipeline every Friday.', '', 'Ask the duty engineer first.'].join(
  '\n',
);

describe('anchorFor', () => {
  it('quotes the selection and keeps the words on both sides', () => {
    const anchor = anchorOf(DOC, 'the pipeline');
    expect(anchor.quote).toBe('the pipeline');
    expect(anchor.prefix.endsWith('Run ')).toBe(true);
    expect(anchor.suffix.startsWith(' every Friday.')).toBe(true);
    expect(anchor.start).toBeGreaterThan(0);
  });

  it('gives nothing back for an empty selection', () => {
    const editor = createTestEditor(DOC);
    const { from } = rangeOf(editor.state.doc, 'pipeline');
    expect(anchorFor(editor.state.doc, from, from)).toBeNull();
    editor.destroy();
  });

  it('cuts a very long selection down to the quote the contract allows', () => {
    const long = 'word '.repeat(200).trim();
    const editor = createTestEditor(long);
    const anchor = anchorFor(editor.state.doc, 1, editor.state.doc.content.size - 1);
    editor.destroy();

    expect(anchor?.quote.length).toBe(MAX_QUOTE_LENGTH);
    expect(long.startsWith(anchor?.quote ?? '')).toBe(true);
  });

  it('crosses a block boundary with a newline in the quote', () => {
    const editor = createTestEditor(DOC);
    const first = rangeOf(editor.state.doc, 'every Friday.');
    const second = rangeOf(editor.state.doc, 'Ask the duty');
    const anchor = anchorFor(editor.state.doc, first.from, second.to);
    editor.destroy();

    expect(anchor?.quote).toBe('every Friday.\nAsk the duty');
  });
});

describe('locateAnchor', () => {
  it('finds the same words again in an unchanged page', () => {
    const anchor = anchorOf(DOC, 'the pipeline');
    expect(textAt(DOC, anchor)).toBe('the pipeline');
  });

  it('still lands on the right words after an edit above them', () => {
    const anchor = anchorOf(DOC, 'the pipeline');
    const edited = DOC.replace('# Deploy', '# Deploy, step by step\n\nA new opening paragraph.');
    expect(textAt(edited, anchor)).toBe('the pipeline');
  });

  it('tells two identical sentences apart by the words around them', () => {
    const twice = ['Check the logs. Then wait.', '', 'Restart it. Check the logs. Then leave.'].join('\n');
    const editor = createTestEditor(twice);
    const flat = flattenDoc(editor.state.doc);
    const anchor: CommentAnchor = {
      quote: 'Check the logs.',
      prefix: 'Restart it. ',
      suffix: ' Then leave.',
      // The offset of the FIRST copy, so only the context can pick the second one.
      start: flat.text.indexOf('Check the logs.'),
    };

    const range = locateAnchor(editor.state.doc, anchor);
    const found = range === null ? null : editor.state.doc.textBetween(range.from, range.to, '\n');
    const before =
      range === null ? '' : editor.state.doc.textBetween(Math.max(1, range.from - 12), range.from, '\n');
    editor.destroy();

    expect(found).toBe('Check the logs.');
    expect(before).toBe('Restart it. ');
  });

  it('falls back to the nearest match when the context is gone too', () => {
    const twice = ['Check the logs.', '', 'Check the logs.'].join('\n');
    const anchor: CommentAnchor = { quote: 'Check the logs.', prefix: 'gone ', suffix: ' gone', start: 0 };
    expect(textAt(twice, anchor)).toBe('Check the logs.');
  });

  it('reports an orphan rather than guess when the quoted text is deleted', () => {
    const anchor = anchorOf(DOC, 'the pipeline');
    const rewritten = DOC.replace('Run the pipeline every Friday.', 'Run the deployment every Friday.');
    expect(textAt(rewritten, anchor)).toBeNull();
  });

  it('reports an orphan when the quote is only partly still there', () => {
    const anchor = anchorOf(DOC, 'the pipeline every Friday');
    const rewritten = DOC.replace('every Friday', 'every Monday');
    expect(textAt(rewritten, anchor)).toBeNull();
  });
});

describe('flattenDoc', () => {
  it('joins blocks with a newline and maps every run back to a position', () => {
    const editor = createTestEditor(DOC);
    const flat = flattenDoc(editor.state.doc);
    editor.destroy();

    expect(flat.text).toBe('Deploy\nRun the pipeline every Friday.\nAsk the duty engineer first.');
    expect(flat.segments.length).toBeGreaterThanOrEqual(3);
    expect(flat.segments[0]?.offset).toBe(0);
  });
});
