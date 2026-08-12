import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import type { ClientMessage, PagePath, ServerMessage } from '@tablinum/shared';
import { caretsKey } from '../../src/editor/carets';
import { DocRoom } from '../../src/lib/docRoom';
import { myClientId } from '../../src/lib/identity';
import { LiveConnection } from '../../src/lib/liveClient';
import { useDocStream } from '../../src/editor/useStream';
import { readMarkdown } from '../../src/editor/markdown';
import type { MarkdownFrame } from '../../src/editor/markdown';
import { page } from '../fixtures';
import { createTestEditor, toMarkdown } from './harness';

const PATH = 'eng/deploy' as PagePath;
const MARKDOWN = '# Deploy\n';
const AGENT = { id: 'ag_1', name: 'Scribe', handle: 'scribe', avatarRev: null };

/** Stands in for the browser socket, the same shape liveClient.test.ts drives. */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static opened: FakeSocket[] = [];

  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ClientMessage);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  deliver(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

const realSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeSocket.opened = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = realSocket;
});

function socket(): FakeSocket {
  const found = FakeSocket.opened.at(-1);
  if (found === undefined) throw new Error('no socket was opened');
  return found;
}

function sentOfType(wire: FakeSocket, type: ClientMessage['type']): ClientMessage[] {
  return wire.sent.filter((message) => message.type === type);
}

/**
 * One tab: a real editor, a real room, and a socket the test drives by hand. The room is
 * built before the hook mounts, exactly as usePageDoc builds it a render ahead of the editor.
 */
function mountStream(markdown: string) {
  const editor = createTestEditor(markdown);
  const connection = new LiveConnection(() => 'ws://live');
  connection.start();
  socket().open();
  const room = new DocRoom(connection, PATH);
  const wire = socket();

  /**
   * The room's answer to `doc-open`, which is what registers the collab plugin. The baseline is
   * the text this tab loaded unless a test hands over another one, which is a file that moved.
   */
  const sendInit = (writer: string | null, baseline: string = markdown): void => {
    act(() => {
      wire.deliver({
        type: 'doc-init',
        path: PATH,
        baseline: { markdown: baseline, title: 'Deploy', rev: 'rev-1' },
        baseVersion: 0,
        steps: [],
        writer,
      });
    });
  };

  const mount = () =>
    renderHook(
      (props: { markdown: string; rev: string }) => {
        const frame = useRef<MarkdownFrame>(readMarkdown(markdown).frame);
        useDocStream({
          editor,
          room,
          frame,
          page: page({ path: PATH, markdown: props.markdown, rev: props.rev }),
          onTitle: () => undefined,
        });
      },
      { initialProps: { markdown, rev: 'rev-1' } },
    );

  return {
    editor,
    wire,
    sendInit,
    mount,
    stop(view: ReturnType<typeof mount> | null): void {
      view?.unmount();
      connection.stop();
      editor.destroy();
    },
  };
}

describe('the document stream', () => {
  it('survives a room that answered before the editor started listening', () => {
    const tab = mountStream(MARKDOWN);
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      // usePageDoc opens the room a render ahead of the editor, so the answer can land in
      // between. The editor then never seeded, and reading the collab version there used to
      // throw and take the whole page down with it.
      tab.sendInit(myClientId());
      view = tab.mount();

      expect(() =>
        act(() => {
          view?.rerender({ markdown: MARKDOWN, rev: 'rev-2' });
        }),
      ).not.toThrow();
      expect(sentOfType(tab.wire, 'doc-baseline')).toEqual([]);
    } finally {
      tab.stop(view);
    }
  });

  it('asks for the baseline again when it joined a room that was already open', () => {
    const tab = mountStream(MARKDOWN);
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      tab.sendInit(myClientId());
      expect(sentOfType(tab.wire, 'doc-open')).toHaveLength(1);

      view = tab.mount();
      expect(sentOfType(tab.wire, 'doc-open')).toHaveLength(2);

      // The second answer seeds this tab, and streaming works from there on.
      tab.sendInit(myClientId());
      act(() => {
        view?.rerender({ markdown: MARKDOWN, rev: 'rev-2' });
      });
      expect(sentOfType(tab.wire, 'doc-baseline')).toHaveLength(1);
    } finally {
      tab.stop(view);
    }
  });

  it('leaves the document alone when the first frame carries the text already on screen', () => {
    const tab = mountStream('# Deploy\n\nRun the pipeline from main.\n');
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      view = tab.mount();
      tab.sendInit(myClientId());
      act(() => {
        tab.wire.deliver({
          type: 'doc-agent-caret',
          path: PATH,
          client: AGENT.id,
          user: { id: AGENT.id, name: AGENT.name, color: '#ef4444' },
          agent: AGENT,
          anchor: { block: 1, offset: 4 },
          head: { block: 1, offset: 4 },
        });
      });
      const caret = 20;
      act(() => {
        tab.editor.commands.setTextSelection(caret);
      });
      const before = tab.editor.state.doc;

      // The room restarts, and its baseline is still the text on screen.
      tab.sendInit(myClientId());

      // Replacing the document with itself rebuilds every node view, moves the caret and wipes
      // everyone else's, which is what a person typing while the room restarts would lose.
      expect(tab.editor.state.doc).toBe(before);
      expect(tab.editor.state.selection.from).toBe(caret);
      expect(caretsKey.getState(tab.editor.state)?.carets.has(AGENT.id)).toBe(true);
    } finally {
      tab.stop(view);
    }
  });

  it('reseeds when the text matches but the document carries work the room has not seen', () => {
    const source = '# Deploy\n\nRun the pipeline from main.\n';
    const tab = mountStream(source);
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      view = tab.mount();
      tab.sendInit(myClientId());
      const baseline = tab.editor.state.doc.childCount;

      // Enter at the end of the page, which is the one keystroke that leaves the document and
      // its markdown disagreeing: a trailing empty paragraph writes nothing at all.
      act(() => {
        tab.editor.commands.setTextSelection(tab.editor.state.doc.content.size);
        tab.editor.commands.splitBlock();
      });
      expect(tab.editor.state.doc.childCount).toBe(baseline + 1);
      expect(toMarkdown(tab.editor)).toBe(source);

      // The room restarts and hands back a baseline that still matches the text on screen.
      tab.sendInit(myClientId());

      // Keeping the extra node while the step counter restarts at the room's version would leave
      // this tab one node ahead of a room that has no record of it, and every offset it sent
      // afterwards would miss by that node, which puts the next thing typed in the wrong block.
      expect(tab.editor.state.doc.childCount).toBe(baseline);
    } finally {
      tab.stop(view);
    }
  });

  it('keeps the caret near where it was when a restarted room hands over new text', () => {
    const tab = mountStream('# Deploy\n\nRun the pipeline from main.\n');
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      view = tab.mount();
      tab.sendInit(myClientId());
      const caret = 20;
      act(() => {
        tab.editor.commands.setTextSelection(caret);
      });

      // A file that moved under the room resets it, and the rejoin brings the new text back.
      tab.sendInit(myClientId(), '# Deploy\n\nRun the pipeline from main.\n\nThen tell the room.\n');

      expect(toMarkdown(tab.editor)).toContain('Then tell the room.');
      expect(tab.editor.state.selection.from).toBe(caret);
    } finally {
      tab.stop(view);
    }
  });

  it('keeps the caret at the end of work the room has never seen', () => {
    // The tab has typed a line the room knows nothing about, which is what a person doing so
    // while the first frame is still in flight looks like. The baseline is shorter than the
    // caret, and the merge below puts the typed line back, so the caret belongs at its end.
    const typed = 'Ship it -';
    const tab = mountStream(`${typed}\n\nA line after it.\n`);
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      view = tab.mount();
      // The end of the first line, which is neither the start nor the end of the document.
      const caret = typed.length + 1;
      act(() => {
        tab.editor.commands.setTextSelection(caret);
      });

      tab.sendInit(myClientId(), '');

      expect(toMarkdown(tab.editor)).toContain(typed);
      // Clamping to the empty baseline on the way through drags the caret to the first
      // position and leaves it there, and the next keystroke lands at the front of the page.
      expect(tab.editor.state.selection.from).toBe(caret);
    } finally {
      tab.stop(view);
    }
  });

  it('compacts the room once its first frame has arrived and a save lands', () => {
    const tab = mountStream(MARKDOWN);
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      view = tab.mount();
      tab.sendInit(myClientId());
      act(() => {
        view?.rerender({ markdown: MARKDOWN, rev: 'rev-2' });
      });
      expect(sentOfType(tab.wire, 'doc-baseline')).toHaveLength(1);
    } finally {
      tab.stop(view);
    }
  });

  it('draws an agent caret where the block and offset it sent point', () => {
    const tab = mountStream('# Deploy\n\nRun the pipeline from main.\n');
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      view = tab.mount();
      tab.sendInit(myClientId());

      act(() => {
        tab.wire.deliver({
          type: 'doc-agent-caret',
          path: PATH,
          client: AGENT.id,
          user: { id: AGENT.id, name: AGENT.name, color: '#ef4444' },
          agent: AGENT,
          anchor: { block: 1, offset: 4 },
          head: { block: 1, offset: 12 },
        });
      });

      const held = caretsKey.getState(tab.editor.state)?.carets.get(AGENT.id);
      expect(held?.user.name).toBe('Scribe');
      const from = tab.editor.state.doc.resolve(held?.anchor ?? 0);
      const to = tab.editor.state.doc.resolve(held?.head ?? 0);
      expect(from.parentOffset).toBe(4);
      expect(to.parentOffset).toBe(12);
      expect(from.parent.textContent).toBe('Run the pipeline from main.');
    } finally {
      tab.stop(view);
    }
  });

  it('takes an agent caret away when the agent leaves the page', () => {
    const tab = mountStream(MARKDOWN);
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      view = tab.mount();
      tab.sendInit(myClientId());

      act(() => {
        tab.wire.deliver({
          type: 'doc-agent-caret',
          path: PATH,
          client: AGENT.id,
          user: { id: AGENT.id, name: AGENT.name, color: '#ef4444' },
          agent: AGENT,
          anchor: { block: 0, offset: 0 },
          head: { block: 0, offset: 0 },
        });
      });
      expect(caretsKey.getState(tab.editor.state)?.carets.has(AGENT.id)).toBe(true);

      act(() => {
        tab.wire.deliver({ type: 'doc-left', path: PATH, client: AGENT.id });
      });
      expect(caretsKey.getState(tab.editor.state)?.carets.has(AGENT.id)).toBe(false);
    } finally {
      tab.stop(view);
    }
  });

  it('leaves the baseline alone while another tab is the writer', () => {
    const tab = mountStream(MARKDOWN);
    let view: ReturnType<typeof tab.mount> | null = null;
    try {
      view = tab.mount();
      tab.sendInit('another-tab');
      act(() => {
        view?.rerender({ markdown: MARKDOWN, rev: 'rev-2' });
      });
      expect(sentOfType(tab.wire, 'doc-baseline')).toEqual([]);
    } finally {
      tab.stop(view);
    }
  });
});
