import { Editor } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import { buildExtensions } from '../../src/editor/extensions';
import type { EditorExtensionOptions } from '../../src/editor/extensions';
import { PARSE_OPTIONS, readMarkdown, writeMarkdown } from '../../src/editor/markdown';

/** A headless editor with the real schema. React node views are left out on purpose. */
export function createTestEditor(
  markdown = '',
  overrides: Partial<EditorExtensionOptions> = {},
): Editor {
  const extensions: Extensions = buildExtensions({ interactive: false, ...overrides });
  return new Editor({
    extensions,
    content: readMarkdown(markdown).body,
    parseOptions: PARSE_OPTIONS,
  });
}

/** markdown -> ProseMirror -> markdown, exactly as the editor does it on load and save. */
export function roundtrip(source: string): string {
  const { body, frame } = readMarkdown(source);
  const editor = createTestEditor(body);
  try {
    return writeMarkdown(editor.state.doc, frame);
  } finally {
    editor.destroy();
  }
}

/** Serialize whatever is currently in the editor, with a plain single-newline frame. */
export function toMarkdown(editor: Editor): string {
  return writeMarkdown(editor.state.doc);
}
