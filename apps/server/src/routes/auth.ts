import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  LoginBodySchema,
  RegisterBodySchema,
  SetupBodySchema,
  conflict,
  notFound,
  parseOrThrow,
  unauthorized,
  type Account,
  type AuthResponse,
  type AuthStateResponse,
  type InvitePreviewResponse,
  type OkResponse,
} from '@gitdocs/shared';
import { LoginThrottle, accountTokenOf, clearSessionCookie, setAccountCookie } from '../auth.js';
import { API_PREFIX, type RouteContext } from '../context.js';

/** Only mark the cookie `secure` on https, otherwise a plain-http deployment cannot log in. */
function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https';
}

const TokenParamsSchema = z.object({ token: z.string().min(8).max(200) });

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const throttle = new LoginThrottle();
  const { accounts } = ctx.deps;

  /** Sign a browser in as an account and hand it the session cookie. */
  const startSession = (reply: FastifyReply, request: FastifyRequest, account: Account): void => {
    const session = accounts.createSession(account.id);
    setAccountCookie(reply, session.token, isSecureRequest(request));
  };

  app.get(`${API_PREFIX}/auth/state`, async (request): Promise<AuthStateResponse> => {
    return { setupRequired: accounts.isEmpty(), user: request.principal.account };
  });

  /**
   * Create the first admin. Public, because a fresh server has nobody to authorise it and the
   * person who installed it is the next one to open the page. It works exactly once.
   */
  app.post(`${API_PREFIX}/auth/setup`, async (request, reply): Promise<AuthResponse> => {
    if (!accounts.isEmpty()) {
      throw conflict('This server already has accounts. Ask an admin for an invite link.');
    }
    const body = parseOrThrow(SetupBodySchema, request.body, 'setup body');
    const account = accounts.createUser({ ...body, role: 'admin' });
    // The first person owns the workspace the server was started with, and names it next.
    accounts.addMember(ctx.workspaces.default.record.id, account.id, 'admin');
    startSession(reply, request, account);
    return { ok: true, user: account };
  });

  app.post(`${API_PREFIX}/auth/login`, async (request, reply): Promise<AuthResponse> => {
    const body = parseOrThrow(LoginBodySchema, request.body, 'login body');

    const client = request.ip;
    if (throttle.isBlocked(client)) {
      throw unauthorized('Too many failed login attempts. Wait a few minutes and try again.');
    }

    const account = accounts.login(body.email, body.password);
    if (account === null) {
      throttle.recordFailure(client);
      throw unauthorized('That email and password did not match');
    }
    throttle.reset(client);
    startSession(reply, request, account);
    return { ok: true, user: account };
  });

  app.post(`${API_PREFIX}/auth/logout`, async (request, reply): Promise<OkResponse> => {
    // Drop the row too, or the token in a copied cookie would still work after signing out.
    const token = accountTokenOf(request);
    if (token !== null) accounts.destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  /** What the sign-up screen may learn before the invited person has proved anything. */
  app.get(`${API_PREFIX}/auth/invite/:token`, async (request): Promise<InvitePreviewResponse> => {
    const { token } = parseOrThrow(TokenParamsSchema, request.params, 'invite token');
    const invite = accounts.getInviteByToken(token);
    if (invite === null) throw notFound('That invite link is not valid any more');
    const sender = invite.createdBy === null ? null : accounts.getUser(invite.createdBy);
    return {
      email: invite.email,
      role: invite.role,
      expires: invite.expires,
      invitedBy: sender?.name ?? null,
    };
  });

  app.post(`${API_PREFIX}/auth/register`, async (request, reply): Promise<AuthResponse> => {
    const body = parseOrThrow(RegisterBodySchema, request.body, 'register body');

    // The token is a secret, so guessing at it is throttled exactly like a password.
    const client = request.ip;
    if (throttle.isBlocked(client)) {
      throw unauthorized('Too many failed attempts. Wait a few minutes and try again.');
    }
    if (accounts.getInviteByToken(body.token) === null) {
      throttle.recordFailure(client);
      throw notFound('That invite link is not valid any more');
    }
    throttle.reset(client);

    const account = accounts.redeemInvite(body.token, {
      email: body.email,
      name: body.name,
      password: body.password,
    });
    startSession(reply, request, account);
    return { ok: true, user: account };
  });
}
