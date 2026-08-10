import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { SLASH_COMMANDS, filterSlashCommands } from '../../src/editor/extensions';
import {
  MERMAID_STARTER,
  mermaidErrorMessage,
  renderMermaid,
} from '../../src/editor/mermaid';
import { createTestEditor, toMarkdown } from './harness';
import { mountEditor, settle, settleFrame, typeText } from './mount';

/** The real renderer measures text in a browser, so it never runs in a unit test. */
const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

const SOURCE = 'graph TD\n  A[Start] --> B';
const DIAGRAM = `\`\`\`mermaid\n${SOURCE}\n\`\`\`\n`;
const PAGE = `Intro\n\n${DIAGRAM}`;

/** Drawing takes longer than a keystroke, so waits here allow for the debounce. */
const SLOW = { timeout: 2000 };

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  mermaid.initialize.mockImplementation(() => undefined);
  mermaid.render.mockImplementation((_id: string, source: string) =>
    Promise.resolve({ svg: `<svg data-testid="diagram" data-lines="${source.split('\n').length}"></svg>` }),
  );
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});

function must<T extends Element>(element: T | null): T {
  if (element === null) throw new Error('the diagram node view is not on screen');
  return element;
}

const block = (): Element => must(document.querySelector('.gd-editor-mermaid'));
const sourcePre = (): Element => must(document.querySelector('.gd-editor-mermaid__source'));
const figure = (): Element => must(document.querySelector('.gd-editor-mermaid__figure'));
const drawing = (): Element | null => document.querySelector('[data-testid="diagram"]');
const errorLine = (): Element | null => document.querySelector('.gd-editor-mermaid__error');

/** Where the first fence starts. The caret goes one past it, into the source. */
function fencePos(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'codeBlock') found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error('the document has no fence');
  return found;
}

/** Runs a slash command at the cursor, the way the suggestion plugin does. */
function pick(editor: Editor, id: string): void {
  const item = SLASH_COMMANDS.find((command) => command.id === id);
  if (item === undefined) throw new Error(`unknown slash command: ${id}`);
  const { from } = editor.state.selection;
  item.run(editor, { from, to: from }, {
    onPickImage: () => undefined,
    onPickEmoji: () => undefined,
    onPickVideo: () => undefined,
    onPickPage: () => undefined,
    onPickDiagram: () => undefined,
    onInsertDatabase: () => undefined,
  });
}

/** A `prefers-color-scheme` query the test can flip, which is how the app changes theme. */
function controlColorScheme(): (dark: boolean) => void {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let dark = false;
  const query = (media: string): MediaQueryList =>
    ({
      get matches() {
        return dark;
      },
      media,
      onchange: null,
      addEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_name: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  window.matchMedia = query;
  return (next: boolean) => {
    dark = next;
    for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
  };
}

/*
 * These run first on purpose: the loader caches the module and the configured theme, so a
 * later test cannot tell a skipped `initialize` from a missing one.
 */
describe('the mermaid loader', () => {
  it('configures mermaid for the theme it draws in, once per theme', async () => {
    await renderMermaid(SOURCE, 'dark');

    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme: 'dark',
      }),
    );

    await renderMermaid(SOURCE, 'light');
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'default' }),
    );

    const configured = mermaid.initialize.mock.calls.length;
    await renderMermaid(SOURCE, 'light');
    expect(mermaid.initialize).toHaveBeenCalledTimes(configured);
  });

  it('gives every diagram its own id', async () => {
    await renderMermaid(SOURCE, 'light');
    await renderMermaid(SOURCE, 'light');

    const ids = mermaid.render.mock.calls.map((call) => call[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('passes the failure on', async () => {
    mermaid.render.mockRejectedValueOnce(new Error('Parse error on line 2:'));

    await expect(renderMermaid('nonsense', 'light')).rejects.toThrow('Parse error on line 2:');
  });
});

describe('mermaidErrorMessage', () => {
  it('keeps the line number and the token mermaid tripped on', () => {
    const error = new Error(
      "Parse error on line 4:\n...|no| A ((\n----------^\nExpecting 'SEMI', 'NEWLINE', 'AMP', got 'PS'",
    );
    expect(mermaidErrorMessage(error)).toBe('Parse error on line 4 (got PS)');
  });

  it('leaves a message that is already one line alone', () => {
    const error = new Error('No diagram type detected matching given configuration for text: grap');
    expect(mermaidErrorMessage(error)).toBe(
      'No diagram type detected matching given configuration for text: grap',
    );
  });

  it('skips leading blank lines', () => {
    expect(mermaidErrorMessage('\n\n  boom  \n')).toBe('boom');
  });

  it('falls back when there is nothing to show', () => {
    expect(mermaidErrorMessage(new Error(''))).toBe('This diagram cannot be drawn.');
  });
});

describe('the diagram slash command', () => {
  const ids = (query: string): string[] => filterSlashCommands(query).map((item) => item.id);

  it('owns "mermaid" alone and shares "diagram" with the drawing canvas', () => {
    expect(ids('mermaid')).toEqual(['mermaid']);
    expect(ids('diagram')).toContain('mermaid');
    expect(ids('diagram')).toContain('diagram');
  });

  it('inserts a starter diagram, not an empty block', () => {
    const editor = createTestEditor('');
    editor.commands.focus('end');
    pick(editor, 'mermaid');

    expect(toMarkdown(editor)).toBe(`\`\`\`mermaid\n${MERMAID_STARTER}\n\`\`\`\n`);
    editor.destroy();
  });
});

describe('the diagram node view', () => {
  it('draws the fence and leaves the source closed', async () => {
    await mountEditor({ content: PAGE });

    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), SOURCE);
    expect(sourcePre()).toHaveAttribute('hidden');
    expect(block()).toHaveAttribute('data-source', 'closed');
  });

  it('leaves an ordinary fence as code', async () => {
    await mountEditor({ content: '```ts\nconst a = 1;\n```\n' });
    await settle(() => undefined);

    expect(document.querySelector('.gd-editor-mermaid')).toBeNull();
    expect(document.querySelector('.gd-editor-codeblock')).not.toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('opens the source when the caret enters the fence', async () => {
    const editor = await mountEditor({ content: PAGE });
    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);

    await settleFrame(() => editor.commands.focus(fencePos(editor) + 1));

    expect(block()).toHaveAttribute('data-source', 'open');
    expect(sourcePre()).not.toHaveAttribute('hidden');
    expect(drawing()).not.toBeNull();
  });

  it('closes the source again when the editor loses the caret', async () => {
    const editor = await mountEditor({ content: PAGE });
    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);
    await settleFrame(() => editor.commands.focus(fencePos(editor) + 1));
    expect(block()).toHaveAttribute('data-source', 'open');

    await settleFrame(() => editor.commands.blur());

    expect(block()).toHaveAttribute('data-source', 'closed');
  });

  it('opens the source when the picture is clicked, and closes it again', async () => {
    await mountEditor({ content: PAGE });
    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);

    await settleFrame(() => fireEvent.click(screen.getByLabelText('Mermaid diagram')));
    expect(block()).toHaveAttribute('data-source', 'open');

    await settle(() => fireEvent.click(screen.getByRole('button', { name: 'Diagram' })));
    expect(block()).toHaveAttribute('data-source', 'closed');
  });

  it('waits for the typing to stop before it draws again', async () => {
    const editor = await mountEditor({ content: PAGE });
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1), SLOW);

    await settle(() => {
      editor.commands.setTextSelection(fencePos(editor) + 1 + SOURCE.length);
      typeText(editor, '\n  B --> C');
    });

    expect(mermaid.render).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2), SLOW);
    expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), `${SOURCE}\n  B --> C`);
  });

  it('keeps the last good picture up when the source stops parsing', async () => {
    const editor = await mountEditor({ content: PAGE });
    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);
    mermaid.render.mockRejectedValue(new Error('Parse error on line 2:\n-----^'));

    await settle(() => {
      editor.commands.setTextSelection(fencePos(editor) + 1);
      typeText(editor, '{');
    });

    await waitFor(() => expect(errorLine()?.textContent).toBe('Parse error on line 2'), SLOW);
    expect(drawing()).not.toBeNull();
    expect(figure().className).toContain('is-stale');
  });

  it('clears the error once the source parses again', async () => {
    const editor = await mountEditor({ content: PAGE });
    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);
    mermaid.render.mockRejectedValue(new Error('Parse error on line 2:'));
    await settle(() => {
      editor.commands.setTextSelection(fencePos(editor) + 1);
      typeText(editor, '{');
    });
    await waitFor(() => expect(errorLine()).not.toBeNull(), SLOW);

    mermaid.render.mockImplementation(() =>
      Promise.resolve({ svg: '<svg data-testid="diagram"></svg>' }),
    );
    await settle(() => typeText(editor, '}'));

    await waitFor(() => expect(errorLine()).toBeNull(), SLOW);
    expect(figure().className).not.toContain('is-stale');
  });

  it('draws again when the app theme changes', async () => {
    const setDark = controlColorScheme();
    await mountEditor({ content: PAGE });
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1), SLOW);

    await settle(() => setDark(true));

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2), SLOW);
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    );
  });

  it('shows a reader the picture and no way into the source', async () => {
    await mountEditor({ content: PAGE, editable: false });

    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);
    expect(sourcePre()).toHaveAttribute('hidden');
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('copies the source, not the picture', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mountEditor({ content: PAGE });
    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(SOURCE);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
  });

  it('gives back the same fence it was handed', async () => {
    const editor = await mountEditor({ content: PAGE });
    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);

    expect(toMarkdown(editor)).toBe(PAGE);
  });

  it('turns a plain fence into a diagram from the language picker', async () => {
    const editor = await mountEditor({ content: '```\ngraph TD\n  A --> B\n```\n' });
    await settle(() => undefined);

    await settle(() =>
      fireEvent.change(screen.getByLabelText('Code language'), { target: { value: 'mermaid' } }),
    );

    await waitFor(() => expect(drawing()).not.toBeNull(), SLOW);
    expect(toMarkdown(editor)).toBe('```mermaid\ngraph TD\n  A --> B\n```\n');
  });
});
