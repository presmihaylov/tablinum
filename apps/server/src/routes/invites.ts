import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CreateInviteBodySchema,
  InviteIdSchema,
  inviteUrl,
  notFound,
  parseOrThrow,
  type InviteResponse,
  type InvitesResponse,
  type OkResponse,
} from '@tablinum/shared';
import { requireAdmin } from '../auth.js';
import { API_PREFIX, type RouteContext } from '../context.js';

const InviteParamsSchema = z.object({ id: InviteIdSchema });

/** The link is built from the address the admin is already using, so nothing is configured. */
function originOf(request: FastifyRequest): string {
  const host = request.headers.host ?? 'localhost';
  return `${request.protocol}://${host}`;
}

export function registerInviteRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { accounts } = ctx.deps;

  app.get(`${API_PREFIX}/invites`, async (request): Promise<InvitesResponse> => {
    requireAdmin(request);
    // An invite joins one workspace, so an admin only sees the links into this one.
    return { invites: accounts.listInvites().filter((invite) => invite.workspaceId === request.workspace.id) };
  });

  app.post(`${API_PREFIX}/invites`, async (request): Promise<InviteResponse> => {
    requireAdmin(request);
    const body = parseOrThrow(CreateInviteBodySchema, request.body ?? {}, 'invite');
    const issued = accounts.createInvite({
      ...body,
      workspaceId: request.workspace.id,
      createdBy: request.principal.account?.id ?? null,
    });
    // The token is returned once here and is only stored hashed, so the link cannot be re-read.
    return { invite: issued.invite, url: inviteUrl(originOf(request), issued.token) };
  });

  app.delete(`${API_PREFIX}/invites/:id`, async (request): Promise<OkResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(InviteParamsSchema, request.params, 'invite id');
    const invite = accounts.getInvite(id);
    if (invite === null || invite.workspaceId !== request.workspace.id) {
      throw notFound(`No invite with id ${id}`);
    }
    accounts.revokeInvite(id);
    return { ok: true };
  });
}
