import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import type { ClientMessage, PagePath, ServerMessage } from '@tablinum/shared';
import { DocRoom } from '../../src/lib/docRoom';
import { myClientId } from '../../src/lib/identity';
import { LiveConnection } from '../../src/lib/liveClient';
import { useDocStream } from '../../src/editor/useStream';
import { readMarkdown } from '../../src/editor/markdown';
import type { MarkdownFrame } from '../../src/editor/markdown';
import { page } from '../fixtures';
import { createTestEditor } from './harness';

const PATH = 'eng/deploy' as PagePath;
const MARKDOWN = '# Deploy\n';

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

  /** The room's answer to `doc-open`, which is what registers the collab plugin. */
  const sendInit = (writer: string | null): void => {
    act(() => {
      wire.deliver({
        type: 'doc-init',
        path: PATH,
        baseline: { markdown, title: 'Deploy', rev: 'rev-1' },
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
