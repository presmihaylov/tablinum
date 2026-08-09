import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { ClientMessage, LiveAgent, ServerMessage } from '@gitdocs/shared';
import { Presence } from '../src/components/Presence/Presence';
import { LiveProvider } from '../src/lib/live';
import { installFetch, type MockServer } from './mockFetch';
import { renderApp } from './render';

/** Stands in for the browser socket, so the test drives what the server would send. */
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

const ADA: LiveAgent = { id: 'ag_01ADA', name: 'Ada Writer', handle: 'ada' };
const PATH = 'eng/deploy';
const PAGE_ID = 'pg_01AAAAAAAAAAAAAAAAAAAAAAAA';

const originalSocket = globalThis.WebSocket;
let server: MockServer;

beforeEach(() => {
  FakeSocket.opened = [];
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: FakeSocket,
  });
  server = installFetch({
    'GET /api/v1/workspaces': { workspaces: [], current: null },
    'GET /api/v1/tree': { spaces: [] },
  });
});

afterEach(() => {
  server.restore();
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: originalSocket,
  });
});

/** Render the presence strip on a page, with the socket open and nothing on it yet. */
async function onPage(): Promise<FakeSocket> {
  renderApp(
    <LiveProvider>
      <Presence />
    </LiveProvider>,
    { route: `/p/${PATH}` },
  );
  const socket = await waitFor(() => {
    const first = FakeSocket.opened[0];
    if (first === undefined) throw new Error('no socket yet');
    return first;
  });
  act(() => socket.open());
  return socket;
}

function agentPresent(editing: boolean): ServerMessage {
  return {
    type: 'presence',
    path: PATH,
    users: [{ id: ADA.id, name: ADA.name, color: '#3b82f6', editing, agent: ADA }],
  };
}

describe('an agent on the page', () => {
  it('shows a chip for an agent that is reading the page', async () => {
    const socket = await onPage();
    act(() => socket.deliver(agentPresent(false)));

    const chip = await screen.findByTitle('Ada Writer (@ada) is reading this page');
    expect(chip.className).toContain('presence__chip--agent');
    expect(chip.className).not.toContain('presence__chip--editing');
  });

  it('pulses the chip while the agent writes', async () => {
    const socket = await onPage();
    act(() => socket.deliver(agentPresent(true)));

    const chip = await screen.findByTitle('Ada Writer (@ada) is writing this page');
    expect(chip.className).toContain('presence__chip--editing');
  });

  it('takes the chip away when the agent leaves the page', async () => {
    const socket = await onPage();
    act(() => socket.deliver(agentPresent(false)));
    await screen.findByTitle('Ada Writer (@ada) is reading this page');

    act(() => socket.deliver({ type: 'presence', path: PATH, users: [] }));
    await waitFor(() => {
      expect(screen.queryByTitle(/Ada Writer/)).toBeNull();
    });
  });

  it('says so when an agent edits the page under your eyes', async () => {
    const socket = await onPage();
    act(() =>
      socket.deliver({
        type: 'page',
        id: PAGE_ID,
        path: PATH,
        title: 'Deploy runbook',
        rev: 'rev-2',
        by: null,
        agent: ADA,
        source: 'api',
      }),
    );

    expect(await screen.findByText('Ada Writer edited this page')).toBeTruthy();
  });

  it('stays quiet about an edit to a page you are not on', async () => {
    const socket = await onPage();
    act(() =>
      socket.deliver({
        type: 'page',
        id: PAGE_ID,
        path: 'eng/oncall',
        title: 'On call',
        rev: 'rev-2',
        by: null,
        agent: ADA,
        source: 'api',
      }),
    );

    await vi.waitFor(() => {
      expect(screen.queryByText('Ada Writer edited this page')).toBeNull();
    });
  });
});
