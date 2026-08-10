import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CursorDesk } from './cursors.js';
import type { ServerDeps } from './deps.js';
import type { LiveHub } from './live.js';
import type { MentionNotifier } from './mentions.js';
import { guardPrivateSpaces, viewerOf } from './private.js';
import type { SlackApi } from './slack.js';
import type { Wiring } from './wiring.js';
import type { WorkspaceParts, WorkspaceRegistry } from './workspaces.js';

/** Everything a route module needs. Passed explicitly so nothing is decorated globally. */
export interface RouteContext {
  deps: ServerDeps;
  /** Every workspace this server can open. A route reads content through it, never through deps. */
  workspaces: WorkspaceRegistry;
  /** The default workspace's write path. The bootstrap and the watcher use this one. */
  wiring: Wiring;
  /** Open browser tabs in the default workspace. */
  live: LiveHub;
  /** Where each caller left its caret. An agent has nowhere else to keep one. */
  cursors: CursorDesk;
  /** Tells people they were named on a page. Delivery is off without a Slack token. */
  mentions: MentionNotifier;
  /** Null when no Slack bot token is configured. */
  slack: SlackApi | null;
  version: string;
}

/** Prefix every endpoint in the contract lives under. */
export const API_PREFIX = '/api/v1';

/**
 * The content, git, search and live parts of the workspace this request is about.
 *
 * The store comes back wrapped so a private space somebody else owns is simply not there. Every
 * route reads content through here, so the guard covers routes written later too; the raw store
 * stays reachable through `ctx.workspaces` for the watcher and the git layer, which are not
 * anybody's request.
 */
export async function partsOf(ctx: RouteContext, request: FastifyRequest): Promise<WorkspaceParts> {
  const parts = await ctx.workspaces.of(request);
  return { ...parts, store: guardPrivateSpaces(parts.store, viewerOf(request)) };
}

/** The same parts with nothing filtered out. Only for work that belongs to no one viewer. */
export function rawPartsOf(ctx: RouteContext, request: FastifyRequest): Promise<WorkspaceParts> {
  return ctx.workspaces.of(request);
}

// Keeps buildApp()'s signature free of extra return values while still letting the bootstrap
// reach the Wiring the routes use, which is what the filesystem watcher must share.
const CONTEXTS = new WeakMap<FastifyInstance, RouteContext>();

export function rememberContext(app: FastifyInstance, ctx: RouteContext): void {
  CONTEXTS.set(app, ctx);
}

/** The context buildApp() built for this instance, or null for a foreign instance. */
export function contextOf(app: FastifyInstance): RouteContext | null {
  return CONTEXTS.get(app) ?? null;
}
