import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ASSETS_DIR, unauthorized, type Config } from '@gitdocs/shared';

/** Name of the signed, httpOnly session cookie set by POST /api/v1/auth/login. */
export const SESSION_COOKIE = 'gitdocs_session';

/** How long a web session stays valid. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SESSION_PREFIX = 'v1.';

/** Endpoints that must answer before the caller holds any credential. */
const PUBLIC_ENDPOINTS = new Set([
  '/api/v1/health',
  '/api/v1/auth/login',
  // Clearing your own cookie must work even once the session has expired.
  '/api/v1/auth/logout',
]);

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

/**
 * True when a request may proceed without credentials.
 * Everything under /api and every uploaded attachment is protected; the static shell of
 * the web UI is not, because the browser must load it before it can log in.
 */
export function isPublicPath(url: string): boolean {
  const pathname = normalizePathname(url);
  if (PUBLIC_ENDPOINTS.has(pathname)) return true;
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (pathname === `/${ASSETS_DIR}` || pathname.startsWith(`/${ASSETS_DIR}/`)) return false;
  return true;
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

/** Build the cookie payload for a session that starts now. */
export function sessionValue(now: number = Date.now()): string {
  return `${SESSION_PREFIX}${now}`;
}

/** True when a decoded cookie payload is well formed and still inside its lifetime. */
export function isSessionValueValid(value: string, now: number = Date.now()): boolean {
  if (!value.startsWith(SESSION_PREFIX)) return false;
  const issuedAt = Number(value.slice(SESSION_PREFIX.length));
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  if (issuedAt > now + 60_000) return false; // issued in the future: forged or a clock jump
  return now - issuedAt < SESSION_TTL_MS;
}

function hasValidSession(request: FastifyRequest, config: Config): boolean {
  if (config.password === null) return false;
  const raw = request.cookies[SESSION_COOKIE];
  if (typeof raw !== 'string' || raw.length === 0) return false;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return false;
  return isSessionValueValid(unsigned.value);
}

/** Attach a fresh session cookie to the reply. */
export function setSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, sessionValue(), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Constant-time password check against the configured password. */
export function isPasswordCorrect(candidate: string, config: Config): boolean {
  if (config.password === null) return false;
  return constantTimeEquals(candidate, config.password);
}

/** Small in-memory throttle so the login password cannot be brute forced. */
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

/**
 * Install the global authentication hook.
 * Call this before any route is registered: Fastify freezes a route's hook chain when the
 * route is added, so a hook added later would not protect it.
 */
export function registerAuthHook(app: FastifyInstance, config: Config): void {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    if (config.openMode) return;
    if (isPublicPath(request.url)) return;
    if (hasValidToken(request, config)) return;
    if (hasValidSession(request, config)) return;
    throw unauthorized('Missing or invalid credentials');
  });
}
