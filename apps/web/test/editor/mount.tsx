import { useEffect, useRef } from 'react';
import { expect } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { buildExtensions } from '../../src/editor/extensions';
import type { DiagramRequest, MentionCandidate, WikilinkItem } from '../../src/editor/extensions';
import { ThemeProvider } from '../../src/lib/theme';
import { BlockHandles } from '../../src/editor/ui/BlockHandles';
import { MarkMenu } from '../../src/editor/ui/MarkMenu';
import { TableControls } from '../../src/editor/ui/TableControls';
import { TableMenu } from '../../src/editor/ui/TableMenu';

/**
 * jsdom does no layout and gives a Range no rectangles, which is what ProseMirror
 * measures to place a caret. One fixed rectangle is enough for the menus.
 */
function stubGeometry(): void {
  const rect = (): DOMRect => new DOMRect(40, 200, 8, 16);
  const list = (): DOMRectList => [rect()] as unknown as DOMRectList;
  Range.prototype.getClientRects = list;
  Range.prototype.getBoundingClientRect = rect;
}

stubGeometry();

export interface MountOptions {
  /** Markdown, exactly as the real editor receives it. */
  content?: string;
  searchPages?: (query: string) => Promise<WikilinkItem[]>;
  searchPeople?: (query: string) => Promise<MentionCandidate[]>;
  onPickImage?: () => void;
  onPickEmoji?: () => void;
  onPickVideo?: () => void;
  onPickPage?: () => void;
  editDiagram?: (request: DiagramRequest) => void;
  /** Given only when the page holds comments, exactly as the real shell does it. */
  onComment?: () => void;
  /** False mounts the editor the way a reader sees it. Defaults to true. */
  editable?: boolean;
}

function Harness({
  options,
  onReady,
}: {
  options: MountOptions;
  onReady: (editor: Editor) => void;
}) {
  const editor = useEditor({
    extensions: buildExtensions({
      ...(options.searchPages ? { searchPages: options.searchPages } : {}),
      ...(options.searchPeople ? { searchPeople: options.searchPeople } : {}),
      ...(options.onPickImage ? { onPickImage: options.onPickImage } : {}),
      ...(options.onPickEmoji ? { onPickEmoji: options.onPickEmoji } : {}),
      ...(options.onPickVideo ? { onPickVideo: options.onPickVideo } : {}),
      ...(options.onPickPage ? { onPickPage: options.onPickPage } : {}),
      ...(options.editDiagram ? { editDiagram: options.editDiagram } : {}),
    }),
    content: options.content ?? '',
    editable: options.editable ?? true,
  });
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);
  return (
    <div className="editor__canvas" ref={canvas}>
      <EditorContent editor={editor} />
      {editor ? (
        <BlockHandles
          editor={editor}
          canvas={canvas}
          {...(options.onComment ? { onComment: options.onComment } : {})}
        />
      ) : null}
      {editor ? <TableControls editor={editor} canvas={canvas} /> : null}
      {editor ? <MarkMenu editor={editor} /> : null}
      {editor ? <TableMenu editor={editor} /> : null}
    </div>
  );
}

/**
 * A really mounted editor. Menus and suggestion popovers are React components,
 * so they only exist once the editor lives in the document. The theme provider is
 * there because node views may paint themselves differently in each theme.
 */
export async function mountEditor(options: MountOptions = {}): Promise<Editor> {
  let found: Editor | null = null;
  render(
    <ThemeProvider>
      <Harness options={options} onReady={(instance) => (found = instance)} />
    </ThemeProvider>,
  );
  await waitFor(() => expect(found).not.toBeNull());
  return found as unknown as Editor;
}

/**
 * Types through `handleTextInput`, the path the browser uses. The caret is moved
 * without `focus()`: a focused view reads the caret back from the DOM, and jsdom
 * has no real caret to read.
 */
export function typeText(editor: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const insert = (): Transaction => editor.state.tr.insertText(char, from, to);
    const handled = editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, from, to, char, insert),
    );
    if (handled) continue;
    editor.view.dispatch(insert());
  }
}

/** Moves the pointer onto the first table, which is what brings its controls up. */
export async function hoverTable(editor: Editor): Promise<void> {
  const cell = editor.view.dom.querySelector('th, td');
  if (!cell) throw new Error('the document has no table');
  await settle(() => fireEvent.mouseMove(cell));
}

/** Runs an edit and lets the asynchronous menu updates settle inside `act`. */
export async function settle(work: () => void): Promise<void> {
  await act(async () => {
    work();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Like `settle`, but also waits a frame: tiptap moves focus inside `requestAnimationFrame`. */
export async function settleFrame(work: () => void): Promise<void> {
  await act(async () => {
    work();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
