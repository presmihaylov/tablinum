import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The global reset strips the marker from every `ul` and `ol`, so a numbered list showed no
 * numbers at all inside the editor. Nothing else catches this: jsdom does not expand the
 * `list-style` shorthand, so a computed style reads `decimal` either way.
 */
describe('editor list markers', () => {
  const base = readFileSync('src/styles/base.css', 'utf8');
  const editor = readFileSync('src/editor/editor.css', 'utf8');

  it('the base stylesheet still resets them', () => {
    expect(base).toMatch(/ul,\s*ol\s*\{[^}]*list-style/);
  });

  it('the editor puts back a bullet and a number', () => {
    expect(editor).toMatch(/\.gd-editor-surface ul\s*\{[^}]*list-style-type:\s*disc/);
    expect(editor).toMatch(/\.gd-editor-surface ol\s*\{[^}]*list-style-type:\s*decimal/);
  });

  it('keeps the checkbox as the only marker on a to-do list', () => {
    expect(editor).toMatch(
      /\.gd-editor-surface \.gd-editor-tasks\s*\{[^}]*list-style-type:\s*none/,
    );
  });
});
