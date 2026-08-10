import { z } from 'zod';
import { newUlid } from './ids.js';
import { HandleSchema } from './mentions.js';
import { IsoDateSchema } from './schemas.js';
import { WorkspaceIdSchema } from './workspaces.js';

/**
 * Agents.
 *
 * An agent is a non-human writer: a coding assistant, a nightly job, a chat bot. It gets its
 * own credential instead of borrowing a person's, and it gets an identity: a short brief that
 * says who it is and what it is allowed to write. The remote MCP server reads the credential,
 * finds the agent behind it, and hands that brief back as the server instructions, so an agent
 * connected to tablinum already knows its own role before it calls a single tool.
 */

/** Prefix of an agent id, in the style of the page and user ids. */
export const AGENT_ID_PREFIX = 'ag_';

/**
 * Prefix of an agent token. It is not a secret; it exists so the auth layer can tell an agent
 * credential from an operator token without a database lookup, and so a leaked token is
 * recognisable in a log.
 */
export const AGENT_TOKEN_PREFIX = 'gda_';

/** Where the remote MCP server answers. One endpoint, no session state. */
export const MCP_ENDPOINT = '/api/v1/mcp';

/** Longest identity brief the server stores. Long enough for a role, short of a whole guide. */
export const MAX_IDENTITY_LENGTH = 4000;

const AGENT_ID_RE = /^ag_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export const isAgentId = (value: unknown): value is string =>
  typeof value === 'string' && AGENT_ID_RE.test(value);

/** True for a credential that names an agent rather than the operator. */
export const isAgentToken = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(AGENT_TOKEN_PREFIX);

export const AgentIdSchema = z.string().refine(isAgentId, 'Expected an agent id like "ag_<ULID>"');

export const AgentNameSchema = z.string().trim().min(1).max(60);

export const IdentitySchema = z.string().trim().max(MAX_IDENTITY_LENGTH);

export const AgentSchema = z.object({
  id: AgentIdSchema,
  name: z.string(),
  /** Unique across agents and people, so `@handle` names exactly one writer. */
  handle: z.string(),
  /** Who this agent is, in its own words. Empty until somebody writes one. */
  identity: z.string(),
  /** The one workspace this agent reads and writes. Its token reaches nothing else. */
  workspaceId: WorkspaceIdSchema,
  /** Derived from the id, so an agent looks the same in every browser. */
  color: z.string(),
  /** Revision of its picture, or null while it has none. See avatarUrl(). */
  avatarRev: z.string().nullable(),
  created: IsoDateSchema,
  updated: IsoDateSchema,
  /** When the token was last accepted, or null while the agent has never connected. */
  lastUsed: IsoDateSchema.nullable(),
});

// ---------------------------------------------------------------------------
// request bodies
// ---------------------------------------------------------------------------

export const CreateAgentBodySchema = z.object({
  name: AgentNameSchema,
  identity: IdentitySchema.optional(),
  /** Derived from the name when it is absent. A taken handle gets a numeric suffix. */
  handle: HandleSchema.optional(),
});

export const UpdateAgentBodySchema = z
  .object({
    name: AgentNameSchema.optional(),
    identity: IdentitySchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

export const AgentsResponseSchema = z.object({ agents: z.array(AgentSchema) });
export const AgentResponseSchema = z.object({ agent: AgentSchema });

/** What a create or a token rotation returns. The token appears here once and never again. */
export const AgentTokenResponseSchema = z.object({
  agent: AgentSchema,
  token: z.string().min(1),
  /** Full URL of the remote MCP endpoint, ready to paste into a client config. */
  url: z.string().min(1),
});

// ---------------------------------------------------------------------------
// inferred types
// ---------------------------------------------------------------------------

export type Agent = z.infer<typeof AgentSchema>;
export type CreateAgentBody = z.infer<typeof CreateAgentBodySchema>;
export type UpdateAgentBody = z.infer<typeof UpdateAgentBodySchema>;
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
export type AgentTokenResponse = z.infer<typeof AgentTokenResponseSchema>;

export const newAgentId = (now?: number): string => AGENT_ID_PREFIX + newUlid(now);

/** Where an MCP client points. `origin` is the browser's, so no base URL is configured. */
export function mcpUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${MCP_ENDPOINT}`;
}
