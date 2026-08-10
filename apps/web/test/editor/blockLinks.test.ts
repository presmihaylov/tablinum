import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { anchorIdAt, blockAnchors, blockHash, blockIdFromHash, findBlockAnchor } from '../../src/editor/blockLinks';
import { createTestEditor } from './harness';

/**
 * The id a link to a block carries. It is made of the words of the block, so the markdown file
 * stays exactly as it was and a link keeps working while the words stand.
 */

let editor: Editor | null = null;

function open(markdown: string): Editor {
  editor = createTestEditor(markdown);
  return editor;
}

function ids(instance: Editor): string[] {
  return blockAnchors(instance.state.doc).map((anchor) => anchor.id);
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('the id of a link to a block', () => {
  it('is a slug of the words in the block', () => {
    const instance = open('## Deploy the service\n\nRun the pipeline.\n');

    expect(ids(instance)).toEqual(['deploy-the-service', 'run-the-pipeline']);
  });

  it('tells two blocks of the same words apart by their order', () => {
    const instance = open('Same words.\n\nOther.\n\nSame words.\n');

    expect(ids(instance)).toEqual(['same-words', 'other', 'same-words-2']);
  });

  it('names a block that holds no words by its kind', () => {
    const instance = open('Intro.\n\n---\n');

    expect(ids(instance)).toEqual(['intro', 'horizontalrule']);
  });

  it('cuts a long block on a word boundary', () => {
    const instance = open(
      'The quick brown fox jumps over the lazy dog and then keeps running down the road.\n',
    );

    const [id] = ids(instance);
    expect(id).toBe('the-quick-brown-fox-jumps-over-the-lazy-dog-and');
    // Never a trailing dash, so the id reads as whole words.
    expect(id?.endsWith('-')).toBe(false);
  });

  it('keeps letters that are not English', () => {
    const instance = open('Данни за плащане\n');

    expect(ids(instance)).toEqual(['данни-за-плащане']);
  });
});

describe('finding the block a link names', () => {
  it('gives the block back after another one is put above it', () => {
    const instance = open('First line.\n\nSecond line.\n');
    const before = findBlockAnchor(instance.state.doc, 'second-line');

    instance.commands.insertContentAt(0, '<p>A new opening line.</p>');
    const after = findBlockAnchor(instance.state.doc, 'second-line');

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // The words did not move, but the block did, and the link still lands on it.
    expect(after?.from).toBeGreaterThan(before?.from ?? 0);
  });

  it('gives nothing back once the words are gone', () => {
    const instance = open('First line.\n\nSecond line.\n');

    expect(findBlockAnchor(instance.state.doc, 'third-line')).toBeNull();
  });

  it('names the block that starts at a position', () => {
    const instance = open('First line.\n\nSecond line.\n');
    const second = blockAnchors(instance.state.doc)[1];

    expect(anchorIdAt(instance.state.doc, second?.from ?? -1)).toBe('second-line');
    // A position inside a block is not where the block starts, so it names nothing.
    expect(anchorIdAt(instance.state.doc, (second?.from ?? 0) + 1)).toBeNull();
  });
});

describe('the fragment of a page URL', () => {
  it('carries the id through escaping and back', () => {
    expect(blockIdFromHash(blockHash('данни-за-плащане'))).toBe('данни-за-плащане');
  });

  it('is nothing when the URL names no block', () => {
    expect(blockIdFromHash('')).toBeNull();
    expect(blockIdFromHash('#')).toBeNull();
    // A half-written escape in the address bar is not an id.
    expect(blockIdFromHash('#%E0%A4%A')).toBeNull();
  });
});
