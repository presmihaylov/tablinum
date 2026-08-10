import { z } from 'zod';
import type { Cursor } from './editing.js';
import type { GitStatus, PageId, PagePath } from './types.js';

/** A comment thread on a page was written, edited, resolved or removed. */
export interface CommentsChangedMessage {
  type: 'comments';
  pageId: PageId;
  /** The tab that caused the change, so it does not refetch its own write. */
  by: string | null;
}

/** WebSocket endpoint every browser tab holds open while the app is on screen. */
export const LIVE_PATH = '/api/v1/live';

/**
 * Header that names the tab a request came from. The live channel echoes it back on the
 * broadcast, so the tab that made the change does not reload its own edit.
 */
export const CLIENT_HEADER = 'x-tablinum-client';

/** How often a client pings. The server drops a socket that stops answering. */
export const LIVE_PING_MS = 25_000;

/**
 * How long an agent stays on a page after the tool call that put it there. An agent has no
 * socket to go quiet, so its seat is held on this timer instead of on a heartbeat.
 */
export const AGENT_PRESENCE_MS = 60_000;

/** Presence colours, picked by the browser and kept for the life of the profile. */
export const LIVE_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

/** Who is on a page. There are no accounts, so a browser names itself. */
export interface LiveUser {
  /** Stable per browser profile. */
  id: string;
  name: string;
  color: string;
}

/**
 * The agent behind a change or a presence chip. An agent works over MCP and holds no socket,
 * so the server puts it on the page itself and takes it off again when it goes quiet.
 */
export interface LiveAgent {
  id: string;
  name: string;
  handle: string;
  /** Revision of its picture, or null while it has none. See avatarUrl(). */
  avatarRev: string | null;
}

export interface LivePresence extends LiveUser {
  /** True while this participant has the page in hand. */
  editing: boolean;
  /** The agent this participant is, or null for a browser tab. */
  agent: LiveAgent | null;
}

export const LiveUserSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(40),
  color: z.string().min(1).max(24),
});

/**
 * One editing step and the tab that made it. The step is a ProseMirror step in its JSON form;
 * the server orders and relays them without ever looking inside, so it needs no schema.
 */
export interface DocStep {
  step: unknown;
  client: string;
}

/** The markdown a room's step log is applied on top of. */
export interface DocBaseline {
  markdown: string;
  title: string;
  rev: string;
}

/**
 * A room compacts its log every time the writer saves, so a log this long means nobody has
 * saved in a very long time. The room restarts rather than grow without a bound.
 */
export const MAX_ROOM_STEPS = 400;

/** Steps in one submission. A burst of typing is a handful; this only bounds abuse. */
export const MAX_STEPS_PER_MESSAGE = 100;

/** Why a room told its members to start again. */
export type DocResetReason = 'disk' | 'overflow' | 'gone';

const DocPathSchema = z.string().min(1).max(512);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), user: LiveUserSchema }),
  z.object({ type: z.literal('watch'), path: z.string().min(1).max(512).nullable() }),
  z.object({ type: z.literal('editing'), editing: z.boolean() }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('doc-open'), path: DocPathSchema }),
  z.object({ type: z.literal('doc-close'), path: DocPathSchema }),
  z.object({
    type: z.literal('doc-steps'),
    path: DocPathSchema,
    version: z.number().int().min(0),
    steps: z.array(z.unknown()).min(1).max(MAX_STEPS_PER_MESSAGE),
  }),
  z.object({
    type: z.literal('doc-caret'),
    path: DocPathSchema,
    anchor: z.number().int().min(0),
    head: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('doc-baseline'),
    path: DocPathSchema,
    version: z.number().int().min(0),
    markdown: z.string(),
    title: z.string().max(400),
    rev: z.string().min(1).max(128),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** A page changed on disk, whoever changed it. */
export interface PageChangedMessage {
  type: 'page';
  id: PageId;
  path: PagePath;
  title: string;
  /** Fingerprint of the new body, so a client can tell whether it already has it. */
  rev: string;
  /** The client that caused the change, when it came in over the API. */
  by: string | null;
  /** The agent that made the change, or null when a person did. */
  agent: LiveAgent | null;
  /** How the change reached the server. */
  source: 'api' | 'disk' | 'pull';
}

export type ServerMessage =
  | { type: 'welcome'; clientId: string }
  | PageChangedMessage
  | { type: 'removed'; paths: PagePath[] }
  | CommentsChangedMessage
  | { type: 'presence'; path: PagePath; users: LivePresence[] }
  | { type: 'git'; status: GitStatus }
  | { type: 'pong' }
  /** Everything a tab needs to build the shared document and start streaming. */
  | {
      type: 'doc-init';
      path: PagePath;
      baseline: DocBaseline;
      /** The version the baseline sits at, before the steps below. */
      baseVersion: number;
      steps: DocStep[];
      writer: string | null;
    }
  /** Steps accepted by the authority. `version` is the version after applying them. */
  | { type: 'doc-steps'; path: PagePath; version: number; steps: DocStep[] }
  | { type: 'doc-caret'; path: PagePath; client: string; user: LiveUser; anchor: number; head: number }
  /**
   * An agent moved its caret. It is said in blocks and offsets rather than in document positions,
   * because an agent works on the markdown of a page and has never seen the tab's document.
   */
  | {
      type: 'doc-agent-caret';
      path: PagePath;
      client: string;
      user: LiveUser;
      agent: LiveAgent;
      anchor: Cursor;
      head: Cursor;
    }
  /** The tab that now writes the file. Everyone else streams without saving. */
  | { type: 'doc-writer'; path: PagePath; writer: string | null }
  /** The shared document is no longer valid; rejoin from the file on disk. */
  | { type: 'doc-reset'; path: PagePath; reason: DocResetReason }
  /** A tab left the page, so its caret must be taken off screen. */
  | { type: 'doc-left'; path: PagePath; client: string };
