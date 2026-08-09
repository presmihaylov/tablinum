import { z } from 'zod';
import type { GitStatus, PageId, PagePath } from './types.js';

/** WebSocket endpoint every browser tab holds open while the app is on screen. */
export const LIVE_PATH = '/api/v1/live';

/**
 * Header that names the tab a request came from. The live channel echoes it back on the
 * broadcast, so the tab that made the change does not reload its own edit.
 */
export const CLIENT_HEADER = 'x-gitdocs-client';

/** How often a client pings. The server drops a socket that stops answering. */
export const LIVE_PING_MS = 25_000;

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

export interface LivePresence extends LiveUser {
  /** True while this person has unsaved edits in the page. */
  editing: boolean;
}

export const LiveUserSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(40),
  color: z.string().min(1).max(24),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), user: LiveUserSchema }),
  z.object({ type: z.literal('watch'), path: z.string().min(1).max(512).nullable() }),
  z.object({ type: z.literal('editing'), editing: z.boolean() }),
  z.object({ type: z.literal('ping') }),
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
  /** How the change reached the server. */
  source: 'api' | 'disk' | 'pull';
}

export type ServerMessage =
  | { type: 'welcome'; clientId: string }
  | PageChangedMessage
  | { type: 'removed'; paths: PagePath[] }
  | { type: 'presence'; path: PagePath; users: LivePresence[] }
  | { type: 'git'; status: GitStatus }
  | { type: 'pong' };
