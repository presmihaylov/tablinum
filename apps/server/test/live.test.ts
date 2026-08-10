import { describe, expect, it } from 'vitest';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import {
  AGENT_PRESENCE_MS,
  colorForId,
  type GitStatus,
  type LiveAgent,
  type LiveUser,
  type Page,
  type ServerMessage,
} from '@tablinum/shared';
import { LiveHub, agentOf, clientOf, readClientId } from '../src/live.js';

/** A socket that records what the hub wrote to it. */
class FakeSocket {
  readonly sent: ServerMessage[] = [];
  closed = false;

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }

  close(): void {
    this.closed = true;
  }

  /** The last message of a kind, which is the only one presence assertions care about. */
  last(type: ServerMessage['type']): ServerMessage | undefined {
    return [...this.sent].reverse().find((message) => message.type === type);
  }

  count(type: ServerMessage['type']): number {
    return this.sent.filter((message) => message.type === type).length;
  }
}

const LOG = {
  debug: () => undefined,
} as unknown as FastifyBaseLogger;

function asSocket(socket: FakeSocket): WebSocket {
  return socket as unknown as WebSocket;
}

function user(id: string, name: string): LiveUser {
  return { id, name, color: '#3b82f6' };
}

function join(
  hub: LiveHub,
  id: string,
  identity: LiveUser | null = null,
  now = 1_000,
): { socket: FakeSocket; client: ReturnType<LiveHub['join']> } {
  const socket = new FakeSocket();
  const client = hub.join(id, asSocket(socket), identity, now);
  return { socket, client };
}

function send(hub: LiveHub, client: ReturnType<LiveHub['join']>, message: unknown, now = 1_000): void {
  hub.receive(client, JSON.stringify(message), now);
}

const PAGE: Page = {
  id: 'p_aaaaaaaaaaaaaaaaaaaaaaaa',
  path: 'eng/deploy',
  space: 'eng',
  title: 'Deploy runbook',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  markdown: '# Deploy',
  rev: 'rev-1',
  filePath: '/tmp/content/eng/deploy.md',
  hasChildren: false,
};

describe('LiveHub', () => {
  it('welcomes a tab and counts it', () => {
    const hub = new LiveHub(LOG);
    const { socket } = join(hub, 'tab-a');
    expect(hub.size).toBe(1);
    expect(socket.sent[0]).toEqual({ type: 'welcome', clientId: 'tab-a' });
  });

  it('replaces a tab that reconnects with the same id, and closes the old socket', () => {
    const hub = new LiveHub(LOG);
    const me = user('u1', 'Quiet Otter');
    const first = join(hub, 'tab-a', me);
    const second = join(hub, 'tab-a', me);
    expect(hub.size).toBe(1);
    // The displaced tab is told, so it reconnects instead of typing into a dead socket.
    expect(first.socket.closed).toBe(true);
    expect(second.client.id).toBe('tab-a');
    expect(second.socket.sent[0]?.type).toBe('welcome');
  });

  it('never hands one person a tab id another person holds', () => {
    const hub = new LiveHub(LOG);
    const victim = join(hub, 'tab-a', user('u1', 'Quiet Otter'));
    const thief = join(hub, 'tab-a', user('u2', 'Bright Lynx'));

    expect(hub.size).toBe(2);
    expect(victim.socket.closed).toBe(false);
    expect(thief.client.id).not.toBe('tab-a');
    expect(thief.socket.sent[0]).toEqual({ type: 'welcome', clientId: thief.client.id });
  });

  it('shows the person the credential names, not the one the hello frame claims', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a', user('u1', 'Quiet Otter'));

    send(hub, a.client, { type: 'hello', user: user('us_victim', 'Alice Chen') });
    send(hub, a.client, { type: 'watch', path: 'eng/deploy' });

    expect(hub.presence('eng/deploy')).toEqual([
      { ...user('u1', 'Quiet Otter'), editing: false, agent: null },
    ]);
  });

  it('leaves a tab with no account out of presence, whatever it says hello with', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a');

    send(hub, a.client, { type: 'hello', user: user('us_victim', 'Alice Chen') });
    send(hub, a.client, { type: 'watch', path: 'eng/deploy' });

    expect(hub.presence('eng/deploy')).toEqual([]);
  });

  it('lists everyone who introduced themselves and watches the page', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a', user('u1', 'Quiet Otter'));
    const b = join(hub, 'tab-b', user('u2', 'Bright Lynx'));

    send(hub, a.client, { type: 'hello', user: user('u1', 'Quiet Otter') });
    send(hub, a.client, { type: 'watch', path: 'eng/deploy' });
    send(hub, b.client, { type: 'hello', user: user('u2', 'Bright Lynx') });
    send(hub, b.client, { type: 'watch', path: 'eng/deploy' });

    expect(hub.presence('eng/deploy').map((entry) => entry.id)).toEqual(['u1', 'u2']);
    expect(a.socket.last('presence')).toEqual({
      type: 'presence',
      path: 'eng/deploy',
      users: [
        { ...user('u1', 'Quiet Otter'), editing: false, agent: null },
        { ...user('u2', 'Bright Lynx'), editing: false, agent: null },
      ],
    });
  });

  it('leaves out a tab that never said hello', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a', user('u1', 'Quiet Otter'));
    send(hub, a.client, { type: 'watch', path: 'eng/deploy' });
    expect(hub.presence('eng/deploy')).toEqual([]);
  });

  it('tells the other tabs when someone starts editing', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a', user('u1', 'u1'));
    const b = join(hub, 'tab-b', user('u2', 'u2'));
    for (const [tab, id] of [
      [a, 'u1'],
      [b, 'u2'],
    ] as const) {
      send(hub, tab.client, { type: 'hello', user: user(id, id) });
      send(hub, tab.client, { type: 'watch', path: 'eng/deploy' });
    }

    const before = b.socket.count('presence');
    send(hub, a.client, { type: 'editing', editing: true });
    expect(b.socket.count('presence')).toBe(before + 1);
    expect(hub.presence('eng/deploy').find((entry) => entry.id === 'u1')?.editing).toBe(true);

    // The same flag twice is not news, so nothing is broadcast.
    send(hub, a.client, { type: 'editing', editing: true });
    expect(b.socket.count('presence')).toBe(before + 1);
  });

  it('clears the editing flag when a tab moves to another page', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a', user('u1', 'u1'));
    send(hub, a.client, { type: 'hello', user: user('u1', 'u1') });
    send(hub, a.client, { type: 'watch', path: 'eng/deploy' });
    send(hub, a.client, { type: 'editing', editing: true });

    send(hub, a.client, { type: 'watch', path: 'eng/oncall' });
    expect(hub.presence('eng/deploy')).toEqual([]);
    expect(hub.presence('eng/oncall')[0]?.editing).toBe(false);
  });

  it('answers a ping', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a');
    send(hub, a.client, { type: 'ping' });
    expect(a.socket.last('pong')).toEqual({ type: 'pong' });
  });

  it('ignores a frame it cannot read', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a');
    hub.receive(a.client, 'not json');
    hub.receive(a.client, JSON.stringify({ type: 'nonsense' }));
    expect(hub.size).toBe(1);
    expect(a.socket.sent).toHaveLength(1);
  });

  it('broadcasts a page change to every tab, watching or not', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a');
    const b = join(hub, 'tab-b');
    hub.pageChanged(PAGE, 'api', 'tab-a');

    for (const socket of [a.socket, b.socket]) {
      expect(socket.last('page')).toEqual({
        type: 'page',
        id: PAGE.id,
        path: PAGE.path,
        title: PAGE.title,
        rev: PAGE.rev,
        by: 'tab-a',
        agent: null,
        source: 'api',
      });
    }
  });

  it('says nothing when no page was removed', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a');
    hub.pagesRemoved([]);
    expect(a.socket.count('removed')).toBe(0);
    hub.pagesRemoved(['eng/deploy']);
    expect(a.socket.count('removed')).toBe(1);
  });

  it('broadcasts a comment change to every tab and names the one that caused it', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a');
    const b = join(hub, 'tab-b');
    hub.commentsChanged(PAGE.id, 'tab-a');

    for (const socket of [a.socket, b.socket]) {
      expect(socket.last('comments')).toEqual({ type: 'comments', pageId: PAGE.id, by: 'tab-a' });
    }

    // A write with no tab behind it, such as an MCP call, still reaches every tab.
    hub.commentsChanged(PAGE.id, null);
    expect(a.socket.last('comments')).toEqual({ type: 'comments', pageId: PAGE.id, by: null });
    expect(a.socket.count('comments')).toBe(2);
  });

  it('broadcasts the git status', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a');
    const status: GitStatus = {
      branch: 'main',
      ahead: 1,
      behind: 0,
      dirtyFiles: [],
      remote: 'origin',
      lastCommit: null,
      conflict: null,
    };
    hub.gitChanged(status);
    expect(a.socket.last('git')).toEqual({ type: 'git', status });
  });

  it('drops a tab that stopped answering and tells the page it was on', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a', user('u1', 'u1'), 0);
    const b = join(hub, 'tab-b', user('u2', 'u2'), 0);
    for (const [tab, id] of [
      [a, 'u1'],
      [b, 'u2'],
    ] as const) {
      send(hub, tab.client, { type: 'hello', user: user(id, id) }, 0);
      send(hub, tab.client, { type: 'watch', path: 'eng/deploy' }, 0);
    }

    send(hub, b.client, { type: 'ping' }, 100_000);
    hub.sweep(100_000, 1_000);

    expect(hub.size).toBe(1);
    expect(a.socket.closed).toBe(true);
    expect(hub.presence('eng/deploy').map((entry) => entry.id)).toEqual(['u2']);
  });

  it('closes every socket on shutdown', () => {
    const hub = new LiveHub(LOG);
    const a = join(hub, 'tab-a');
    hub.start(10_000);
    hub.closeAll();
    expect(hub.size).toBe(0);
    expect(a.socket.closed).toBe(true);
  });

  it('survives a socket that throws on send', () => {
    const hub = new LiveHub(LOG);
    const broken = {
      send: () => {
        throw new Error('socket is gone');
      },
      close: () => undefined,
    } as unknown as WebSocket;
    expect(() => hub.join('tab-a', broken)).not.toThrow();
    expect(() => hub.pagesRemoved(['eng/deploy'])).not.toThrow();
  });
});

describe('agents on a page', () => {
  const ADA: LiveAgent = { id: 'ag_01ADA', name: 'Ada', handle: 'ada', avatarRev: null };

  /** A tab that says hello and watches `path`, which is what makes it hear presence. */
  function watcher(hub: LiveHub, id: string, path: string, now = 1_000) {
    const tab = join(hub, id, user(id, id), now);
    send(hub, tab.client, { type: 'hello', user: user(id, id) }, now);
    send(hub, tab.client, { type: 'watch', path }, now);
    return tab;
  }

  it('seats an agent on the page it touched and tells the tabs there', () => {
    const hub = new LiveHub(LOG);
    const tab = watcher(hub, 'tab-a', 'eng/deploy');
    const before = tab.socket.count('presence');

    hub.noteAgent(ADA, 'eng/deploy', true, 1_000);

    expect(tab.socket.count('presence')).toBe(before + 1);
    expect(hub.presence('eng/deploy', 1_000)).toContainEqual({
      id: ADA.id,
      name: 'Ada',
      color: colorForId(ADA.id),
      editing: true,
      agent: ADA,
    });
  });

  it('moves the seat when the agent turns to another page', () => {
    const hub = new LiveHub(LOG);
    const first = watcher(hub, 'tab-a', 'eng/deploy');
    const second = watcher(hub, 'tab-b', 'eng/oncall');

    hub.noteAgent(ADA, 'eng/deploy', false, 1_000);
    const seen = first.socket.count('presence');
    hub.noteAgent(ADA, 'eng/oncall', true, 2_000);

    expect(hub.presence('eng/deploy', 2_000).map((entry) => entry.id)).toEqual(['tab-a']);
    expect(hub.presence('eng/oncall', 2_000).map((entry) => entry.id)).toEqual(['tab-b', ADA.id]);
    // The page it left hears about it too, or the chip stays on that screen for good.
    expect(first.socket.count('presence')).toBe(seen + 1);
    expect(second.socket.last('presence')).toMatchObject({ path: 'eng/oncall' });
  });

  it('gives the seat up once the agent goes quiet', () => {
    const hub = new LiveHub(LOG);
    const tab = watcher(hub, 'tab-a', 'eng/deploy', 0);
    hub.noteAgent(ADA, 'eng/deploy', true, 0);

    const lapsed = AGENT_PRESENCE_MS + 1;
    expect(hub.presence('eng/deploy', lapsed).map((entry) => entry.id)).toEqual(['tab-a']);

    const before = tab.socket.count('presence');
    // The tab is answering, so only the agent is swept.
    send(hub, tab.client, { type: 'ping' }, lapsed);
    hub.sweep(lapsed, 1_000);
    expect(hub.size).toBe(1);
    expect(tab.socket.count('presence')).toBe(before + 1);
    expect(tab.socket.last('presence')).toEqual({ type: 'presence', path: 'eng/deploy', users: [
      { ...user('tab-a', 'tab-a'), editing: false, agent: null },
    ] });
  });

  it('takes an agent off every page at once', () => {
    const hub = new LiveHub(LOG);
    watcher(hub, 'tab-a', 'eng/deploy');
    hub.noteAgent(ADA, 'eng/deploy', true, 1_000);
    hub.dropAgent(ADA.id);
    expect(hub.presence('eng/deploy', 1_000).map((entry) => entry.id)).toEqual(['tab-a']);
    // An agent that was never seated is not an error.
    expect(() => hub.dropAgent('ag_nobody')).not.toThrow();
  });

  it('names the agent on the page broadcast', () => {
    const hub = new LiveHub(LOG);
    const tab = join(hub, 'tab-a');
    hub.pageChanged(PAGE, 'api', null, ADA);
    expect(tab.socket.last('page')).toMatchObject({ type: 'page', agent: ADA, by: null });
  });
});

describe('client ids', () => {
  function request(query: unknown, headers: Record<string, string | string[]> = {}): FastifyRequest {
    return { query, headers, principal: { agent: null } } as unknown as FastifyRequest;
  }

  it('reads the agent behind a request, and nothing else about it', () => {
    const agent = { id: 'ag_01ADA', name: 'Ada', handle: 'ada', identity: 'A tidy writer' };
    const asAgent = { query: {}, headers: {}, principal: { agent } } as unknown as FastifyRequest;
    expect(agentOf(asAgent)).toEqual({ id: 'ag_01ADA', name: 'Ada', handle: 'ada' });
    expect(agentOf(request({}))).toBeNull();
  });

  it('takes the tab id off the upgrade url', () => {
    expect(readClientId(request({ client: 'tab-a' }))).toBe('tab-a');
  });

  it('mints one when the url has none or carries junk', () => {
    expect(readClientId(request({}))).toMatch(/^[0-9a-f-]{36}$/);
    expect(readClientId(request({ client: 'a b/c' }))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reads the tab id from the rest header', () => {
    expect(clientOf(request({}, { 'x-tablinum-client': 'tab-a' }))).toBe('tab-a');
    expect(clientOf(request({}, { 'x-tablinum-client': ['tab-b'] }))).toBe('tab-b');
    expect(clientOf(request({}, {}))).toBeNull();
    expect(clientOf(request({}, { 'x-tablinum-client': 'no spaces allowed' }))).toBeNull();
  });
});

/**
 * A socket must not be a way around the REST guard. The hub keeps a snapshot of which spaces
 * are private, and every message it sends about a page is checked against it.
 */
describe('LiveHub and private spaces', () => {
  const PRIVATE_PAGE: Page = {
    ...PAGE,
    id: 'p_bbbbbbbbbbbbbbbbbbbbbbbb',
    path: 'notes/salary',
    space: 'notes',
    title: 'Salary',
    filePath: '/tmp/content/notes/salary.md',
  };

  /** A hub that knows `notes` belongs to u1. */
  async function hubWithNotes(): Promise<LiveHub> {
    const hub = new LiveHub(LOG);
    hub.useSpaces(async () => new Map([['notes', 'u1']]));
    await hub.spacesChanged();
    return hub;
  }

  it('tells only the owner that a private page changed', async () => {
    const hub = await hubWithNotes();
    const mine = join(hub, 'tab-a', user('u1', 'Quiet Otter'));
    const theirs = join(hub, 'tab-b', user('u2', 'Loud Badger'));
    const token = join(hub, 'tab-c');

    hub.pageChanged(PRIVATE_PAGE, 'disk', null);

    expect(mine.socket.count('page')).toBe(1);
    expect(theirs.socket.count('page')).toBe(0);
    expect(token.socket.count('page')).toBe(0);
  });

  it('still tells everybody about a public page', async () => {
    const hub = await hubWithNotes();
    const theirs = join(hub, 'tab-b', user('u2', 'Loud Badger'));

    hub.pageChanged(PAGE, 'disk', null);

    expect(theirs.socket.count('page')).toBe(1);
  });

  it('names a deleted private page only to the owner', async () => {
    const hub = await hubWithNotes();
    const mine = join(hub, 'tab-a', user('u1', 'Quiet Otter'));
    const theirs = join(hub, 'tab-b', user('u2', 'Loud Badger'));

    hub.pagesRemoved(['notes/salary', 'eng/deploy']);

    expect(mine.socket.last('removed')).toEqual({
      type: 'removed',
      paths: ['notes/salary', 'eng/deploy'],
    });
    expect(theirs.socket.last('removed')).toEqual({ type: 'removed', paths: ['eng/deploy'] });
  });

  it('sends no removed message at all when nothing visible went away', async () => {
    const hub = await hubWithNotes();
    const theirs = join(hub, 'tab-b', user('u2', 'Loud Badger'));

    hub.pagesRemoved(['notes/salary']);

    expect(theirs.socket.count('removed')).toBe(0);
  });

  it('ignores a watch on a private page, so presence never leaks either', async () => {
    const hub = await hubWithNotes();
    const mine = join(hub, 'tab-a', user('u1', 'Quiet Otter'));
    const theirs = join(hub, 'tab-b', user('u2', 'Loud Badger'));

    send(hub, theirs.client, { type: 'watch', path: 'notes/salary' });
    expect(theirs.client.watching).toBeNull();

    send(hub, mine.client, { type: 'watch', path: 'notes/salary' });
    expect(mine.client.watching).toBe('notes/salary');
    expect(theirs.socket.count('presence')).toBe(0);
  });
});
