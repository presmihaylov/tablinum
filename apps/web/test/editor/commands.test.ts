import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import { createTestEditor, toMarkdown } from './harness';
import { SLASH_COMMANDS, filterSlashCommands } from '../../src/editor/extensions';

let editor: Editor | null = null;

function open(markdown: string): Editor {
  editor = createTestEditor(markdown);
  editor.commands.focus('end');
  return editor;
}

/** Runs a slash command at the cursor, the way the suggestion plugin does. */
function pick(instance: Editor, id: string): void {
  const item = SLASH_COMMANDS.find((command) => command.id === id);
  if (item === undefined) throw new Error(`unknown slash command: ${id}`);
  const { from } = instance.state.selection;
  item.run(
    instance,
    { from, to: from },
    {
      onPickImage: () => undefined,
      onPickEmoji: () => undefined,
      onPickVideo: () => undefined,
      onPickPage: () => undefined,
    },
  );
}

/** The cursor inside the first cell of the body row. */
function inFirstCell(instance: Editor, text: string): void {
  let target = -1;
  instance.state.doc.descendants((node, pos) => {
    if (target === -1 && node.isText && node.text === text) target = pos + 1;
    return true;
  });
  instance.commands.setTextSelection(target);
}

function pressKey(instance: Editor, key: string, shift = false, mod = false): boolean {
  const event = new KeyboardEvent('keydown', { key, shiftKey: shift, ctrlKey: mod });
  return (
    instance.view.someProp('handleKeyDown', (handler) => handler(instance.view, event)) === true
  );
}

function selectWholeDocument(instance: Editor): void {
  instance.view.dispatch(instance.state.tr.setSelection(new AllSelection(instance.state.doc)));
}

const TABLE = '| a | b |\n| --- | --- |\n| one | two |\n';

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('slash menu inside a table cell', () => {
  it('offers only the blocks a GFM cell can hold', () => {
    const instance = open(TABLE);
    inFirstCell(instance, 'one');
    expect(filterSlashCommands('', instance).map((item) => item.id)).toEqual(['image', 'emoji']);
  });

  it('offers every block outside a table', () => {
    const instance = open('text\n');
    expect(filterSlashCommands('', instance)).toHaveLength(SLASH_COMMANDS.length);
  });

  it('keeps the cell text when a block reaches a cell anyway', () => {
    const instance = open(TABLE);
    inFirstCell(instance, 'one');
    pick(instance, 'bulletList');
    expect(toMarkdown(instance)).toBe(TABLE);
  });
});

describe('divider command', () => {
  it('writes the rule after the list, not inside an item', () => {
    const instance = open('- one\n- two\n');
    pick(instance, 'horizontalRule');
    expect(toMarkdown(instance)).toBe('- one\n- two\n\n---\n');
  });

  it('leaves a nested list whole', () => {
    const instance = open('- a\n  - b\n');
    pick(instance, 'horizontalRule');
    expect(toMarkdown(instance)).toBe('- a\n  - b\n\n---\n');
  });

  it('takes the empty item with it', () => {
    const instance = open('- one\n- two\n');
    instance.commands.splitListItem('listItem');
    pick(instance, 'horizontalRule');
    expect(toMarkdown(instance)).toBe('- one\n- two\n\n---\n');
  });

  it('still writes the rule inside a quote', () => {
    const instance = open('> quoted\n');
    pick(instance, 'horizontalRule');
    expect(toMarkdown(instance)).toBe('> quoted\n>\n> ---\n');
  });

  it('still writes the rule under a paragraph', () => {
    const instance = open('text\n');
    pick(instance, 'horizontalRule');
    expect(toMarkdown(instance)).toBe('text\n\n---\n');
  });
});

/**
 * `toggleList` only unwraps when the selection resolves to a range inside the list. Under a
 * whole-document selection it took its wrap branch instead, nested the list in a second one
 * and wrote every checkbox out as literal text.
 */
describe('list shortcuts under a whole-document selection', () => {
  it('unwraps a to-do list and keeps no checkbox text', () => {
    const instance = open('- [x] one\n- [ ] two\n');
    selectWholeDocument(instance);
    expect(pressKey(instance, '9', true, true)).toBe(true);
    expect(toMarkdown(instance)).toBe('one\n\ntwo\n');
  });

  it('unwraps a bulleted list', () => {
    const instance = open('- one\n- two\n');
    selectWholeDocument(instance);
    expect(pressKey(instance, '8', true, true)).toBe(true);
    expect(toMarkdown(instance)).toBe('one\n\ntwo\n');
  });

  it('unwraps a numbered list', () => {
    const instance = open('1. one\n2. two\n');
    selectWholeDocument(instance);
    expect(pressKey(instance, '7', true, true)).toBe(true);
    expect(toMarkdown(instance)).toBe('one\n\ntwo\n');
  });

  it('unwraps one level of a nested list and keeps the inner boxes', () => {
    const instance = open('- [x] one\n  - [ ] two\n');
    selectWholeDocument(instance);
    expect(pressKey(instance, '9', true, true)).toBe(true);
    expect(toMarkdown(instance)).toBe('one\n- [ ] two\n');
  });

  it('leaves the document alone when the selection reaches past the list', () => {
    const instance = open('# H\n\n- [x] one\n');
    selectWholeDocument(instance);
    instance.commands.liftListItem('taskItem');
    expect(toMarkdown(instance)).toBe('# H\n\n- [x] one\n');
  });
});

describe('list shortcuts with a cursor', () => {
  it('still turns a paragraph into a list and back', () => {
    const instance = open('text\n');
    expect(pressKey(instance, '8', true, true)).toBe(true);
    expect(toMarkdown(instance)).toBe('- text\n');
    expect(pressKey(instance, '8', true, true)).toBe(true);
    expect(toMarkdown(instance)).toBe('text\n');
  });

  it('still turns a to-do item back into a paragraph', () => {
    const instance = open('- [x] one\n- [ ] two\n');
    expect(pressKey(instance, '9', true, true)).toBe(true);
    expect(toMarkdown(instance)).toBe('- [x] one\n\ntwo\n');
  });
});

describe('tab inside a code block', () => {
  it('indents instead of moving the focus out of the editor', () => {
    const instance = open('```js\nlet a = 1;\n```\n');
    expect(pressKey(instance, 'Tab')).toBe(true);
    expect(toMarkdown(instance)).toBe('```js\nlet a = 1;  \n```\n');
  });

  it('leaves the list indent key alone', () => {
    const instance = open('- one\n- two\n');
    expect(pressKey(instance, 'Tab')).toBe(true);
    expect(toMarkdown(instance)).toBe('- one\n  - two\n');
  });

  it('keeps an escape hatch out of the block', () => {
    const instance = open('```js\nlet a = 1;\n```\n');
    expect(instance.commands.setHardBreak()).toBe(true);
    expect(instance.isActive('codeBlock')).toBe(false);
  });
});
