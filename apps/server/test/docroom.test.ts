import { describe, expect, it } from 'vitest';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger } from 'fastify';
import {
  MAX_ROOM_STEPS,
  colorForId,
  type DocBaseline,
  type LiveAgent,
  type LiveUser,
  type Page,
  type ServerMessage,
} from '@tablinum/shared';
import { DocRooms, versionOf, writerOf } from '../src/docroom.js';
import { LiveHub } from '../src/live.js';

const PATH = 'eng/deploy';
const AGENT: LiveAgent = { id: 'ag_01ADA', name: 'Ada', handle: 'ada', avatarRev: null };

function baseline(markdown: string, rev = 'rev-1'): DocBaseline {
  return { markdown, title: 'Deploy runbook', rev };
}

describe('DocRooms', () => {
  it('creates a room from the first tab and keeps its baseline for the rest', () => {
    const rooms = new DocRooms();
    const first = rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    const second = rooms.open(PATH, 'tab-b', baseline('something else'));

    expect(rooms.size).toBe(1);
    expect(second).toBe(first);
    expect(second.baseline.markdown).toBe('# Deploy');
    expect(second.members).toEqual(['tab-a', 'tab-b']);
    expect(writerOf(second)).toBe('tab-a');
  });

  it('does not add the same tab twice', () => {
    const rooms = new DocRooms();
    rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    const room = rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    expect(room.members).toEqual(['tab-a']);
  });

  it('hands the pen to the next tab in join order', () => {
    const rooms = new DocRooms();
    rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    rooms.open(PATH, 'tab-b', baseline('# Deploy'));

    const room = rooms.close(PATH, 'tab-a');
    expect(room).not.toBeNull();
    expect(writerOf(room!)).toBe('tab-b');
  });

  it('discards a room once the last tab leaves', () => {
    const rooms = new DocRooms();
    rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    expect(rooms.close(PATH, 'tab-a')).toBeNull();
    expect(rooms.size).toBe(0);
    expect(rooms.get(PATH)).toBeNull();
  });

  it('takes a disconnected tab out of every room it was in', () => {
    const rooms = new DocRooms();
    rooms.open('a', 'tab-a', baseline('a'));
    rooms.open('b', 'tab-a', baseline('b'));
    rooms.open('b', 'tab-b', baseline('b'));

    expect(rooms.closeAllFor('tab-a').sort()).toEqual(['a', 'b']);
    expect(rooms.get('a')).toBeNull();
    expect(rooms.get('b')?.members).toEqual(['tab-b']);
  });

  it('accepts steps at the head and stamps them with the tab that sent them', () => {
    const rooms = new DocRooms();
    const room = rooms.open(PATH, 'tab-a', baseline('# Deploy'));

    const result = rooms.submit(PATH, 'tab-a', 0, [{ stepType: 'replace' }, { stepType: 'replace' }]);
    expect(result).toEqual({
      ok: true,
      version: 2,
      steps: [
        { step: { stepType: 'replace' }, client: 'tab-a' },
        { step: { stepType: 'replace' }, client: 'tab-a' },
      ],
    });
    expect(versionOf(room)).toBe(2);
  });

  it('turns away steps built on an older version', () => {
    const rooms = new DocRooms();
    rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    rooms.submit(PATH, 'tab-a', 0, [{ stepType: 'replace' }]);

    expect(rooms.submit(PATH, 'tab-b', 0, [{ stepType: 'replace' }])).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(versionOf(rooms.get(PATH)!)).toBe(1);
  });

  it('turns away steps for a room nobody opened', () => {
    const rooms = new DocRooms();
    expect(rooms.submit(PATH, 'tab-a', 0, [{}])).toEqual({ ok: false, reason: 'unknown' });
  });

  it('turns away a batch that would overflow the log', () => {
    const rooms = new DocRooms();
    rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    const full = Array.from({ length: MAX_ROOM_STEPS }, () => ({}));
    expect(rooms.submit(PATH, 'tab-a', 0, full).ok).toBe(true);
    expect(rooms.submit(PATH, 'tab-a', MAX_ROOM_STEPS, [{}])).toEqual({
      ok: false,
      reason: 'overflow',
    });
  });

  it('lets the writer move the baseline forward and throw the log away', () => {
    const rooms = new DocRooms();
    rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    rooms.submit(PATH, 'tab-a', 0, [{}, {}]);

    expect(rooms.rebaseline(PATH, 'tab-a', 2, baseline('# Deployed', 'rev-2'))).toBe(true);
    const room = rooms.get(PATH)!;
    expect(room.steps).toEqual([]);
    expect(room.baseVersion).toBe(2);
    expect(versionOf(room)).toBe(2);
    expect(room.baseline.rev).toBe('rev-2');
  });

  it('refuses a baseline from a tab that is not the writer', () => {
    const rooms = new DocRooms();
    rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    rooms.open(PATH, 'tab-b', baseline('# Deploy'));
    expect(rooms.rebaseline(PATH, 'tab-b', 0, baseline('# Nope', 'rev-2'))).toBe(false);
    expect(rooms.get(PATH)?.baseline.markdown).toBe('# Deploy');
  });

  it('refuses a baseline that is behind the head of the room', () => {
    const rooms = new DocRooms();
    rooms.open(PATH, 'tab-a', baseline('# Deploy'));
    rooms.submit(PATH, 'tab-a', 0, [{}]);
    // The save this reports started before that step landed, so the step would be lost.
    expect(rooms.rebaseline(PATH, 'tab-a', 0, baseline('# Deploy', 'rev-2'))).toBe(false);
    expect(rooms.get(PATH)?.steps).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* The hub end of the same rooms                                       */
/* ------------------------------------------------------------------ */

class FakeSocket {
  readonly sent: ServerMessage[] = [];
  closed = false;

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }

  close(): void {
    this.closed = true;
  }

  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    const found: Extract<ServerMessage, { type: T }>[] = [];
    for (const message of this.sent) {
      if (message.type === type) found.push(message as Extract<ServerMessage, { type: T }>);
    }
    return found;
  }

  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return this.of(type).at(-1);
  }
}

const LOG = { debug: () => undefined } as unknown as FastifyBaseLogger;

const PAGE: Page = {
  id: 'p_aaaaaaaaaaaaaaaaaaaaaaaa',
  path: PATH,
  space: 'eng',
  title: 'Deploy runbook',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  markdown: '# Deploy',
  rev: 'rev-1',
  filePath: '/tmp/content/eng/deploy.md',
  hasChildren: false,
};

function user(id: string): LiveUser {
  return { id, name: id, color: '#3b82f6' };
}

type Client = ReturnType<LiveHub['join']>;

interface Harness {
  hub: LiveHub;
  join: (id: string) => FakeSocket;
  client: (id: string) => Client;
  send: (id: string, message: unknown) => void;
}

/** A hub with one page to hand out, and the tabs that are connected to it. */
function hubWithDocs(markdown = '# Deploy'): Harness {
  const hub = new LiveHub(LOG);
  hub.useDocs((path) => Promise.resolve(path === PATH ? baseline(markdown) : null));

  const clients = new Map<string, Client>();
  const client = (id: string): Client => {
    const found = clients.get(id);
    if (found === undefined) throw new Error(`no client ${id}`);
    return found;
  };

  return {
    hub,
    client,
    join: (id: string): FakeSocket => {
      const socket = new FakeSocket();
      const joined = hub.join(id, socket as unknown as WebSocket, user(id), 1_000);
      clients.set(id, joined);
      hub.receive(joined, JSON.stringify({ type: 'hello', user: user(id) }), 1_000);
      return socket;
    },
    send: (id: string, message: unknown): void => {
      hub.receive(client(id), JSON.stringify(message), 1_000);
    },
  };
}

/** `doc-open` reads the baseline through a promise, so let the microtask queue drain. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('LiveHub documents', () => {
  it('sends a baseline to the tab that opens a page and names it the writer', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();

    expect(a.last('doc-init')).toEqual({
      type: 'doc-init',
      path: PATH,
      baseline: baseline('# Deploy'),
      baseVersion: 0,
      steps: [],
      writer: 'tab-a',
    });
  });

  it('shows a tab the caret an agent put down before that tab arrived', async () => {
    const { hub, join, send } = hubWithDocs();
    // An agent opens a page and puts its caret down. Nobody is reading it yet, so there is no
    // room to broadcast into, and the caret used to be dropped on the floor for good.
    hub.noteAgent(AGENT, PATH, false, Date.now());
    hub.agentCaret(AGENT, PATH, { block: 0, offset: 2 }, { block: 0, offset: 5 });

    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();

    expect(a.last('doc-agent-caret')).toEqual({
      type: 'doc-agent-caret',
      path: PATH,
      client: AGENT.id,
      user: { id: AGENT.id, name: 'Ada', color: colorForId(AGENT.id) },
      agent: AGENT,
      anchor: { block: 0, offset: 2 },
      head: { block: 0, offset: 5 },
    });
  });

  it('does not replay the caret of an agent that has gone quiet', async () => {
    const { hub, join, send } = hubWithDocs();
    hub.noteAgent(AGENT, PATH, false, 0);
    hub.agentCaret(AGENT, PATH, { block: 0, offset: 2 }, { block: 0, offset: 2 });

    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();
    expect(a.last('doc-agent-caret')).toBeUndefined();
  });

  it('tells a page that is not there to give up', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: 'eng/missing' });
    await settle();

    expect(a.last('doc-reset')).toEqual({ type: 'doc-reset', path: 'eng/missing', reason: 'gone' });
    expect(hub.rooms.size).toBe(0);
  });

  it('gives the second tab the same baseline and the log so far', async () => {
    const { hub, join, send } = hubWithDocs();
    join('tab-a');
    const b = join('tab-b');

    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();
    send('tab-a', { type: 'doc-steps', path: PATH, version: 0, steps: [{ n: 1 }] });
    send('tab-b', { type: 'doc-open', path: PATH });
    await settle();

    expect(b.last('doc-init')).toEqual({
      type: 'doc-init',
      path: PATH,
      baseline: baseline('# Deploy'),
      baseVersion: 0,
      steps: [{ step: { n: 1 }, client: 'tab-a' }],
      writer: 'tab-a',
    });
  });

  it('relays accepted steps to everyone in the room, sender included', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    const b = join('tab-b');
    send('tab-a', { type: 'doc-open', path: PATH });
    send('tab-b', { type: 'doc-open', path: PATH });
    await settle();

    send('tab-b', { type: 'doc-steps', path: PATH, version: 0, steps: [{ n: 1 }] });

    const expected = {
      type: 'doc-steps',
      path: PATH,
      version: 1,
      steps: [{ step: { n: 1 }, client: 'tab-b' }],
    };
    expect(a.last('doc-steps')).toEqual(expected);
    // The sender needs it too: prosemirror-collab confirms its own steps this way.
    expect(b.last('doc-steps')).toEqual(expected);
  });

  it('says nothing at all when steps arrive stale', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    const b = join('tab-b');
    send('tab-a', { type: 'doc-open', path: PATH });
    send('tab-b', { type: 'doc-open', path: PATH });
    await settle();

    send('tab-a', { type: 'doc-steps', path: PATH, version: 0, steps: [{ n: 1 }] });
    send('tab-b', { type: 'doc-steps', path: PATH, version: 0, steps: [{ n: 2 }] });

    expect(a.of('doc-steps')).toHaveLength(1);
    expect(b.of('doc-reset')).toHaveLength(0);
    expect(versionOf(hub.rooms.get(PATH)!)).toBe(1);
  });

  it('throws the room away when the log overflows', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();

    let version = 0;
    while (version < MAX_ROOM_STEPS) {
      send('tab-a', { type: 'doc-steps', path: PATH, version, steps: [{}] });
      version += 1;
    }
    send('tab-a', { type: 'doc-steps', path: PATH, version, steps: [{}] });

    expect(a.last('doc-reset')).toEqual({ type: 'doc-reset', path: PATH, reason: 'overflow' });
    expect(hub.rooms.size).toBe(0);
  });

  it('passes a caret to the other tabs but never back to its owner', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    const b = join('tab-b');
    send('tab-a', { type: 'doc-open', path: PATH });
    send('tab-b', { type: 'doc-open', path: PATH });
    await settle();

    send('tab-b', { type: 'doc-caret', path: PATH, anchor: 3, head: 7 });

    expect(a.last('doc-caret')).toEqual({
      type: 'doc-caret',
      path: PATH,
      client: 'tab-b',
      user: user('tab-b'),
      anchor: 3,
      head: 7,
    });
    expect(b.of('doc-caret')).toHaveLength(0);
  });

  it('drops the caret and hands the pen on when a tab closes the page', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    const b = join('tab-b');
    send('tab-a', { type: 'doc-open', path: PATH });
    send('tab-b', { type: 'doc-open', path: PATH });
    await settle();

    send('tab-a', { type: 'doc-close', path: PATH });

    expect(b.last('doc-left')).toEqual({ type: 'doc-left', path: PATH, client: 'tab-a' });
    expect(b.last('doc-writer')).toEqual({ type: 'doc-writer', path: PATH, writer: 'tab-b' });
    expect(a.of('doc-left')).toHaveLength(0);
  });

  it('hands the pen on when a tab disconnects without closing', async () => {
    const { hub, join, send, client } = hubWithDocs();
    join('tab-a');
    const b = join('tab-b');
    send('tab-a', { type: 'doc-open', path: PATH });
    send('tab-b', { type: 'doc-open', path: PATH });
    await settle();

    const gone = client('tab-a');
    hub.leave(gone);

    expect(b.last('doc-writer')).toEqual({ type: 'doc-writer', path: PATH, writer: 'tab-b' });
    expect(hub.rooms.get(PATH)?.members).toEqual(['tab-b']);
  });

  it('compacts the log when the writer reports the text that reached the file', async () => {
    const { hub, join, send } = hubWithDocs();
    join('tab-a');
    const b = join('tab-b');
    send('tab-a', { type: 'doc-open', path: PATH });
    send('tab-b', { type: 'doc-open', path: PATH });
    await settle();
    send('tab-a', { type: 'doc-steps', path: PATH, version: 0, steps: [{ n: 1 }] });

    send('tab-a', {
      type: 'doc-baseline',
      path: PATH,
      version: 1,
      markdown: '# Deployed',
      title: 'Deploy runbook',
      rev: 'rev-2',
    });

    const room = hub.rooms.get(PATH)!;
    expect(room.steps).toEqual([]);
    expect(versionOf(room)).toBe(1);
    // Compaction is silent: nobody's document changed, only what the log is measured from.
    expect(b.of('doc-reset')).toHaveLength(0);
  });

  it('resets the room when the file changes underneath it', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();

    hub.pageChanged(PAGE, 'disk', null);

    expect(a.last('doc-reset')).toEqual({ type: 'doc-reset', path: PATH, reason: 'disk' });
    expect(hub.rooms.size).toBe(0);
  });

  it('keeps the room when the change is the writer saving its own work', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();

    hub.pageChanged(PAGE, 'api', 'tab-a');

    expect(a.of('doc-reset')).toHaveLength(0);
    expect(hub.rooms.size).toBe(1);
  });

  it('resets the room when another tab saves the page over the top', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    join('tab-b');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();

    hub.pageChanged(PAGE, 'api', 'tab-b');

    expect(a.last('doc-reset')).toEqual({ type: 'doc-reset', path: PATH, reason: 'disk' });
  });

  it('resets the room when the page is deleted', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();

    hub.pagesRemoved([PATH]);

    expect(a.last('doc-reset')).toEqual({ type: 'doc-reset', path: PATH, reason: 'gone' });
    expect(hub.rooms.size).toBe(0);
  });

  it('rebuilds the room from the file after a reset', async () => {
    const { hub, join, send } = hubWithDocs();
    const a = join('tab-a');
    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();
    hub.pageChanged(PAGE, 'disk', null);

    send('tab-a', { type: 'doc-open', path: PATH });
    await settle();

    expect(a.of('doc-init')).toHaveLength(2);
    expect(a.last('doc-init')).toMatchObject({ baseVersion: 0, steps: [], writer: 'tab-a' });
  });
});
