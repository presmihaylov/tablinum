import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ASSETS_DIR,
  isAgentToken,
  unauthorized,
  type Account,
  type Agent,
  type Config,
} from '@tablinum/shared';
import type { ServerDeps } from './deps.js';

/** Name of the signed, httpOnly session cookie set by POST /api/v1/auth/login. */
export const SESSION_COOKIE = 'tablinum_session';

/** How long a web session stays valid. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A session that names an account. The rest of the payload is the session token. */
const ACCOUNT_PREFIX = 'u1.';

/** Endpoints that must answer before the caller holds any credential. */
const PUBLIC_ENDPOINTS = new Set([
  '/api/v1/health',
  '/api/v1/auth/login',
  // Clearing your own cookie must work even once the session has expired.
  '/api/v1/auth/logout',
  // The sign-in screen must know whether to sign in or to claim an unclaimed server.
  '/api/v1/auth/state',
  // An unclaimed server has nobody to authorise the first account, so this one claims it.
  '/api/v1/auth/setup',
  // An invited person has no credential at all until the form below creates one.
  '/api/v1/auth/register',
]);

/** Public prefixes, for the endpoints that carry an id in the path. */
const PUBLIC_PREFIXES = ['/api/v1/auth/invite/'];

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Compare against itself so a wrong length costs the same as a wrong value.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Strip the query string and any trailing slash so path checks are exact. */
export function normalizePathname(url: string): string {
  const withoutQuery = url.split('?')[0] ?? '/';
  const withoutHash = withoutQuery.split('#')[0] ?? '/';
  if (withoutHash.length > 1 && withoutHash.endsWith('/')) return withoutHash.slice(0, -1);
  return withoutHash.length === 0 ? '/' : withoutHash;
}

/** Percent-decode each segment. Null when the path cannot be decoded. */
function decodePathname(pathname: string): string | null {
  const out: string[] = [];
  for (const segment of pathname.split('/')) {
    try {
      out.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }
  return out.join('/');
}

/**
 * The pathname the router matched on. Fastify decodes before it routes, so a check that
 * reads the raw text alone sees `/%61pi/...` where the handler sees `/api/...`.
 */
export function routedPathname(url: string): string {
  const raw = normalizePathname(url);
  const decoded = decodePathname(raw);
  return decoded === null ? raw : normalizePathname(decoded);
}

function isPublicPathname(pathname: string): boolean {
  if (PUBLIC_ENDPOINTS.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (pathname === `/${ASSETS_DIR}` || pathname.startsWith(`/${ASSETS_DIR}/`)) return false;
  return true;
}

/**
 * True when a request may proceed without credentials.
 * Everything under /api and every uploaded attachment is protected; the static shell of
 * the web UI is not, because the browser must load it before it can log in.
 */
export function isPublicPath(url: string): boolean {
  const raw = normalizePathname(url);
  const decoded = decodePathname(raw);
  // A path we cannot decode is protected, and both readings must agree.
  if (decoded === null) return false;
  return isPublicPathname(raw) && isPublicPathname(normalizePathname(decoded));
}

/** True when this request may run without credentials. Judged on the matched route first. */
export function isPublicRequest(request: FastifyRequest): boolean {
  const routed = request.routeOptions.url;
  if (typeof routed === 'string' && routed.length > 0) return isPublicPath(routed);
  // No route matched: only the SPA fallback and the 404 handler remain.
  return isPublicPath(request.url);
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = match[1]?.trim() ?? '';
  return token.length === 0 ? null : token;
}

function hasValidToken(request: FastifyRequest, config: Config): boolean {
  if (config.apiTokens.length === 0) return false;
  const token = bearerToken(request);
  if (token === null) return false;
  // Check every token so the answer does not depend on which one matched.
  let matched = false;
  for (const candidate of config.apiTokens) {
    if (constantTimeEquals(token, candidate)) matched = true;
  }
  return matched;
}

/** The signed cookie payload this request carries, or null when there is none. */
function cookiePayload(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return null;
  return unsigned.value;
}

/** The account session token in the cookie, or null when the cookie holds something else. */
export function accountTokenOf(request: FastifyRequest): string | null {
  const payload = cookiePayload(request);
  if (payload === null || !payload.startsWith(ACCOUNT_PREFIX)) return null;
  const token = payload.slice(ACCOUNT_PREFIX.length);
  return token.length === 0 ? null : token;
}

function writeCookie(reply: FastifyReply, value: string, secure: boolean, ttlMs: number): void {
  reply.setCookie(SESSION_COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    maxAge: Math.floor(ttlMs / 1000),
  });
}

/** Attach an account session cookie to the reply. The token is the session, not the account. */
export function setAccountCookie(
  reply: FastifyReply,
  token: string,
  secure: boolean,
  ttlMs: number = SESSION_TTL_MS,
): void {
  writeCookie(reply, `${ACCOUNT_PREFIX}${token}`, secure, ttlMs);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Small in-memory throttle so an account password cannot be brute forced. */
export class LoginThrottle {
  readonly #failures = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly maxFailures = LOGIN_MAX_FAILURES,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  isBlocked(key: string, now: number = Date.now()): boolean {
    const entry = this.#failures.get(key);
    if (entry === undefined) return false;
    if (now - entry.firstAt > this.windowMs) {
      this.#failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string, now: number = Date.now()): void {
    const entry = this.#failures.get(key);
    if (entry === undefined || now - entry.firstAt > this.windowMs) {
      this.#failures.set(key, { count: 1, firstAt: now });
      return;
    }
    entry.count += 1;
  }

  reset(key: string): void {
    this.#failures.delete(key);
  }
}

/** How the caller proved who it is. */
export type PrincipalKind = 'account' | 'agent' | 'token' | 'none';

/** Who is making a request. Computed once per request and read by the routes. */
export interface Principal {
  kind: PrincipalKind;
  /** The signed-in account, or null for an agent or an API token. */
  account: Account | null;
  /** The agent behind an agent token, or null for every other credential. */
  agent: Agent | null;
  /** True for an admin account or an API token, which belongs to the operator. */
  admin: boolean;
}

const ANONYMOUS: Principal = { kind: 'none', account: null, agent: null, admin: false };

declare module 'fastify' {
  interface FastifyRequest {
    /** Who is calling. Set by the auth hook before any route handler runs. */
    principal: Principal;
  }
}

/** Work out who is calling, without deciding whether they are allowed through. */
export function principalOf(request: FastifyRequest, deps: ServerDeps): Principal {
  const token = accountTokenOf(request);
  if (token !== null) {
    const account = deps.accounts.resolveSession(token);
    if (account !== null) {
      return { kind: 'account', account, agent: null, admin: account.role === 'admin' };
    }
  }

  // An agent token names one agent, so it reads and writes pages but administers nothing.
  const bearer = bearerToken(request);
  if (bearer !== null && isAgentToken(bearer)) {
    const agent = deps.accounts.resolveAgentToken(bearer);
    if (agent !== null) return { kind: 'agent', account: null, agent, admin: false };
  }

  // An API token belongs to the operator, so it carries the same authority as an admin.
  if (hasValidToken(request, deps.config)) {
    return { kind: 'token', account: null, agent: null, admin: true };
  }
  return ANONYMOUS;
}

/** Throw unless the caller may invite people, change roles or remove accounts. */
export function requireAdmin(request: FastifyRequest): void {
  if (request.principal.admin) return;
  throw unauthorized('Only an admin can do that');
}

/** The signed-in account, or a 401 for an agent that has no account. */
export function requireAccount(request: FastifyRequest): Account {
  const { account } = request.principal;
  if (account === null) throw unauthorized('Sign in with an account to do that');
  return account;
}

/**
 * Install the global authentication hook.
 * Call this before any route is registered: Fastify freezes a route's hook chain when the
 * route is added, so a hook added later would not protect it.
 */
export function registerAuthHook(app: FastifyInstance, deps: ServerDeps): void {
  // Not a Fastify decorator: v5 refuses an object default, and a per-request assignment from
  // the hook below is what every handler reads anyway.
  app.addHook('preHandler', async (request: FastifyRequest) => {
    // Resolved even on a public path, so /auth/state can report who is already signed in.
    request.principal = principalOf(request, deps);
    if (request.principal.kind !== 'none') return;
    if (isPublicRequest(request)) return;
    throw unauthorized('Missing or invalid credentials');
  });
}
