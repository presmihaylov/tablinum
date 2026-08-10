import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AccountStore } from '@tablinum/accounts';
import {
  AgentIdSchema,
  CreateAgentBodySchema,
  UpdateAgentBodySchema,
  avatarUrl,
  mcpUrl,
  notFound,
  parseOrThrow,
  type Agent,
  type AgentResponse,
  type AgentTokenResponse,
  type AgentsResponse,
  type AvatarResponse,
  type OkResponse,
} from '@tablinum/shared';
import { requireAdmin } from '../auth.js';
import { AvatarQuerySchema, readAvatarUpload, sendAvatar } from '../avatars.js';
import { API_PREFIX, partsOf, type RouteContext } from '../context.js';

const AgentParamsSchema = z.object({ id: AgentIdSchema });

/** The agent behind a path parameter, but only when it belongs to this workspace. */
function agentIn(accounts: AccountStore, workspaceId: string, id: string): Agent {
  const agent = accounts.getAgent(id);
  if (agent === null || agent.workspaceId !== workspaceId) throw notFound(`No agent with id ${id}`);
  return agent;
}

/** Built from the address the admin is already using, so no base URL is configured. */
function originOf(request: FastifyRequest): string {
  const host = request.headers.host ?? 'localhost';
  return `${request.protocol}://${host}`;
}

export function registerAgentRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { accounts } = ctx.deps;

  app.get(`${API_PREFIX}/agents`, async (request): Promise<AgentsResponse> => {
    requireAdmin(request);
    // An agent belongs to one workspace, so this lists the current one only.
    return { agents: accounts.listAgents(request.workspace.id) };
  });

  app.post(`${API_PREFIX}/agents`, async (request): Promise<AgentTokenResponse> => {
    requireAdmin(request);
    const body = parseOrThrow(CreateAgentBodySchema, request.body ?? {}, 'agent');
    const issued = accounts.createAgent({ ...body, workspaceId: request.workspace.id });
    // The token is returned once here and is only stored hashed, so it cannot be re-read.
    return { agent: issued.agent, token: issued.token, url: mcpUrl(originOf(request)) };
  });

  app.patch(`${API_PREFIX}/agents/:id`, async (request): Promise<AgentResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(AgentParamsSchema, request.params, 'agent id');
    const patch = parseOrThrow(UpdateAgentBodySchema, request.body ?? {}, 'agent patch');
    agentIn(accounts, request.workspace.id, id);
    return { agent: accounts.updateAgent(id, patch) };
  });

  app.delete(`${API_PREFIX}/agents/:id`, async (request): Promise<OkResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(AgentParamsSchema, request.params, 'agent id');
    agentIn(accounts, request.workspace.id, id);
    accounts.deleteAgent(id);
    // A deleted agent has no way back onto a page, so its chip goes with it.
    const { live } = await partsOf(ctx, request);
    live.dropAgent(id);
    return { ok: true };
  });

  /**
   * An agent's picture. Every caller may read it, exactly like a person's: it is what a presence
   * chip and a byline draw.
   */
  app.get(`${API_PREFIX}/agents/:id/avatar`, async (request, reply): Promise<FastifyReply> => {
    const { id } = parseOrThrow(AgentParamsSchema, request.params, 'agent id');
    const query = parseOrThrow(AvatarQuerySchema, request.query, 'query');
    const avatar = accounts.getAvatar(id);
    if (avatar === null) throw notFound('That agent has no avatar');
    return sendAvatar(reply, avatar, query.v);
  });

  app.post(`${API_PREFIX}/agents/:id/avatar`, async (request): Promise<AvatarResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(AgentParamsSchema, request.params, 'agent id');
    agentIn(accounts, request.workspace.id, id);
    const image = await readAvatarUpload(request);
    const rev = accounts.setAvatar(id, image.mime, image.bytes);
    return { url: avatarUrl(id, rev), rev };
  });

  app.delete(`${API_PREFIX}/agents/:id/avatar`, async (request): Promise<OkResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(AgentParamsSchema, request.params, 'agent id');
    agentIn(accounts, request.workspace.id, id);
    accounts.clearAvatar(id);
    return { ok: true };
  });

  app.post(`${API_PREFIX}/agents/:id/token`, async (request): Promise<AgentTokenResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(AgentParamsSchema, request.params, 'agent id');
    agentIn(accounts, request.workspace.id, id);
    const issued = accounts.rotateAgentToken(id);
    return { agent: issued.agent, token: issued.token, url: mcpUrl(originOf(request)) };
  });
}
