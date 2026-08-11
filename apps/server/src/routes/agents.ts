import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AccountStore } from '@tablinum/accounts';
import {
  AgentIdSchema,
  CreateAgentBodySchema,
  UpdateAgentBodySchema,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
  avatarUrl,
  mcpUrl,
  notFound,
  parseOrThrow,
  webhookKeyId,
  type Agent,
  type AgentResponse,
  type AgentTokenResponse,
  type AgentsResponse,
  type AvatarResponse,
  type OkResponse,
  type WebhookSigningResponse,
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

  /**
   * Who else writes here. Everybody in the workspace may read this, not only an admin: a
   * comment card and a byline both have to turn an agent id into a name and a picture. Making
   * one is still an admin's job.
   */
  app.get(`${API_PREFIX}/agents`, async (request): Promise<AgentsResponse> => {
    // The auth hook already turned away a caller with no credentials.
    // An agent belongs to one workspace, so this lists the current one only.
    return { agents: accounts.listAgents(request.workspace.id) };
  });

  /**
   * How an agent webhook is signed, so a receiver can be built against it. Everything here is
   * public by design: the key id is a hash of the secret, never the secret.
   */
  app.get(`${API_PREFIX}/webhooks/signing`, async (): Promise<WebhookSigningResponse> => {
    const secret = ctx.deps.config.webhookSecret;
    return {
      enabled: secret !== null,
      algorithm: 'hmac-sha256',
      keyId: secret === null ? null : await webhookKeyId(secret),
      signatureHeader: WEBHOOK_SIGNATURE_HEADER,
      eventHeader: WEBHOOK_EVENT_HEADER,
      deliveryHeader: WEBHOOK_DELIVERY_HEADER,
      toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS,
    };
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
