import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ChangeHandleBodySchema,
  ChangePasswordBodySchema,
  ConnectSlackBodySchema,
  UpdateMeBodySchema,
  UpdateUserBodySchema,
  UserIdSchema,
  avatarUrl,
  conflict,
  notFound,
  parseOrThrow,
  unauthorized,
  type AvatarResponse,
  type HandleChangeResponse,
  type HandlePreviewResponse,
  type MeResponse,
  type OkResponse,
  type SlackStateResponse,
  type UserResponse,
  type UsersResponse,
} from '@tablinum/shared';
import { requireAccount, requireAdmin, setAccountCookie } from '../auth.js';
import { AvatarQuerySchema, readAvatarUpload, sendAvatar } from '../avatars.js';
import { API_PREFIX, type RouteContext } from '../context.js';
import { countMentions, rewriteMentions } from '../handles.js';

const UserParamsSchema = z.object({ id: UserIdSchema });

function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https';
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

  /**
   * Change a handle and rewrite every mention of the old one.
   *
   * The account database moves first and the content follows, so a sweep that fails part way
   * leaves stale text rather than a page pointing at a handle nobody holds. The old handle is
   * reserved either way, so a mention that was missed still names the same person.
   */
  async function applyHandle(
    request: FastifyRequest,
    id: string,
  ): Promise<HandleChangeResponse> {
    const body = parseOrThrow(ChangeHandleBodySchema, request.body, 'handle');
    const change = accounts.changeHandle(id, body.handle);
    if (change.previous === null) {
      return {
        user: change.account,
        previous: null,
        rewritten: { pages: 0, comments: 0, skipped: 0 },
      };
    }

    const rewritten = await rewriteMentions(ctx, change.previous, change.account.handle);
    return { user: change.account, previous: change.previous, rewritten };
  }

  /**
   * What a change to this person's handle would cost: how much text carries it, and when it
   * may be changed.
   *
   * Both preview routes answer through here, the way both change routes answer through
   * applyHandle() above. The count is read against `request`, so a private space the caller
   * cannot open never raises it, whoever the handle belongs to.
   */
  async function previewHandle(
    request: FastifyRequest,
    id: string,
  ): Promise<HandlePreviewResponse> {
    const account = accounts.getUser(id);
    if (account === null) throw notFound(`No account with id ${id}`);
    const counts = await countMentions(ctx, request, account.handle);
    const ready = accounts.handleChangeableAt(id);
    return {
      handle: account.handle,
      pages: counts.pages,
      comments: counts.comments,
      changeableAt: ready === null ? null : new Date(ready).toISOString(),
    };
  }

  app.get(`${API_PREFIX}/me/handle`, async (request): Promise<HandlePreviewResponse> => {
    const me = requireAccount(request);
    return previewHandle(request, me.id);
  });

  app.post(`${API_PREFIX}/me/handle`, async (request): Promise<HandleChangeResponse> => {
    const me = requireAccount(request);
    return applyHandle(request, me.id);
  });

  /**
   * What an admin's change to somebody else's handle would cost.
   *
   * The route below rewrites other people's committed text without asking them, so it needs
   * the warning the self-service one already has, not less of it.
   */
  app.get(`${API_PREFIX}/users/:id/handle`, async (request): Promise<HandlePreviewResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(UserParamsSchema, request.params, 'user id');
    return previewHandle(request, id);
  });

  /** An admin fixes anybody's handle. The same cooldown applies, so neither route can churn. */
  app.post(`${API_PREFIX}/users/:id/handle`, async (request): Promise<HandleChangeResponse> => {
    requireAdmin(request);
    const { id } = parseOrThrow(UserParamsSchema, request.params, 'user id');
    if (accounts.getUser(id) === null) throw notFound(`No account with id ${id}`);
    return applyHandle(request, id);
  });

  app.post(`${API_PREFIX}/me/avatar`, async (request): Promise<AvatarResponse> => {
    const me = requireAccount(request);
    const image = await readAvatarUpload(request);
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

  /**
   * Everyone signed in may read the roster: the UI names the author of every edit, and an agent
   * naming the author of a comment needs the same list.
   */
  app.get(`${API_PREFIX}/users`, async (request): Promise<UsersResponse> => {
    // An operator token administers the install from a script and has never needed the roster.
    if (request.principal.agent === null) requireAccount(request);
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
    return sendAvatar(reply, avatar, query.v);
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
