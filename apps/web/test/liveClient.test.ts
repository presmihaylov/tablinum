import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, ClientMessage, ServerMessage } from '@tablinum/shared';
import { setAccountIdentity } from '../src/lib/identity';
import { LiveConnection } from '../src/lib/liveClient';

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

  /** Drive the handshake the browser would drive. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  deliver(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  deliverRaw(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const original = globalThis.WebSocket;

beforeEach(() => {
  FakeSocket.opened = [];
  // A tab reaches the live channel only once it is signed in, so give it an account.
  setAccountIdentity(ADA);
  vi.useFakeTimers();
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: FakeSocket,
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: original,
  });
});

function connect(): { live: LiveConnection; socket: FakeSocket } {
  const live = new LiveConnection(() => 'ws://test/api/v1/live?client=tab-a');
  live.start();
  const socket = FakeSocket.opened[0];
  if (socket === undefined) throw new Error('no socket was opened');
  return { live, socket };
}

describe('LiveConnection', () => {
  it('introduces itself and reports what it watches as soon as it opens', () => {
    const { live, socket } = connect();
    live.watch('eng/deploy');
    expect(socket.sent).toEqual([]);

    socket.open();
    expect(socket.sent[0]?.type).toBe('hello');
    expect(socket.sent[1]).toEqual({ type: 'watch', path: 'eng/deploy' });
    expect(live.connected).toBe(true);
    live.stop();
  });

  it('announces the connection to its listeners', () => {
    const seen: boolean[] = [];
    const live = new LiveConnection(() => 'ws://test/live');
    live.onStatus((up) => seen.push(up));
    live.start();

    const socket = FakeSocket.opened[0];
    socket?.open();
    socket?.close();
    expect(seen).toEqual([true, false]);
    live.stop();
  });

  it('passes a parsed message to every listener', () => {
    const received: ServerMessage[] = [];
    const { live, socket } = connect();
    live.onMessage((message) => received.push(message));
    socket.open();

    socket.deliver({ type: 'pong' });
    expect(received).toEqual([{ type: 'pong' }]);

    socket.deliverRaw('not json');
    socket.deliverRaw({ type: 'pong' });
    socket.deliverRaw(JSON.stringify({ noType: true }));
    expect(received).toHaveLength(1);
    live.stop();
  });

  it('reopens after a drop and replays what it was watching', () => {
    const { live, socket } = connect();
    socket.open();
    live.watch('eng/deploy');
    live.setEditing(true);

    socket.close();
    expect(live.connected).toBe(false);

    vi.advanceTimersByTime(500);
    const second = FakeSocket.opened[1];
    expect(second).toBeDefined();

    second?.open();
    expect(second?.sent[1]).toEqual({ type: 'watch', path: 'eng/deploy' });
    expect(second?.sent[2]).toEqual({ type: 'editing', editing: true });
    live.stop();
  });

  it('backs off further on each failed attempt', () => {
    const { live, socket } = connect();
    socket.open();

    socket.close();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.opened).toHaveLength(2);

    // The second socket never opened, so the delay doubles.
    FakeSocket.opened[1]?.close();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.opened).toHaveLength(2);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.opened).toHaveLength(3);
    live.stop();
  });

  it('stops reconnecting once it is told to stop', () => {
    const { live, socket } = connect();
    socket.open();
    live.stop();

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.opened).toHaveLength(1);
    expect(live.connected).toBe(false);
  });

  it('pings while the socket is open, and stops once it closes', () => {
    const { live, socket } = connect();
    socket.open();
    const before = socket.sent.length;

    vi.advanceTimersByTime(20_000);
    expect(socket.sent.slice(before)).toEqual([{ type: 'ping' }]);

    socket.close();
    const after = socket.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(socket.sent).toHaveLength(after);
    live.stop();
  });

  it('says nothing twice about the same page or the same editing flag', () => {
    const { live, socket } = connect();
    socket.open();
    const before = socket.sent.length;

    live.watch('eng/deploy');
    live.watch('eng/deploy');
    live.setEditing(true);
    live.setEditing(true);
    expect(socket.sent.slice(before)).toEqual([
      { type: 'watch', path: 'eng/deploy' },
      { type: 'editing', editing: true },
    ]);
    live.stop();
  });

  it('clears the editing flag when it moves to another page', () => {
    const { live, socket } = connect();
    socket.open();
    live.watch('eng/deploy');
    live.setEditing(true);

    live.watch('eng/oncall');
    const before = socket.sent.length;
    // The server already cleared it, so the flag has to be sent afresh.
    live.setEditing(true);
    expect(socket.sent.slice(before)).toEqual([{ type: 'editing', editing: true }]);
    live.stop();
  });

  it('drops a send while the socket is down instead of throwing', () => {
    const { live } = connect();
    expect(() => live.watch('eng/deploy')).not.toThrow();
    live.stop();
  });
});
