import type {
  Cursor,
  DocBaseline,
  DocResetReason,
  DocStep,
  LiveAgent,
  LiveUser,
  PagePath,
  ServerMessage,
} from '@tablinum/shared';
import { myClientId } from './identity';
import type { LiveConnection } from './liveClient';

/** Everything needed to build the shared document and start streaming into it. */
export interface DocInit {
  baseline: DocBaseline;
  baseVersion: number;
  steps: DocStep[];
  writer: string | null;
}

export interface RemoteCaret {
  /** The tab the caret belongs to. One person with two tabs has two carets. */
  client: string;
  user: LiveUser;
  anchor: number;
  head: number;
}

/** An agent's caret. It counts blocks and characters of markdown, not document positions. */
export interface AgentCaret {
  client: string;
  user: LiveUser;
  agent: LiveAgent;
  anchor: Cursor;
  head: Cursor;
}

export interface DocRoomHandlers {
  onInit?: (init: DocInit) => void;
  onSteps?: (steps: DocStep[]) => void;
  onCaret?: (caret: RemoteCaret) => void;
  onAgentCaret?: (caret: AgentCaret) => void;
  onLeft?: (client: string) => void;
  onWriter?: (writer: string | null) => void;
  /** The shared document is gone. Reload the page and rejoin. */
  onReset?: (reason: DocResetReason) => void;
}

/**
 * One page's end of the step stream. It carries no document of its own: the editor holds the
 * ProseMirror state, and this only moves steps and carets between it and the authority.
 */
export class DocRoom {
  readonly #handlers = new Set<DocRoomHandlers>();
  #off: (() => void) | null;
  #closed = false;
  #writer: string | null = null;
  #joined = false;

  constructor(
    private readonly connection: LiveConnection,
    readonly path: PagePath,
    handlers?: DocRoomHandlers,
  ) {
    if (handlers !== undefined) this.#handlers.add(handlers);
    this.#off = connection.onMessage((message) => this.#receive(message));
    connection.openDoc(path);
  }

  /** The tab that saves this page. Null until the room says who it is. */
  get writer(): string | null {
    return this.#writer;
  }

  /** True while this tab is the one that writes the file. */
  get isWriter(): boolean {
    return this.#writer !== null && this.#writer === myClientId();
  }

  /** True once the baseline has arrived, which is when streaming really starts. */
  get joined(): boolean {
    return this.#joined;
  }

  /**
   * Add a set of callbacks. The shell and the editor both listen: the shell decides who
   * saves, the editor moves the steps. Returns a function that removes them again.
   */
  listen(handlers: DocRoomHandlers): () => void {
    this.#handlers.add(handlers);
    return () => {
      this.#handlers.delete(handlers);
    };
  }

  #emit(call: (handlers: DocRoomHandlers) => void): void {
    for (const handlers of [...this.#handlers]) call(handlers);
  }

  /** Ask for a fresh baseline after the room was thrown away. */
  rejoin(): void {
    if (this.#closed) return;
    this.connection.openDoc(this.path);
  }

  sendSteps(version: number, steps: unknown[]): void {
    if (this.#closed || steps.length === 0) return;
    this.connection.sendDoc({ type: 'doc-steps', path: this.path, version, steps });
  }

  sendCaret(anchor: number, head: number): void {
    if (this.#closed) return;
    this.connection.sendDoc({ type: 'doc-caret', path: this.path, anchor, head });
  }

  /** Report text that is now on disk, so the room can throw its step log away. */
  sendBaseline(version: number, baseline: DocBaseline): void {
    if (this.#closed) return;
    this.connection.sendDoc({ type: 'doc-baseline', path: this.path, version, ...baseline });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#off?.();
    this.#off = null;
    this.connection.closeDoc(this.path);
  }

  #receive(message: ServerMessage): void {
    if (this.#closed) return;
    if (!('path' in message) || message.path !== this.path) return;

    if (message.type === 'doc-init') {
      const init: DocInit = {
        baseline: message.baseline,
        baseVersion: message.baseVersion,
        steps: message.steps,
        writer: message.writer,
      };
      this.#joined = true;
      this.#setWriter(message.writer);
      this.#emit((handlers) => handlers.onInit?.(init));
      return;
    }
    if (message.type === 'doc-steps') {
      this.#emit((handlers) => handlers.onSteps?.(message.steps));
      return;
    }
    if (message.type === 'doc-caret') {
      const caret: RemoteCaret = {
        client: message.client,
        user: message.user,
        anchor: message.anchor,
        head: message.head,
      };
      this.#emit((handlers) => handlers.onCaret?.(caret));
      return;
    }
    if (message.type === 'doc-agent-caret') {
      const caret: AgentCaret = {
        client: message.client,
        user: message.user,
        agent: message.agent,
        anchor: message.anchor,
        head: message.head,
      };
      this.#emit((handlers) => handlers.onAgentCaret?.(caret));
      return;
    }
    if (message.type === 'doc-left') {
      this.#emit((handlers) => handlers.onLeft?.(message.client));
      return;
    }
    if (message.type === 'doc-writer') {
      this.#setWriter(message.writer);
      return;
    }
    if (message.type !== 'doc-reset') return;
    this.#joined = false;
    this.#emit((handlers) => handlers.onReset?.(message.reason));
  }

  #setWriter(writer: string | null): void {
    if (this.#writer === writer) return;
    this.#writer = writer;
    this.#emit((handlers) => handlers.onWriter?.(writer));
  }
}
