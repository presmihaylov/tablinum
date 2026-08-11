import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type { WorkspaceRecord } from '@tablinum/accounts';
import {
  WORKSPACE_COOKIE,
  WORKSPACE_HEADER,
  WORKSPACE_QUERY,
  conflict,
  notFound,
  unauthorized,
} from '@tablinum/shared';
import { isPublicRequest } from './auth.js';
import type { ServerDeps } from './deps.js';
import { LiveHub } from './live.js';
import { privateSpacesOf } from './private.js';
import { Wiring } from './wiring.js';

/**
 * Workspaces on the server.
 *
 * A workspace is one git repository with its own pages, spaces, search index and open tabs.
 * Nothing is shared between two of them except the account database, so a person can be in
 * several and an agent token reaches exactly one. The default workspace is the content
 * directory the server was configured with; every other one is opened on first use through
 * the factory in `deps.openWorkspace` and then kept.
 */

/** Everything one workspace needs to answer a request. */
export interface WorkspaceParts {
  record: WorkspaceRecord;
  store: ServerDeps['store'];
  git: ServerDeps['git'];
  search: ServerDeps['search'];
  wiring: Wiring;
  /** Open tabs looking at this workspace. Each workspace has its own. */
  live: LiveHub;
  /** What the factory wants run on shutdown. The default workspace has none. */
  close?: () => Promise<void>;
}

/** What `deps.openWorkspace` hands back. `close` runs when the server shuts down. */
export interface WorkspaceInstance {
  store: ServerDeps['store'];
  git: ServerDeps['git'];
  search: ServerDeps['search'];
  close?: () => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Which workspace this request is about. Set by the hook below, after the principal. */
    workspace: WorkspaceRecord;
  }
}

/** The workspace the caller asked for by header, query string or cookie, if any. */
export function wantedWorkspace(request: FastifyRequest): string | null {
  const header = request.headers[WORKSPACE_HEADER];
  if (typeof header === 'string' && header.trim().length > 0) return header.trim();

  const query: unknown = request.query;
  if (typeof query === 'object' && query !== null && WORKSPACE_QUERY in query) {
    const value = (query as Record<string, unknown>)[WORKSPACE_QUERY];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }

  // Last, because an image tag in a page is the only caller that can send nothing else.
  const cookie = request.cookies[WORKSPACE_COOKIE];
  if (typeof cookie === 'string' && cookie.trim().length > 0) return cookie.trim();
  return null;
}

export class WorkspaceRegistry {
  readonly #open = new Map<string, Promise<WorkspaceParts>>();
  readonly #opened: ((parts: WorkspaceParts) => void)[] = [];

  constructor(
    private readonly deps: ServerDeps,
    private readonly log: FastifyBaseLogger,
    private readonly fallback: WorkspaceParts,
  ) {}

  /** The workspace the server was configured with. Always openable, never closed early. */
  get default(): WorkspaceParts {
    return this.fallback;
  }

  /** Run `listener` whenever a workspace is opened, so the bootstrap can start its watcher. */
  onOpened(listener: (parts: WorkspaceParts) => void): void {
    this.#opened.push(listener);
  }

  /** Every workspace this caller may open. Operator credentials reach all of them. */
  allowedFor(request: FastifyRequest): WorkspaceRecord[] {
    const { accounts } = this.deps;
    const { account, agent, admin } = request.principal;
    // An agent token reaches exactly one workspace, so it must not list the others.
    if (agent !== null) {
      const owned = accounts.getWorkspace(agent.workspaceId);
      return owned === null ? [] : [owned];
    }
    if (admin) return accounts.listWorkspaces();
    if (account === null) return [];
    return accounts.listWorkspacesFor(account.id);
  }

  /** Which workspace a request is about, without opening it. */
  resolve(request: FastifyRequest): WorkspaceRecord {
    // An agent token names one workspace. No header can point it at another.
    const agent = request.principal.agent;
    if (agent !== null) {
      const owned = this.deps.accounts.getWorkspace(agent.workspaceId);
      if (owned === null) throw notFound('The workspace this agent belongs to is gone');
      return owned;
    }

    const allowed = this.allowedFor(request);
    const wanted = wantedWorkspace(request);
    if (wanted === null) {
      const first = allowed[0];
      if (first !== undefined) return first;
      // Somebody whose last membership was taken away gets a refusal, not the default one.
      if (request.principal.account !== null) throw unauthorized('You are not in any workspace');
      throw notFound('This server has no workspace yet');
    }

    const found = allowed.find((entry) => entry.id === wanted || entry.slug === wanted);
    if (found !== undefined) return found;
    // Saying "not a member" would confirm the workspace exists, so both answers look alike.
    if (request.principal.account !== null) throw unauthorized(`You cannot open ${wanted}`);
    throw notFound(`No workspace called ${wanted}`);
  }

  /** Open a workspace, building its parts on first use. */
  async open(record: WorkspaceRecord): Promise<WorkspaceParts> {
    if (record.id === this.fallback.record.id) return this.fallback;

    const already = this.#open.get(record.id);
    if (already !== undefined) return already;

    const factory = this.deps.openWorkspace;
    if (factory === undefined) {
      throw conflict('This server is not set up to open more than one workspace');
    }

    const pending = this.#build(record, factory);
    this.#open.set(record.id, pending);
    // A workspace that fails to open must not stay cached as a broken promise.
    pending.catch(() => this.#open.delete(record.id));
    return pending;
  }

  async #build(
    record: WorkspaceRecord,
    factory: NonNullable<ServerDeps['openWorkspace']>,
  ): Promise<WorkspaceParts> {
    const instance = await factory(record);
    await instance.store.init();
    await instance.git.init();
    await instance.search.init();

    const live = new LiveHub(this.log);
    live.useDocs(async (path) => {
      try {
        const page = await instance.store.getPageByPath(path);
        return page === null ? null : { markdown: page.markdown, title: page.title, rev: page.rev };
      } catch {
        return null;
      }
    });
    live.useSpaces(() => privateSpacesOf(instance.store));
    live.start();

    const scoped: ServerDeps = { ...this.deps, ...instance };
    const parts: WorkspaceParts = {
      record,
      store: instance.store,
      git: instance.git,
      search: instance.search,
      wiring: new Wiring(scoped, this.log, live),
      live,
      ...(instance.close === undefined ? {} : { close: instance.close }),
    };

    const indexed = await parts.wiring.reindexAll();
    this.log.info({ workspace: record.slug, pages: indexed }, 'workspace opened');
    for (const listener of this.#opened) listener(parts);
    return parts;
  }

  /** The parts for the workspace this request is about. */
  async of(request: FastifyRequest): Promise<WorkspaceParts> {
    return this.open(request.workspace);
  }

  /** Parts by id, for the routes that name a workspace in the path. */
  async byId(id: string): Promise<WorkspaceParts> {
    const record = this.deps.accounts.getWorkspace(id);
    if (record === null) throw notFound(`No workspace with id ${id}`);
    return this.open(record);
  }

  /** Every workspace that is open right now, the default one first. Nothing is opened here. */
  async openParts(): Promise<WorkspaceParts[]> {
    return [this.fallback, ...(await Promise.all([...this.#open.values()]))];
  }

  /**
   * Every workspace this server has, the default one first, opening whatever is still closed.
   *
   * The difference from openParts() above is the whole point of the second name. Opening a
   * workspace inits its store, its repo and its index and then reindexes every page in it, so
   * this belongs to a mutation somebody asked for and never to a read. A workspace that cannot
   * be opened is skipped: a server built with a single content directory refuses to open a
   * second one, and that must not stop the caller.
   */
  async everyParts(): Promise<WorkspaceParts[]> {
    const parts: WorkspaceParts[] = [this.fallback];
    for (const record of this.deps.accounts.listWorkspaces()) {
      if (record.id === this.fallback.record.id) continue;
      const opened = await this.open(record).catch((err: unknown) => {
        this.log.warn({ workspace: record.slug, err }, 'workspace skipped, it would not open');
        return null;
      });
      if (opened !== null) parts.push(opened);
    }
    return parts;
  }

  /** Forget a workspace after it is deleted, so its files can be removed. */
  async release(id: string): Promise<void> {
    const pending = this.#open.get(id);
    if (pending === undefined) return;
    this.#open.delete(id);
    const parts = await pending.catch(() => null);
    if (parts === null) return;
    parts.live.closeAll();
    if (parts.close !== undefined) await parts.close();
    await parts.git.stop();
    await parts.search.close();
  }

  /** Close every workspace opened on demand. The default one belongs to the caller. */
  async closeAll(): Promise<void> {
    const ids = [...this.#open.keys()];
    for (const id of ids) await this.release(id);
  }
}

/**
 * Resolve the workspace for every request. Registered after the auth hook, because an agent
 * token decides the workspace and the principal is what carries it.
 */
export function registerWorkspaceHook(app: FastifyInstance, registry: WorkspaceRegistry): void {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    // A public endpoint answers before anybody has proved anything, so it must not be a way
    // to ask which workspaces exist. It always gets the default one.
    request.workspace = isPublicRequest(request) ? registry.default.record : registry.resolve(request);
  });
}
