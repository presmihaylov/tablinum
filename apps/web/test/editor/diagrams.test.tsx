import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { createTestEditor, roundtrip, toMarkdown } from './harness';
import { mountEditor, settle } from './mount';
import { filterSlashCommands } from '../../src/editor/extensions';
import type { DiagramRequest } from '../../src/editor/extensions';
import { DiagramDialog } from '../../src/editor/ui/DiagramDialog';
import type { DiagramBoardProps } from '../../src/editor/ui/DiagramBoard';

/**
 * The real board pulls in Excalidraw, which wants a canvas and several megabytes of
 * JavaScript. The stand-in keeps the lazy boundary itself under test.
 */
vi.mock('../../src/editor/ui/DiagramBoard', () => ({
  default: ({ src, saving, onCancel, onSave }: DiagramBoardProps) => (
    <div data-testid="board" data-src={src ?? 'blank'} data-saving={String(saving)}>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" onClick={() => onSave('<svg>drawn</svg>')}>
        Save
      </button>
    </div>
  ),
}));

const SRC = '/_assets/pg_1/flow.excalidraw.svg';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(markdown: string): Editor {
  editor = createTestEditor(markdown);
  return editor;
}

describe('a diagram in the markdown', () => {
  it('is its own node when the line is a bare attachment image', () => {
    const node = open(`![Flow](${SRC})\n`).state.doc.firstChild;
    expect(node?.type.name).toBe('diagram');
    expect(node?.attrs['src']).toBe(SRC);
    expect(node?.attrs['label']).toBe('Flow');
  });

  it('stays an ordinary image for any other picture', () => {
    const node = open('![Flow](/_assets/pg_1/flow.svg)\n').state.doc.firstChild;
    expect(node?.type.name).toBe('paragraph');
    expect(node?.firstChild?.type.name).toBe('image');
  });

  it('does not interrupt a paragraph', () => {
    const source = `Intro:\n![Flow](${SRC})\n`;
    expect(open(source).state.doc.firstChild?.type.name).toBe('paragraph');
    expect(roundtrip(source)).toBe(source);
  });

  it('leaves a line the serializer could not rebuild as an image', () => {
    const node = open(`![Flow](${SRC} "Figure 1")\n`).state.doc.firstChild;
    expect(node?.firstChild?.type.name).toBe('image');
  });

  it('is inserted by the command, with and without a label', () => {
    const instance = open('');
    instance.commands.insertDiagram(SRC);
    expect(toMarkdown(instance)).toBe(`![](${SRC})\n`);
    instance.commands.setContent('');
    instance.commands.insertDiagram(SRC, 'Flow');
    expect(toMarkdown(instance)).toBe(`![Flow](${SRC})\n`);
  });

  it('writes the same line back after a save, so only the attachment changes', () => {
    const source = `![Flow](${SRC})\n`;
    const instance = open(source);
    instance.commands.updateAttributes('diagram', { rev: 7 });
    expect(toMarkdown(instance)).toBe(source);
  });
});

describe('the diagram slash command', () => {
  it('is offered under several names', () => {
    for (const query of ['diagram', 'draw', 'sketch', 'excalidraw']) {
      expect(filterSlashCommands(query).map((item) => item.id)).toContain('diagram');
    }
  });

  it('asks the shell for a canvas instead of inserting an empty node', () => {
    const instance = open('');
    // "diagram" also matches the mermaid command, so pick this one by id.
    const item = filterSlashCommands('diagram').find((command) => command.id === 'diagram');
    const onPickDiagram = vi.fn();
    item?.run(
      instance,
      { from: instance.state.selection.from, to: instance.state.selection.from },
      {
        onPickImage: () => undefined,
        onPickEmoji: () => undefined,
        onPickVideo: () => undefined,
        onPickPage: () => undefined,
        onPickDiagram,
        onInsertDatabase: () => undefined,
      },
    );
    expect(onPickDiagram).toHaveBeenCalledTimes(1);
    expect(instance.state.doc.childCount).toBe(1);
    expect(instance.state.doc.firstChild?.type.name).toBe('paragraph');
  });
});

describe('the diagram node view', () => {
  it('shows the stored picture and hands the editor its own drawing', async () => {
    const requests: DiagramRequest[] = [];
    const instance = await mountEditor({
      content: `![Flow](${SRC})\n`,
      editDiagram: (request) => requests.push(request),
    });

    const image = document.querySelector<HTMLImageElement>('img.gd-editor-diagram__image');
    expect(image?.getAttribute('src')).toBe(SRC);
    expect(image?.getAttribute('alt')).toBe('Flow');

    await settle(() => screen.getByTitle('Edit this diagram').click());
    expect(requests).toHaveLength(1);
    expect(requests[0]?.src).toBe(SRC);

    // Saving over the same attachment leaves the markdown alone and only busts the cache.
    await settle(() => requests[0]?.onSave(SRC));
    expect(document.querySelector('img.gd-editor-diagram__image')?.getAttribute('src')).toBe(
      `${SRC}?v=1`,
    );
    expect(toMarkdown(instance)).toBe(`![Flow](${SRC})\n`);
  });
});

describe('the diagram dialog', () => {
  it('loads no canvas while it is shut', () => {
    render(<DiagramDialog scene={null} saving={false} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByTestId('board')).toBeNull();
    expect(window.EXCALIDRAW_ASSET_PATH).toBeUndefined();
  });

  it('loads the canvas on demand, from this origin and no CDN', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<DiagramDialog scene={{ src: SRC }} saving={false} onCancel={onCancel} onSave={onSave} />);

    const board = await screen.findByTestId('board');
    expect(board.dataset['src']).toBe(SRC);
    // No CDN: the fonts come from a path this app serves itself.
    expect(window.EXCALIDRAW_ASSET_PATH).toBe('/assets/excalidraw/');

    await act(async () => screen.getByText('Save').click());
    expect(onSave).toHaveBeenCalledWith('<svg>drawn</svg>');
    await act(async () => screen.getByText('Cancel').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
