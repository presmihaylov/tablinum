import { randomUUID } from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import {
  AGENT_PRESENCE_MS,
  CLIENT_HEADER,
  ClientMessageSchema,
  LIVE_PATH,
  LIVE_PING_MS,
  colorForId,
  spaceOf,
  type ClientMessage,
  type DocBaseline,
  type DocResetReason,
  type GitStatus,
  type LiveAgent,
  type LivePresence,
  type LiveUser,
  type Page,
  type PageId,
  type PagePath,
  type ServerMessage,
} from '@tablinum/shared';
import type { RouteContext } from './context.js';
import { DocRooms, writerOf, type DocRoom } from './docroom.js';

/** Reads the markdown a new room starts from. Null when the page is gone. */
export type BaselineLoader = (path: PagePath) => Promise<DocBaseline | null>;

/** Reads which spaces are private, as slug -> owner user id. Public spaces are left out. */
export type OwnerLoader = () => Promise<Map<string, string>>;

type DocMessage = Extract<ClientMessage, { type: `doc-${string}` }>;

/** A socket is dropped once it has been silent for this many heartbeats. */
const MISSED_HEARTBEATS = 3;

const MAX_CLIENT_ID = 64;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface LiveClient {
  id: string;
  socket: WebSocket;
  /** Who the credential says this tab is. Null for a machine credential, which shows no chip. */
  identity: LiveUser | null;
  /** Who this browser is on the page. Null until the client sends `hello`. */
  user: LiveUser | null;
  watching: PagePath | null;
  editing: boolean;
  lastSeen: number;
}

/** An agent on a page. It holds no socket, so the seat is given up on a timer instead. */
interface AgentSeat {
  agent: LiveAgent;
  path: PagePath;
  /** True once the agent has written the page, rather than only read it. */
  editing: boolean;
  expiresAt: number;
}

/** Read the tab id off the upgrade URL. Tabs mint their own, so an odd one is replaced. */
export function readClientId(request: FastifyRequest): string {
  const query: unknown = request.query;
  const raw =
    typeof query === 'object' && query !== null && 'client' in query
      ? (query as { client: unknown }).client
      : null;
  if (typeof raw !== 'string') return randomUUID();
  const trimmed = raw.trim().slice(0, MAX_CLIENT_ID);
  return CLIENT_ID_RE.test(trimmed) ? trimmed : randomUUID();
}

/** The agent behind a request, in the shape the live channel broadcasts. Null for a person. */
export function agentOf(request: FastifyRequest): LiveAgent | null {
  const agent = request.principal.agent;
  if (agent === null) return null;
  return { id: agent.id, name: agent.name, handle: agent.handle };
}

/** The tab that sent a REST request, from its `x-tablinum-client` header. */
export function clientOf(request: FastifyRequest): string | null {
  const raw = request.headers[CLIENT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_CLIENT_ID);
  return CLIENT_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Every open browser tab, and what each one is looking at. The hub is the only thing that
 * writes to a socket, so a broadcast can never interleave with a reply.
 */
export class LiveHub {
  readonly #clients = new Map<string, LiveClient>();
  /** Agents on a page, by agent id. An agent holds one seat, on the page it touched last. */
  readonly #agents = new Map<string, AgentSeat>();
  readonly #rooms = new DocRooms();
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #loadBaseline: BaselineLoader | null = null;
  #loadOwners: OwnerLoader | null = null;
  /** Slug -> owner for every private space. A slug that is absent is public. */
  #owners = new Map<string, string>();

  constructor(private readonly log: FastifyBaseLogger) {}

  get size(): number {
    return this.#clients.size;
  }

  get rooms(): DocRooms {
    return this.#rooms;
  }

  /** Turn keystroke streaming on. Without a loader the hub only does presence and broadcasts. */
  useDocs(load: BaselineLoader): void {
    this.#loadBaseline = load;
  }

  /**
   * Teach the hub which spaces are private, so a socket is not a way around the REST guard.
   * The snapshot is kept rather than read per message, because every broadcast consults it.
   */
  useSpaces(load: OwnerLoader): void {
    this.#loadOwners = load;
    void this.spacesChanged();
  }

  /** Read the private spaces again. Called after one is made, and on every heartbeat. */
  async spacesChanged(): Promise<void> {
    if (this.#loadOwners === null) return;
    try {
      this.#owners = await this.#loadOwners();
    } catch (err) {
      // Keeping the last snapshot is the safe failure: it hides what it hid a moment ago.
      this.log.debug({ err }, 'could not read the private spaces');
    }
  }

  /** True when this tab may see a page. A space nobody owns is public. */
  #canSee(client: LiveClient, path: PagePath): boolean {
    const owner = this.#owners.get(spaceOf(path));
    if (owner === undefined) return true;
    return client.identity !== null && client.identity.id === owner;
  }

  /**
   * Register a socket. A tab that reconnects with its own id replaces its older self, so ids
   * stay unique. An id somebody else holds is not handed over: the newcomer is renamed instead,
   * or one member could evict another member's tab by naming its id on the upgrade url.
   */
  join(
    id: string,
    socket: WebSocket,
    identity: LiveUser | null = null,
    now: number = Date.now(),
  ): LiveClient {
    const existing = this.#clients.get(id);
    const taken = existing !== undefined && (existing.identity?.id ?? null) !== (identity?.id ?? null);
    const key = taken ? randomUUID() : id;
    if (existing !== undefined && !taken) {
      this.leave(existing);
      // The displaced tab must notice, or it types into a socket the hub no longer knows.
      this.#close(existing);
    }

    const client: LiveClient = {
      id: key,
      socket,
      identity,
      user: null,
      watching: null,
      editing: false,
      lastSeen: now,
    };
    this.#clients.set(key, client);
    this.#send(client, { type: 'welcome', clientId: key });
    return client;
  }

  leave(client: LiveClient): void {
    const current = this.#clients.get(client.id);
    if (current !== client) return;
    this.#clients.delete(client.id);
    for (const path of this.#rooms.closeAllFor(client.id)) this.#afterLeaveRoom(path, client.id);
    if (client.watching !== null) this.#announcePresence(client.watching);
  }

  /** Handle one frame. Anything unparseable is dropped: a bad frame must not kill the tab. */
  receive(client: LiveClient, raw: string, now: number = Date.now()): void {
    client.lastSeen = now;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) return;
    const message = result.data;

    if (message.type === 'ping') {
      this.#send(client, { type: 'pong' });
      return;
    }
    if (message.type === 'hello') {
      // The credential decides who this tab is. The frame only says the tab is ready.
      client.user = client.identity;
      if (client.watching !== null) this.#announcePresence(client.watching);
      return;
    }
    if (message.type === 'editing') {
      if (client.editing === message.editing) return;
      client.editing = message.editing;
      if (client.watching !== null) this.#announcePresence(client.watching);
      return;
    }
    if (
      message.type === 'doc-open' ||
      message.type === 'doc-close' ||
      message.type === 'doc-steps' ||
      message.type === 'doc-caret' ||
      message.type === 'doc-baseline'
    ) {
      this.#receiveDoc(client, message);
      return;
    }
    if (message.type !== 'watch') return;
    // A null path is a tab leaving every page, which needs no permission.
    if (message.path !== null && !this.#canSee(client, message.path)) return;

    const previous = client.watching;
    if (previous === message.path) return;
    client.watching = message.path;
    // Leaving a page must clear the editing flag, or the next page inherits it.
    client.editing = false;
    if (previous !== null) this.#announcePresence(previous);
    if (client.watching !== null) this.#announcePresence(client.watching);
  }

  /**
   * Put an agent on a page, or keep it there. `editing` says it wrote the page rather than
   * only read it. The seat lapses on its own, because an agent never says goodbye.
   */
  noteAgent(agent: LiveAgent, path: PagePath, editing: boolean, now: number = Date.now()): void {
    const previous = this.#agents.get(agent.id);
    this.#agents.set(agent.id, {
      agent,
      path,
      editing,
      expiresAt: now + AGENT_PRESENCE_MS,
    });
    if (previous !== undefined && previous.path !== path) {
      this.#announcePresence(previous.path, now);
    }
    this.#announcePresence(path, now);
  }

  /** Take an agent off every page at once, e.g. when its token is revoked. */
  dropAgent(agentId: string): void {
    const seat = this.#agents.get(agentId);
    if (seat === undefined) return;
    this.#agents.delete(agentId);
    this.#announcePresence(seat.path);
  }

  /** Tell every tab that a page now holds different bytes. */
  pageChanged(
    page: Page,
    source: 'api' | 'disk' | 'pull',
    by: string | null,
    agent: LiveAgent | null = null,
  ): void {
    this.#broadcast(
      {
        type: 'page',
        id: page.id,
        path: page.path,
        title: page.title,
        rev: page.rev,
        by,
        agent,
        source,
      },
      page.path,
    );

    // The writer's own save is the one change a room already knows about. Anything else -
    // an agent, a text editor, a pull - moved the file under the room, so it starts again.
    const room = this.#rooms.get(page.path);
    if (room === null) return;
    if (source === 'api' && by !== null && by === writerOf(room)) return;
    this.#resetRoom(page.path, 'disk');
  }

  /**
   * Tell every tab that the comments on a page moved. Only the page is named, because a tab
   * that is not on that page ignores it and a tab that is refetches the threads anyway.
   */
  commentsChanged(pageId: PageId, by: string | null): void {
    this.#broadcast({ type: 'comments', pageId, by });
  }

  pagesRemoved(paths: PagePath[]): void {
    for (const path of paths) this.#resetRoom(path, 'gone');
    if (paths.length === 0) return;
    // One delete can span spaces, so each tab hears about the paths it could see.
    for (const client of this.#clients.values()) {
      const visible = paths.filter((path) => this.#canSee(client, path));
      if (visible.length > 0) this.#send(client, { type: 'removed', paths: visible });
    }
  }

  gitChanged(status: GitStatus): void {
    this.#broadcast({ type: 'git', status });
  }

  /** Who is on a page right now: tabs that introduced themselves, plus agents at work. */
  presence(path: PagePath, now: number = Date.now()): LivePresence[] {
    const users: LivePresence[] = [];
    for (const client of this.#clients.values()) {
      if (client.watching !== path || client.user === null) continue;
      users.push({ ...client.user, editing: client.editing, agent: null });
    }
    for (const seat of this.#agents.values()) {
      if (seat.path !== path || seat.expiresAt <= now) continue;
      users.push({
        id: seat.agent.id,
        name: seat.agent.name,
        color: colorForId(seat.agent.id),
        editing: seat.editing,
        agent: seat.agent,
      });
    }
    return users;
  }

  /** Start the heartbeat. Without it a browser that vanishes stays in the presence list. */
  start(intervalMs: number = LIVE_PING_MS): void {
    if (this.#heartbeat !== null) return;
    this.#heartbeat = setInterval(() => {
      this.sweep();
      void this.spacesChanged();
    }, intervalMs);
    this.#heartbeat.unref?.();
  }

  stop(): void {
    if (this.#heartbeat === null) return;
    clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  /** Drop tabs that have gone quiet, and close the rest down. */
  closeAll(): void {
    this.stop();
    this.#rooms.clear();
    this.#agents.clear();
    for (const client of [...this.#clients.values()]) {
      this.#clients.delete(client.id);
      this.#close(client);
    }
  }

  sweep(now: number = Date.now(), intervalMs: number = LIVE_PING_MS): void {
    const deadline = now - intervalMs * MISSED_HEARTBEATS;
    for (const client of [...this.#clients.values()]) {
      if (client.lastSeen >= deadline) continue;
      this.leave(client);
      this.#close(client);
    }
    this.#expireAgents(now);
  }

  /** Take lapsed agents off the pages they were on, and tell the tabs still there. */
  #expireAgents(now: number): void {
    const emptied = new Set<PagePath>();
    for (const [id, seat] of this.#agents) {
      if (seat.expiresAt > now) continue;
      this.#agents.delete(id);
      emptied.add(seat.path);
    }
    for (const path of emptied) this.#announcePresence(path, now);
  }

  /** One frame about a shared document. Anything the room cannot honour ends in a reset. */
  #receiveDoc(client: LiveClient, message: DocMessage): void {
    if (message.type === 'doc-open') {
      void this.#openRoom(client, message.path);
      return;
    }
    if (message.type === 'doc-close') {
      const room = this.#rooms.close(message.path, client.id);
      this.#afterLeaveRoom(message.path, client.id, room);
      return;
    }
    if (message.type === 'doc-caret') {
      this.#relayCaret(client, message.path, message.anchor, message.head);
      return;
    }
    if (message.type === 'doc-baseline') {
      this.#rooms.rebaseline(message.path, client.id, message.version, {
        markdown: message.markdown,
        title: message.title,
        rev: message.rev,
      });
      return;
    }

    const result = this.#rooms.submit(message.path, client.id, message.version, message.steps);
    if (result.ok) {
      const room = this.#rooms.get(message.path);
      if (room !== null) {
        this.#toRoom(room, { type: 'doc-steps', path: message.path, version: result.version, steps: result.steps });
      }
      return;
    }
    // A stale submission is normal: the tab rebases against the steps it is about to receive
    // and sends again. The other two mean the room can no longer serve this tab.
    if (result.reason === 'stale') return;
    this.#resetRoom(message.path, result.reason === 'overflow' ? 'overflow' : 'gone');
  }

  async #openRoom(client: LiveClient, path: PagePath): Promise<void> {
    const load = this.#loadBaseline;
    if (load === null) return;

    // Before the cached baseline, or a space made since the last refresh would read as public.
    await this.spacesChanged();
    if (!this.#canSee(client, path)) return;

    const existing = this.#rooms.get(path);
    let baseline = existing?.baseline ?? null;
    if (baseline === null) {
      try {
        baseline = await load(path);
      } catch (err) {
        this.log.debug({ err, path }, 'could not read the baseline for a room');
        return;
      }
    }
    // The tab may have navigated away while the file was read.
    if (baseline === null || this.#clients.get(client.id) !== client) {
      if (baseline === null) this.#send(client, { type: 'doc-reset', path, reason: 'gone' });
      return;
    }

    const room = this.#rooms.open(path, client.id, baseline);
    this.#send(client, {
      type: 'doc-init',
      path,
      baseline: room.baseline,
      baseVersion: room.baseVersion,
      steps: room.steps,
      writer: writerOf(room),
    });
    this.#toRoom(room, { type: 'doc-writer', path, writer: writerOf(room) }, client.id);
  }

  #relayCaret(client: LiveClient, path: PagePath, anchor: number, head: number): void {
    const room = this.#rooms.get(path);
    if (room === null || client.user === null) return;
    if (!room.members.includes(client.id)) return;
    this.#toRoom(room, { type: 'doc-caret', path, client: client.id, user: client.user, anchor, head }, client.id);
  }

  /** Take a tab's caret off the other screens, and hand the pen on if it was the writer. */
  #afterLeaveRoom(path: PagePath, clientId: string, room: DocRoom | null = this.#rooms.get(path)): void {
    if (room === null) return;
    this.#toRoom(room, { type: 'doc-left', path, client: clientId });
    this.#toRoom(room, { type: 'doc-writer', path, writer: writerOf(room) });
  }

  #resetRoom(path: PagePath, reason: DocResetReason): void {
    const room = this.#rooms.drop(path);
    if (room === null) return;
    this.#toRoom(room, { type: 'doc-reset', path, reason });
  }

  /** Send to everyone in a room. `except` skips the tab that caused the message. */
  #toRoom(room: DocRoom, message: ServerMessage, except?: string): void {
    for (const id of room.members) {
      if (id === except) continue;
      const client = this.#clients.get(id);
      if (client !== undefined) this.#send(client, message);
    }
  }

  #announcePresence(path: PagePath, now: number = Date.now()): void {
    const users = this.presence(path, now);
    for (const client of this.#clients.values()) {
      if (client.watching !== path) continue;
      this.#send(client, { type: 'presence', path, users });
    }
  }

  /** Send to every tab. With a `path`, only to the tabs that may see that page. */
  #broadcast(message: ServerMessage, path: PagePath | null = null): void {
    for (const client of this.#clients.values()) {
      if (path !== null && !this.#canSee(client, path)) continue;
      this.#send(client, message);
    }
  }

  #send(client: LiveClient, message: ServerMessage): void {
    try {
      client.socket.send(JSON.stringify(message));
    } catch (err) {
      this.log.debug({ err, client: client.id }, 'live send failed');
    }
  }

  #close(client: LiveClient): void {
    try {
      client.socket.close();
    } catch {
      // Already gone.
    }
  }
}

export function registerLiveRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(LIVE_PATH, { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    // Each workspace has its own hub, and opening one can take a moment, so anything the tab
    // sends in the meantime is held rather than dropped.
    let hub: LiveHub | null = null;
    let client: LiveClient | null = null;
    const queued: string[] = [];

    // Read before the workspace promise resolves, while the request is still the credential's.
    const me = request.principal.account;
    const identity: LiveUser | null =
      me === null ? null : { id: me.id, name: me.name, color: me.color };

    socket.on('message', (raw: unknown) => {
      const text = String(raw);
      if (hub === null || client === null) {
        queued.push(text);
        return;
      }
      hub.receive(client, text);
    });
    socket.on('pong', () => {
      if (client !== null) client.lastSeen = Date.now();
    });
    socket.on('close', () => {
      if (hub !== null && client !== null) hub.leave(client);
    });
    socket.on('error', () => {
      if (hub !== null && client !== null) hub.leave(client);
    });

    void ctx.workspaces
      .of(request)
      .then((parts) => {
        if (socket.readyState !== socket.OPEN) return;
        hub = parts.live;
        client = hub.join(readClientId(request), socket, identity);
        for (const text of queued.splice(0)) hub.receive(client, text);
      })
      .catch((err: unknown) => {
        request.log.warn({ err }, 'a live connection asked for a workspace it cannot open');
        socket.close();
      });
  });
}
