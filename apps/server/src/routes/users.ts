import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/multipart';
import { z } from 'zod';
import {
  ChangePasswordBodySchema,
  ConnectSlackBodySchema,
  MAX_AVATAR_BYTES,
  UpdateMeBodySchema,
  UpdateUserBodySchema,
  UserIdSchema,
  avatarUrl,
  conflict,
  notFound,
  parseOrThrow,
  unauthorized,
  validation,
  type AvatarResponse,
  type MeResponse,
  type OkResponse,
  type SlackStateResponse,
  type UserResponse,
  type UsersResponse,
} from '@tablinum/shared';
import { requireAccount, requireAdmin, setAccountCookie } from '../auth.js';
import { API_PREFIX, type RouteContext } from '../context.js';

const UserParamsSchema = z.object({ id: UserIdSchema });
const AvatarQuerySchema = z.object({ v: z.string().optional() });

/** An avatar is addressed by its rev, so a hit on that URL can never be stale. */
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';

function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https';
}

/** Read the single image part of a multipart avatar upload. */
async function readAvatar(request: FastifyRequest): Promise<{ mime: string; bytes: Buffer }> {
  if (!request.isMultipart()) throw validation('Expected a multipart/form-data upload');

  let picked: { mime: string; bytes: Buffer } | null = null;
  for await (const part of request.parts()) {
    if (part.type === 'field') continue;
    if (picked !== null) throw validation('Upload exactly one image per request');
    const bytes = await part.toBuffer();
    if (part.file.truncated) throw validation('That image is too large for an avatar');
    picked = { mime: part.mimetype, bytes };
  }

  if (picked === null) throw validation('The upload contains no file part');
  if (picked.bytes.length > MAX_AVATAR_BYTES) {
    throw validation(`An avatar must be ${MAX_AVATAR_BYTES} bytes or smaller`);
  }
  return picked;
}

export function registerUserRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { accounts } = ctx.deps;

  app.get(`${API_PREFIX}/me`, async (request): Promise<MeResponse> => {
    return { user: request.principal.account };
  });

  app.patch(`${API_PREFIX}/me`, async (request): Promise<UserResponse> => {
    const me = requireAccount(request);
    const body = parseOrThrow(UpdateMeBodySchema, request.body, 'profile');
    return { user: accounts.updateUser(me.id, body) };
  });

  app.post(`${API_PREFIX}/me/password`, async (request, reply): Promise<OkResponse> => {
    const me = requireAccount(request);
    const body = parseOrThrow(ChangePasswordBodySchema, request.body, 'password change');
    if (!accounts.checkPassword(me.id, body.current)) {
      throw unauthorized('That is not your current password');
    }

    accounts.setPassword(me.id, body.next);
    // Every other browser is signed out, which is the point of changing a password.
    accounts.destroySessionsFor(me.id);
    const session = accounts.createSession(me.id);
    setAccountCookie(reply, session.token, isSecureRequest(request));
    return { ok: true };
  });

  app.post(`${API_PREFIX}/me/avatar`, async (request): Promise<AvatarResponse> => {
    const me = requireAccount(request);
    const image = await readAvatar(request);
    const rev = accounts.setAvatar(me.id, image.mime, image.bytes);
    return { url: avatarUrl(me.id, rev), rev };
  });

  app.delete(`${API_PREFIX}/me/avatar`, async (request): Promise<OkResponse> => {
    const me = requireAccount(request);
    accounts.clearAvatar(me.id);
    return { ok: true };
  });

  const slackState = (slackUserId: string | null): SlackStateResponse => ({
    configured: ctx.slack !== null,
    connected: slackUserId !== null,
    slackUserId,
  });

  app.get(`${API_PREFIX}/me/slack`, async (request): Promise<SlackStateResponse> => {
    const me = requireAccount(request);
    return slackState(accounts.getSlackUserId(me.id));
  });

  /**
   * Connect Slack. With no member id the server asks Slack for the one that matches this
   * account's email address, so the usual case needs no copying and pasting.
   */
  app.post(`${API_PREFIX}/me/slack`, async (request): Promise<SlackStateResponse> => {
    const me = requireAccount(request);
    const body = parseOrThrow(ConnectSlackBodySchema, request.body ?? {}, 'slack');
    if (ctx.slack === null) throw conflict('This server has no Slack bot token configured');

    const slackUserId = body.slackUserId ?? (await ctx.slack.lookupByEmail(me.email));
    if (slackUserId === null) {
      throw notFound(`Slack has no member with the address ${me.email}. Paste your member id instead.`);
    }

    accounts.setSlackUserId(me.id, slackUserId);
    return slackState(slackUserId);
  });

  app.delete(`${API_PREFIX}/me/slack`, async (request): Promise<SlackStateResponse> => {
    const me = requireAccount(request);
    accounts.setSlackUserId(me.id, null);
    return slackState(null);
  });

  /** Everyone signed in may read the roster: the UI names the author of every edit. */
  app.get(`${API_PREFIX}/users`, async (request): Promise<UsersResponse> => {
    requireAccount(request);
    // An admin runs the People screen, so they need the whole install. Everybody else gets
    // this workspace, which is all the mention list and the author byline ask for.
    if (request.principal.admin) return { users: accounts.listUsers() };
    return { users: accounts.listUsersIn(request.workspace.id) };
  });

  app.get(`${API_PREFIX}/users/:id/avatar`, async (request, reply): Promise<FastifyReply> => {
    const { id } = parseOrThrow(UserParamsSchema, request.params, 'user id');
    const query = parseOrThrow(AvatarQuerySchema, request.query, 'query');
    const avatar = accounts.getAvatar(id);
    if (avatar === null) throw notFound('That person has no avatar');

    // Without the matching rev the answer must stay fresh, or a later upload is never seen.
    const cache = query.v === avatar.rev ? IMMUTABLE_CACHE : 'private, no-cache';
    return reply.type(avatar.mime).header('Cache-Control', cache).header('ETag', `"${avatar.rev}"`)
      .send(avatar.bytes);
  });

  app.patch(`${API_PREFIX}/users/:id`, async (request): Promise<UserResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(UserParamsSchema, request.params, 'user id');
    const body = parseOrThrow(UpdateUserBodySchema, request.body, 'user');
    return { user: accounts.updateUser(id, body) };
  });

  app.delete(`${API_PREFIX}/users/:id`, async (request): Promise<OkResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(UserParamsSchema, request.params, 'user id');
    if (request.principal.account?.id === id) {
      throw conflict('Removing your own account would sign you out. Ask another admin.');
    }
    if (accounts.getUser(id) === null) throw notFound(`No account with id ${id}`);
    accounts.deleteUser(id);
    return { ok: true };
  });
}
