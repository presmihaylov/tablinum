import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LoginBodySchema, parseOrThrow, unauthorized, type OkResponse } from '@gitdocs/shared';
import {
  LoginThrottle,
  clearSessionCookie,
  isPasswordCorrect,
  setSessionCookie,
} from '../auth.js';
import { API_PREFIX, type RouteContext } from '../context.js';

/** Only mark the cookie `secure` on https, otherwise a plain-http deployment cannot log in. */
function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https';
}

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const throttle = new LoginThrottle();

  app.post(`${API_PREFIX}/auth/login`, async (request, reply): Promise<OkResponse> => {
    const body = parseOrThrow(LoginBodySchema, request.body, 'login body');
    const { config } = ctx.deps;

    if (config.password === null) {
      throw unauthorized('Password login is not configured on this server');
    }

    const client = request.ip;
    if (throttle.isBlocked(client)) {
      throw unauthorized('Too many failed login attempts. Wait a few minutes and try again.');
    }

    if (!isPasswordCorrect(body.password, config)) {
      throttle.recordFailure(client);
      throw unauthorized('Invalid password');
    }

    throttle.reset(client);
    setSessionCookie(reply, isSecureRequest(request));
    return { ok: true };
  });

  app.post(`${API_PREFIX}/auth/logout`, async (_request, reply): Promise<OkResponse> => {
    clearSessionCookie(reply);
    return { ok: true };
  });
}
