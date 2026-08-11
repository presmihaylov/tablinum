import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Editor } from '@tiptap/core';
import { mountEditor, settle } from './mount';

/**
 * The global reset strips the marker from every `ul` and `ol`, so a numbered list showed no
 * numbers at all inside the editor. Nothing else catches this: jsdom does not expand the
 * `list-style` shorthand, so a computed style reads `decimal` either way.
 */
describe('editor list markers', () => {
  const base = readFileSync('src/styles/base.css', 'utf8');
  const surface = readFileSync('src/editor/styles/surface.css', 'utf8');
  const tasks = readFileSync('src/editor/styles/task-lists.css', 'utf8');

  it('the base stylesheet still resets them', () => {
    expect(base).toMatch(/ul,\s*ol\s*\{[^}]*list-style/);
  });

  it('the editor puts back a bullet and a number', () => {
    expect(surface).toMatch(/\.gd-editor-surface ul\s*\{[^}]*list-style-type:\s*disc/);
    expect(surface).toMatch(/\.gd-editor-surface ol\s*\{[^}]*list-style-type:\s*decimal/);
  });

  it('keeps the checkbox as the only marker on a to-do list', () => {
    expect(tasks).toMatch(/\.gd-editor-surface \.gd-editor-tasks\s*\{[^}]*list-style-type:\s*none/);
  });
});

/**
 * The hint decoration lands on the list, not on the item, and it draws from the list's left
 * edge. A bullet and a number hang outside that edge, but a checkbox sits on it, so a hint on
 * a to-do list ran under the box. The empty text is what stops it being drawn.
 */
describe('the hint on an empty list', () => {
  /**
   * The hint only shows where the caret is. Position 3 is inside the empty paragraph, three
   * steps past the list and the item that hold it.
   */
  async function openWithCaret(markdown: string): Promise<Editor> {
    const editor = await mountEditor({ content: markdown });
    await settle(() => editor.commands.setTextSelection(3));
    return editor;
  }

  it('is empty on a to-do list, so nothing is drawn over the checkbox', async () => {
    await openWithCaret('- [ ]\n');

    const list = document.querySelector('ul.gd-editor-tasks');
    expect(list?.className).toContain('is-empty');
    expect(list?.getAttribute('data-placeholder')).toBe('');
  });

  it('still reads on a bullet list, whose marker hangs clear of it', async () => {
    await openWithCaret('- \n');

    const list = document.querySelector('ul:not(.gd-editor-tasks)');
    expect(list?.className).toContain('is-empty');
    expect(list?.getAttribute('data-placeholder')).toBe('Type / for commands');
  });
});
