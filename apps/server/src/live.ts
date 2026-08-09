import { randomUUID } from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import {
  CLIENT_HEADER,
  ClientMessageSchema,
  LIVE_PATH,
  LIVE_PING_MS,
  type GitStatus,
  type LivePresence,
  type LiveUser,
  type Page,
  type PagePath,
  type ServerMessage,
} from '@gitdocs/shared';
import type { RouteContext } from './context.js';

/** A socket is dropped once it has been silent for this many heartbeats. */
const MISSED_HEARTBEATS = 3;

const MAX_CLIENT_ID = 64;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface LiveClient {
  id: string;
  socket: WebSocket;
  /** Who this browser says it is. Null until the client sends `hello`. */
  user: LiveUser | null;
  watching: PagePath | null;
  editing: boolean;
  lastSeen: number;
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

/** The tab that sent a REST request, from its `x-gitdocs-client` header. */
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
  #heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly log: FastifyBaseLogger) {}

  get size(): number {
    return this.#clients.size;
  }

  /** Register a socket. An id already in use is disconnected first, so ids stay unique. */
  join(id: string, socket: WebSocket, now: number = Date.now()): LiveClient {
    const existing = this.#clients.get(id);
    if (existing !== undefined) this.leave(existing);

    const client: LiveClient = {
      id,
      socket,
      user: null,
      watching: null,
      editing: false,
      lastSeen: now,
    };
    this.#clients.set(id, client);
    this.#send(client, { type: 'welcome', clientId: id });
    return client;
  }

  leave(client: LiveClient): void {
    const current = this.#clients.get(client.id);
    if (current !== client) return;
    this.#clients.delete(client.id);
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
      client.user = message.user;
      if (client.watching !== null) this.#announcePresence(client.watching);
      return;
    }
    if (message.type === 'editing') {
      if (client.editing === message.editing) return;
      client.editing = message.editing;
      if (client.watching !== null) this.#announcePresence(client.watching);
      return;
    }

    const previous = client.watching;
    if (previous === message.path) return;
    client.watching = message.path;
    // Leaving a page must clear the editing flag, or the next page inherits it.
    client.editing = false;
    if (previous !== null) this.#announcePresence(previous);
    if (client.watching !== null) this.#announcePresence(client.watching);
  }

  /** Tell every tab that a page now holds different bytes. */
  pageChanged(page: Page, source: 'api' | 'disk' | 'pull', by: string | null): void {
    this.#broadcast({
      type: 'page',
      id: page.id,
      path: page.path,
      title: page.title,
      rev: page.rev,
      by,
      source,
    });
  }

  pagesRemoved(paths: PagePath[]): void {
    if (paths.length === 0) return;
    this.#broadcast({ type: 'removed', paths });
  }

  gitChanged(status: GitStatus): void {
    this.#broadcast({ type: 'git', status });
  }

  /** Who is on a page right now. Only tabs that introduced themselves are listed. */
  presence(path: PagePath): LivePresence[] {
    const users: LivePresence[] = [];
    for (const client of this.#clients.values()) {
      if (client.watching !== path || client.user === null) continue;
      users.push({ ...client.user, editing: client.editing });
    }
    return users;
  }

  /** Start the heartbeat. Without it a browser that vanishes stays in the presence list. */
  start(intervalMs: number = LIVE_PING_MS): void {
    if (this.#heartbeat !== null) return;
    this.#heartbeat = setInterval(() => this.sweep(), intervalMs);
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
  }

  #announcePresence(path: PagePath): void {
    const users = this.presence(path);
    for (const client of this.#clients.values()) {
      if (client.watching !== path) continue;
      this.#send(client, { type: 'presence', path, users });
    }
  }

  #broadcast(message: ServerMessage): void {
    for (const client of this.#clients.values()) this.#send(client, message);
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
    const client = ctx.live.join(readClientId(request), socket);
    socket.on('message', (raw: unknown) => {
      ctx.live.receive(client, String(raw));
    });
    socket.on('pong', () => {
      client.lastSeen = Date.now();
    });
    socket.on('close', () => {
      ctx.live.leave(client);
    });
    socket.on('error', () => {
      ctx.live.leave(client);
    });
  });
}
