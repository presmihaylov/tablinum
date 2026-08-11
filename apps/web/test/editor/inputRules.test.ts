import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { createTestEditor, roundtrip, toMarkdown } from './harness';

let editor: Editor | null = null;

function open(): Editor {
  editor = createTestEditor('');
  editor.commands.focus('end');
  return editor;
}

/**
 * Input rules only run on real text input, so each character is pushed through
 * the same `handleTextInput` path the browser uses.
 */
function type(instance: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = instance.state.selection;
    const insert = (): Transaction => instance.state.tr.insertText(char, from, to);
    const handled = instance.view.someProp('handleTextInput', (handler) =>
      handler(instance.view, from, to, char, insert),
    );
    if (handled) continue;
    instance.view.dispatch(insert());
  }
}

/**
 * A key press, down the same path the browser uses. jsdom reports no platform, so
 * prosemirror-keymap reads `Mod` as Control here. A shifted press also needs `keyCode`, because
 * prosemirror-keymap falls back to it when the name itself matches nothing.
 */
function press(
  instance: Editor,
  key: string,
  options: { mod?: boolean; shift?: boolean; keyCode?: number } = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: options.mod ?? false,
    shiftKey: options.shift ?? false,
    keyCode: options.keyCode ?? 0,
  });
  return (
    instance.view.someProp('handleKeyDown', (handler) => handler(instance.view, event)) ?? false
  );
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('markdown input rules', () => {
  it('turns "# " into a heading', () => {
    const instance = open();
    type(instance, '# Title');
    expect(instance.isActive('heading', { level: 1 })).toBe(true);
    expect(toMarkdown(instance)).toBe('# Title\n');
  });

  it('turns "## " and "### " into the matching heading levels', () => {
    const instance = open();
    type(instance, '## Two');
    expect(instance.isActive('heading', { level: 2 })).toBe(true);

    instance.commands.setContent('');
    instance.commands.focus('end');
    type(instance, '### Three');
    expect(instance.isActive('heading', { level: 3 })).toBe(true);
  });

  it('turns "- " into a bulleted list', () => {
    const instance = open();
    type(instance, '- one');
    expect(instance.isActive('bulletList')).toBe(true);
    expect(toMarkdown(instance)).toBe('- one\n');
  });

  it('turns "1. " into a numbered list', () => {
    const instance = open();
    type(instance, '1. one');
    expect(instance.isActive('orderedList')).toBe(true);
    expect(toMarkdown(instance)).toBe('1. one\n');
  });

  it('turns "1) " into a numbered list and keeps the bracket', () => {
    const instance = open();
    type(instance, '1) one');
    expect(instance.isActive('orderedList')).toBe(true);
    expect(toMarkdown(instance)).toBe('1) one\n');
  });

  it('keeps the start number of a bracketed marker', () => {
    const instance = open();
    type(instance, '3) three');
    expect(toMarkdown(instance)).toBe('3) three\n');
  });

  it('turns "[] " into a to-do list', () => {
    const instance = open();
    type(instance, '[] milk');
    expect(instance.isActive('taskList')).toBe(true);
    expect(toMarkdown(instance)).toBe('- [ ] milk\n');
  });

  it('turns "> " into a quote', () => {
    const instance = open();
    type(instance, '> quoted');
    expect(instance.isActive('blockquote')).toBe(true);
    expect(toMarkdown(instance)).toBe('> quoted\n');
  });

  it('turns "> [!NOTE] " into a callout', () => {
    const instance = open();
    type(instance, '> [!NOTE] Watch out');
    expect(instance.isActive('callout', { type: 'NOTE' })).toBe(true);
    expect(toMarkdown(instance)).toBe('> [!NOTE]\n> Watch out\n');
  });

  it('turns "```" into a code block and keeps the language', () => {
    const instance = open();
    type(instance, '```js ');
    expect(instance.isActive('codeBlock')).toBe(true);
    type(instance, 'let a = 1;');
    expect(toMarkdown(instance)).toBe('```js\nlet a = 1;\n```\n');
  });

  it('turns "---" into a divider', () => {
    const instance = open();
    type(instance, '---');
    expect(instance.state.doc.firstChild?.type.name).toBe('horizontalRule');
    expect(toMarkdown(instance)).toBe('---\n');
  });

  it('applies the inline mark rules', () => {
    const instance = open();
    type(instance, '**bold** and *slant* and `code` and ~~gone~~');
    expect(toMarkdown(instance)).toBe('**bold** and *slant* and `code` and ~~gone~~\n');
  });

  it('leaves plain text that only looks like syntax alone', () => {
    const instance = open();
    type(instance, 'two minus one is 2 - 1');
    expect(instance.isActive('bulletList')).toBe(false);
    expect(toMarkdown(instance)).toBe('two minus one is 2 - 1\n');
  });
});

describe('the arrow input rule', () => {
  it('turns "->" into an arrow as it is typed', () => {
    const instance = open();
    type(instance, 'Ship it -> today');
    expect(toMarkdown(instance)).toBe('Ship it → today\n');
  });

  it('writes the arrow character to markdown and reads it back unchanged', () => {
    const instance = open();
    type(instance, 'Ship it -> today');
    const markdown = toMarkdown(instance);
    expect(markdown).toContain('→');
    expect(roundtrip(markdown)).toBe(markdown);
  });

  it('gives the typed "->" back on undo', () => {
    const instance = open();
    type(instance, 'Ship it ->');
    expect(toMarkdown(instance)).toBe('Ship it →\n');

    expect(press(instance, 'z', { mod: true })).toBe(true);
    expect(toMarkdown(instance)).toBe('Ship it ->\n');
  });

  it('gives the typed "->" back on backspace', () => {
    const instance = open();
    type(instance, 'Ship it ->');
    expect(press(instance, 'Backspace')).toBe(true);
    expect(toMarkdown(instance)).toBe('Ship it ->\n');
  });

  it('undoes the whole run on a second undo', () => {
    const instance = open();
    type(instance, 'Ship it ->');
    press(instance, 'z', { mod: true });
    press(instance, 'z', { mod: true });
    expect(toMarkdown(instance)).toBe('\n');
  });

  // Taking a rule back is an ordinary edit, and an ordinary edit closes the redo branch. The press
  // must not read as a plain undo either: `z` reaches the `Mod-z` binding through the
  // stripped-shift lookup, finds no rule pending, carries on to history and wipes the whole run.
  it('leaves redo with nothing to give back', () => {
    const instance = open();
    type(instance, 'Ship it ->');
    press(instance, 'z', { mod: true });
    expect(toMarkdown(instance)).toBe('Ship it ->\n');

    expect(press(instance, 'z', { mod: true, shift: true, keyCode: 90 })).toBe(true);
    expect(toMarkdown(instance)).toBe('Ship it ->\n');
  });

  // Both letters a browser can report for the press are exercised, because they reach the binding
  // by different routes: `z` matches `Shift-Mod-z` by name, while `Z` misses every named lookup
  // and arrives through prosemirror-keymap's `keyCode` fallback. w3c-keyname is what splits the
  // two, not the browser: on a Mac it drops `event.key` for a Cmd+Shift press and reads
  // `shift[90]`, which is `Z`, and everywhere else it passes `event.key` straight through.
  for (const key of ['z', 'Z'] as const) {
    it(`still redoes what there is to redo, on a "${key}" press`, () => {
      const instance = open();
      type(instance, 'Ship it');
      press(instance, 'z', { mod: true });
      press(instance, 'z', { mod: true });
      expect(toMarkdown(instance)).toBe('\n');

      expect(press(instance, key, { mod: true, shift: true, keyCode: 90 })).toBe(true);
      expect(toMarkdown(instance)).toBe('Ship it\n');
    });
  }

  it('takes back a block rule the same way, once typing has moved on', () => {
    const instance = open();
    type(instance, '# Title');
    press(instance, 'z', { mod: true });
    expect(toMarkdown(instance)).toBe('\n');
  });

  it('takes back a block rule on the undo right after it fires', () => {
    const instance = open();
    type(instance, '# ');
    expect(instance.isActive('heading', { level: 1 })).toBe(true);

    press(instance, 'z', { mod: true });
    expect(instance.isActive('heading', { level: 1 })).toBe(false);
    expect(instance.state.doc.textContent).toBe('# ');
  });

  it('leaves "->" alone inside a code block', () => {
    const instance = open();
    type(instance, '```js ');
    type(instance, 'const next = a -> b;');
    expect(toMarkdown(instance)).toBe('```js\nconst next = a -> b;\n```\n');
  });

  it('leaves "->" alone inside a mermaid block', () => {
    const instance = open();
    type(instance, '```mermaid ');
    type(instance, 'graph LR; A->B');
    expect(toMarkdown(instance)).toBe('```mermaid\ngraph LR; A->B\n```\n');
  });

  it('leaves "->" alone inside inline code', () => {
    const instance = open();
    instance.commands.toggleCode();
    type(instance, 'a->b');
    expect(toMarkdown(instance)).toBe('`a->b`\n');
  });

  it('rewrites nothing else Typography would have rewritten', () => {
    const instance = open();
    type(instance, '<- -- ... "quoted" 1/2 (c) != +/- 1/4');
    expect(toMarkdown(instance)).toBe('<- -- ... "quoted" 1/2 (c) != +/- 1/4\n');
  });
});
