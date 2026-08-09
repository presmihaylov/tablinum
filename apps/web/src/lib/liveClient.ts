import { LIVE_PATH, LIVE_PING_MS, type ClientMessage, type PagePath, type ServerMessage } from '@gitdocs/shared';
import { myClientId, myUser } from './identity';

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;
/** Ping ahead of the server sweep, so a healthy tab is never dropped. */
const PING_MS = Math.max(LIVE_PING_MS - 5_000, 5_000);

export type MessageListener = (message: ServerMessage) => void;
export type StatusListener = (connected: boolean) => void;

function liveUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${LIVE_PATH}?client=${encodeURIComponent(myClientId())}`;
}

function parse(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    if (typeof (value as { type?: unknown }).type !== 'string') return null;
    return value as ServerMessage;
  } catch {
    return null;
  }
}

/**
 * The tab's end of the live channel. It reconnects on its own and replays what it was
 * watching, so a dropped socket costs nothing but a short gap.
 */
export class LiveConnection {
  #socket: WebSocket | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #ping: ReturnType<typeof setInterval> | null = null;
  #attempt = 0;
  #stopped = false;
  #watching: PagePath | null = null;
  #editing = false;

  readonly #messages = new Set<MessageListener>();
  readonly #statuses = new Set<StatusListener>();

  constructor(private readonly url: () => string = liveUrl) {}

  get connected(): boolean {
    return this.#socket !== null && this.#socket.readyState === WebSocket.OPEN;
  }

  start(): void {
    this.#stopped = false;
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    this.#clearRetry();
    this.#clearPing();
    const socket = this.#socket;
    this.#socket = null;
    try {
      socket?.close();
    } catch {
      // Already gone.
    }
  }

  /** Follow a page. The server uses it for presence only. */
  watch(path: PagePath | null): void {
    if (this.#watching === path) return;
    this.#watching = path;
    // The server clears the flag on a page change; keep both ends in step.
    this.#editing = false;
    this.#send({ type: 'watch', path });
  }

  setEditing(editing: boolean): void {
    if (this.#editing === editing) return;
    this.#editing = editing;
    this.#send({ type: 'editing', editing });
  }

  onMessage(listener: MessageListener): () => void {
    this.#messages.add(listener);
    return () => {
      this.#messages.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.#statuses.add(listener);
    return () => {
      this.#statuses.delete(listener);
    };
  }

  #open(): void {
    if (this.#stopped || this.#socket !== null) return;
    if (typeof WebSocket !== 'function') return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url());
    } catch {
      this.#scheduleRetry();
      return;
    }
    this.#socket = socket;

    socket.onopen = (): void => {
      this.#attempt = 0;
      this.#announce(true);
      this.#send({ type: 'hello', user: myUser() });
      this.#send({ type: 'watch', path: this.#watching });
      if (this.#editing) this.#send({ type: 'editing', editing: true });
      this.#startPing();
    };

    socket.onmessage = (event: MessageEvent): void => {
      const message = parse(event.data);
      if (message === null) return;
      for (const listener of [...this.#messages]) listener(message);
    };

    socket.onclose = (): void => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#clearPing();
      this.#announce(false);
      this.#scheduleRetry();
    };

    socket.onerror = (): void => {
      try {
        socket.close();
      } catch {
        // onclose still fires and drives the retry.
      }
    };
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#retry !== null) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.#attempt, RECONNECT_MAX_MS);
    this.#attempt += 1;
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.#open();
    }, delay);
  }

  #startPing(): void {
    this.#clearPing();
    this.#ping = setInterval(() => this.#send({ type: 'ping' }), PING_MS);
  }

  #clearPing(): void {
    if (this.#ping === null) return;
    clearInterval(this.#ping);
    this.#ping = null;
  }

  #clearRetry(): void {
    if (this.#retry === null) return;
    clearTimeout(this.#retry);
    this.#retry = null;
  }

  #announce(connected: boolean): void {
    for (const listener of [...this.#statuses]) listener(connected);
  }

  #send(message: ClientMessage): void {
    if (!this.connected) return;
    try {
      this.#socket?.send(JSON.stringify(message));
    } catch {
      // The socket died between the check and the send; the retry loop handles it.
    }
  }
}
