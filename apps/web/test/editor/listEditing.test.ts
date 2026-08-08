import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { createTestEditor, toMarkdown } from './harness';

let editor: Editor | null = null;

function open(markdown: string): Editor {
  editor = createTestEditor(markdown);
  editor.commands.focus('end');
  return editor;
}

/** Feeds the text one character at a time, so the input rules see it as the user types. */
function type(instance: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = instance.state.selection;
    const insert = (): Transaction => instance.state.tr.insertText(char, from, to);
    const handled = instance.view.someProp('handleTextInput', (handler) =>
      handler(instance.view, from, to, char, insert),
    );
    if (handled === true) continue;
    instance.view.dispatch(insert());
  }
}

function press(instance: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key });
  return (
    instance.view.someProp('handleKeyDown', (handler) => handler(instance.view, event)) === true
  );
}

function findText(instance: Editor, text: string): number {
  let target = -1;
  instance.state.doc.descendants((node, pos) => {
    if (target === -1 && node.isText && node.text === text) target = pos;
    return true;
  });
  if (target === -1) throw new Error(`no such text: ${text}`);
  return target;
}

function cursorAfter(instance: Editor, text: string): void {
  instance.commands.setTextSelection(findText(instance, text) + text.length);
}

const ITEMS = ['listItem', 'taskItem'];

/** Deletes the whole list item that holds the given text. */
function removeItem(instance: Editor, text: string): void {
  const $pos = instance.state.doc.resolve(findText(instance, text));
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (!ITEMS.includes($pos.node(depth).type.name)) continue;
    instance.commands.deleteRange({ from: $pos.before(depth), to: $pos.after(depth) });
    return;
  }
  throw new Error(`not in a list item: ${text}`);
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('a numbered list built from nothing', () => {
  it('counts up as each item is typed', () => {
    const instance = open('');
    type(instance, '1. one');
    press(instance, 'Enter');
    type(instance, 'two');
    press(instance, 'Enter');
    type(instance, 'three');
    expect(toMarkdown(instance)).toBe('1. one\n2. two\n3. three\n');
  });

  it('keeps the bracket delimiter as it grows', () => {
    const instance = open('');
    type(instance, '1) one');
    press(instance, 'Enter');
    type(instance, 'two');
    expect(toMarkdown(instance)).toBe('1) one\n2) two\n');
  });

  it('numbers a list nested under Tab from one', () => {
    const instance = open('');
    type(instance, '1. one');
    press(instance, 'Enter');
    press(instance, 'Tab');
    type(instance, 'inner');
    press(instance, 'Enter');
    type(instance, 'inner two');
    expect(toMarkdown(instance)).toBe('1. one\n   1. inner\n   2. inner two\n');
  });
});

/**
 * Each item carries the number the file gave it, so an untouched list is written back
 * byte for byte. Those numbers go stale the moment the items move, and the list is then
 * counted afresh rather than replayed.
 */
describe('a numbered list the user changes', () => {
  it('renumbers the items below a new one', () => {
    const instance = open('1. one\n2. two\n3. three\n');
    cursorAfter(instance, 'one');
    press(instance, 'Enter');
    type(instance, 'new');
    expect(toMarkdown(instance)).toBe('1. one\n2. new\n3. two\n4. three\n');
  });

  it('closes the gap left by a deleted item', () => {
    const instance = open('1. one\n2. two\n3. three\n');
    removeItem(instance, 'two');
    expect(toMarkdown(instance)).toBe('1. one\n2. three\n');
  });

  it('carries on from the number the list starts at', () => {
    const instance = open('7. seven\n8. eight\n');
    press(instance, 'Enter');
    type(instance, 'nine');
    expect(toMarkdown(instance)).toBe('7. seven\n8. eight\n9. nine\n');
  });

  it('keeps the numbers when only the text changes', () => {
    const instance = open('1. one\n5. five\n9. nine\n');
    cursorAfter(instance, 'one');
    type(instance, '!');
    expect(toMarkdown(instance)).toBe('1. one!\n5. five\n9. nine\n');
  });

  it('gives up an odd sequence once the items move', () => {
    const instance = open('1. one\n5. five\n9. nine\n');
    press(instance, 'Enter');
    type(instance, 'more');
    expect(toMarkdown(instance)).toBe('1. one\n2. five\n3. nine\n4. more\n');
  });

  it('renumbers a nested list on its own', () => {
    const instance = open('1. one\n   1. inner\n   2. inner two\n2. two\n');
    cursorAfter(instance, 'inner');
    press(instance, 'Enter');
    type(instance, 'between');
    expect(toMarkdown(instance)).toBe(
      '1. one\n   1. inner\n   2. between\n   3. inner two\n2. two\n',
    );
  });
});

/** `1.` on every line is a common way to write markdown, and it survives an edit. */
describe('a list numbered all ones', () => {
  it('gives a new item the same number', () => {
    const instance = open('1. one\n1. two\n');
    press(instance, 'Enter');
    type(instance, 'three');
    expect(toMarkdown(instance)).toBe('1. one\n1. two\n1. three\n');
  });

  it('leaves the rest alone when an item goes', () => {
    const instance = open('1. one\n1. two\n1. three\n');
    removeItem(instance, 'two');
    expect(toMarkdown(instance)).toBe('1. one\n1. three\n');
  });

  it('holds the style at any starting number', () => {
    const instance = open('0. zero\n0. one\n');
    press(instance, 'Enter');
    type(instance, 'two');
    expect(toMarkdown(instance)).toBe('0. zero\n0. one\n0. two\n');
  });
});

describe('a numbered to-do list', () => {
  it('renumbers the items below a new one', () => {
    const instance = open('1. [ ] first\n2. [x] second\n');
    cursorAfter(instance, 'first');
    press(instance, 'Enter');
    type(instance, 'new');
    expect(toMarkdown(instance)).toBe('1. [ ] first\n2. [ ] new\n3. [x] second\n');
  });

  it('closes the gap left by a deleted item', () => {
    const instance = open('1. [ ] first\n2. [x] second\n3. [ ] third\n');
    removeItem(instance, 'second');
    expect(toMarkdown(instance)).toBe('1. [ ] first\n2. [ ] third\n');
  });
});
