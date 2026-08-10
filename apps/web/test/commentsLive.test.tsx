import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { Account, ClientMessage, CommentThread, Page, ServerMessage } from '@tablinum/shared';
import { CommentsPanel } from '../src/components/Comments/CommentsPanel';
import { AuthProvider } from '../src/lib/auth';
import { CommentsProvider } from '../src/lib/comments';
import { myClientId, setAccountIdentity } from '../src/lib/identity';
import { LiveProvider } from '../src/lib/live';
import { page } from './fixtures';
import { installFetch, type MockServer } from './mockFetch';
import { renderApp } from './render';

const ADA: Account = {
  id: 'us_00000000000000000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  handle: 'ada.lovelace',
  role: 'admin',
  color: '#3b82f6',
  avatarRev: null,
  disabled: false,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
};

const PAGE: Page = page({ markdown: 'Run the pipeline every Friday.\n' });

/** Stands in for the browser socket. Nothing here talks to a network. */
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
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  deliver(message: ServerMessage): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

function thread(body: string): CommentThread {
  return {
    id: 'ct_00000000000000000000000001',
    pageId: PAGE.id,
    anchor: null,
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    comments: [
      {
        id: 'cm_00000000000000000000000001',
        threadId: 'ct_00000000000000000000000001',
        author: ADA.id,
        body,
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

let server: MockServer | null = null;
const original = globalThis.WebSocket;

beforeEach(() => {
  FakeSocket.opened = [];
  setAccountIdentity(ADA);
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeSocket });
});

afterEach(() => {
  server?.restore();
  server = null;
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: original });
});

/** Answers the first read with one thread and every later read with two. */
function mount(): { reads: () => number } {
  let read = 0;
  server = installFetch({
    'GET /api/v1/tree': { spaces: [] },
    'GET /api/v1/auth/state': { setupRequired: false, user: ADA },
    'GET /api/v1/users': { users: [ADA] },
    [`GET /api/v1/pages/${PAGE.id}/comments`]: () => {
      read += 1;
      return { threads: read === 1 ? [thread('The first remark')] : [thread('A remark from another tab')] };
    },
  });

  renderApp(
    <AuthProvider>
      <LiveProvider>
        <CommentsProvider pageId={PAGE.id}>
          <CommentsPanel />
        </CommentsProvider>
      </LiveProvider>
    </AuthProvider>,
  );

  return { reads: () => read };
}

function socket(): FakeSocket {
  const found = FakeSocket.opened[0];
  if (found === undefined) throw new Error('no socket was opened');
  return found;
}

describe('comments over the live channel', () => {
  it('reads the threads again when another tab writes one', async () => {
    mount();
    await screen.findByText('The first remark');

    await act(async () => {
      socket().deliver({ type: 'comments', pageId: PAGE.id, by: 'another-tab' });
    });

    await screen.findByText('A remark from another tab');
  });

  it('ignores the echo of its own write', async () => {
    const { reads } = mount();
    await screen.findByText('The first remark');
    expect(reads()).toBe(1);

    await act(async () => {
      socket().deliver({ type: 'comments', pageId: PAGE.id, by: myClientId() });
    });

    await waitFor(() => expect(reads()).toBe(1));
    expect(screen.getByText('The first remark')).toBeTruthy();
  });
});
