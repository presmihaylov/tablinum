import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ErrorBodySchema,
  HealthResponseSchema,
  OkResponseSchema,
  PageListResponseSchema,
  SpacesResponseSchema,
} from '@tablinum/shared';
import { SESSION_COOKIE } from '../src/auth.js';
import { VERSION } from '../src/version.js';
import { bodyOf, makeHarness, seed, TEST_TOKEN, type Harness } from './support/harness.js';

const open: Harness[] = [];

async function harnessFor(options: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const harness = await makeHarness(options);
  open.push(harness);
  return harness;
}

afterEach(async () => {
  while (open.length > 0) {
    const harness = open.pop();
    if (harness !== undefined) await harness.close();
  }
});

/** Take the `name=value` pair out of the first Set-Cookie header. */
function cookiePair(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

function rawCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? first : '';
}

describe('bearer tokens', () => {
  it('rejects a missing token, rejects a wrong token and accepts the configured one', async () => {
    const harness = await harnessFor();

    const anonymous = await harness.app.inject({ method: 'GET', url: '/api/v1/pages' });
    expect(anonymous.statusCode).toBe(401);
    expect(bodyOf(anonymous, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');

    const wrong = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: { authorization: 'Bearer nope-nope-nope' },
    });
    expect(wrong.statusCode).toBe(401);

    const malformed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: { authorization: TEST_TOKEN },
    });
    expect(malformed.statusCode).toBe(401);

    const good = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(good.statusCode).toBe(200);
    expect(bodyOf(good, PageListResponseSchema).pages).toEqual([]);
  });

  it('leaves /health open but protects an unknown api path', async () => {
    const harness = await harnessFor();

    const health = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(health.statusCode).toBe(200);
    expect(bodyOf(health, HealthResponseSchema)).toEqual({ ok: true });

    const unknown = await harness.app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(unknown.statusCode).toBe(401);
  });

  it('tells a credentialled caller the version and the content directory, nobody else', async () => {
    const harness = await harnessFor();

    const anonymous = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(anonymous.body).not.toContain('contentDir');

    const known = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: harness.authHeaders(),
    });
    expect(known.statusCode).toBe(200);
    const body = bodyOf(known, HealthResponseSchema);
    expect(body.contentDir).toBe(harness.contentDir);
    expect(body.version).toBe(VERSION);
  });
});

describe('encoded paths cannot skip the auth hook', () => {
  it('protects /api even when a character of the prefix is percent-encoded', async () => {
    const harness = await harnessFor();

    const first = await harness.app.inject({ method: 'GET', url: '/%61pi/v1/pages' });
    expect(first.statusCode).toBe(401);

    const middle = await harness.app.inject({ method: 'GET', url: '/ap%69/v1/pages' });
    expect(middle.statusCode).toBe(401);
  });

  it('refuses an encoded write and stores nothing', async () => {
    const harness = await harnessFor();
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'eng', name: 'Engineering' },
    });

    const written = await harness.app.inject({
      method: 'POST',
      url: '/%61pi/v1/pages',
      payload: { path: 'eng/sneaky', title: 'Sneaky', markdown: 'hello' },
    });
    expect(written.statusCode).toBe(401);
    expect(await harness.store.getPageByPath('eng/sneaky')).toBeNull();
  });

  it('protects every read route reachable through an encoded prefix', async () => {
    const harness = await harnessFor();

    const urls = [
      '/%61pi/v1/users',
      '/%61pi/v1/git/status',
      '/%61pi/v1/workspaces',
      '/%61pi/v1/search?q=deploy',
    ];
    for (const url of urls) {
      const response = await harness.app.inject({ method: 'GET', url });
      expect(`${url} -> ${response.statusCode}`).toBe(`${url} -> 401`);
    }
  });

  it('protects an attachment behind an encoded assets prefix', async () => {
    const harness = await harnessFor();
    const dir = join(harness.contentDir, '_assets', 'pg_00000000000000000000000000');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ok.txt'), 'confidential');

    const url = '/_%61ssets/pg_00000000000000000000000000/ok.txt';
    const response = await harness.app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('confidential');
  });

  it('keeps an encoded spelling of a public route public, by design', async () => {
    const harness = await harnessFor();

    const plain = await harness.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(plain.statusCode).toBe(200);

    const encoded = await harness.app.inject({ method: 'GET', url: '/%61pi/v1/health' });
    expect(encoded.statusCode).toBe(200);
  });

  it('answers a JSON 404 for an encoded api path instead of the SPA shell', async () => {
    const webDist = await mkdtemp(join(tmpdir(), 'tablinum-web-'));
    await writeFile(join(webDist, 'index.html'), '<!doctype html><title>the shell</title>');
    try {
      const harness = await harnessFor({ webDistDir: webDist });
      const headers = harness.authHeaders();

      const shell = await harness.app.inject({ method: 'GET', url: '/eng/deploy', headers });
      expect(shell.statusCode).toBe(200);
      expect(shell.body).toContain('the shell');

      for (const url of ['/%61pi/v1/nope', '/_%61ssets/pg_1/nope.txt']) {
        const response = await harness.app.inject({ method: 'GET', url, headers });
        expect(`${url} -> ${response.statusCode}`).toBe(`${url} -> 404`);
        expect(bodyOf(response, ErrorBodySchema).error.code).toBe('NOT_FOUND');
      }
    } finally {
      await rm(webDist, { recursive: true, force: true });
    }
  });
});

describe('mutation audit', () => {
  const MUTATIONS: Array<{ method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string }> = [
    { method: 'POST', url: '/api/v1/pages' },
    { method: 'PATCH', url: '/api/v1/pages/pg_00000000000000000000000000' },
    { method: 'DELETE', url: '/api/v1/pages/pg_00000000000000000000000000' },
    { method: 'POST', url: '/api/v1/pages/pg_00000000000000000000000000/comments' },
    { method: 'POST', url: '/api/v1/comment-threads/ct_00000000000000000000000000/replies' },
    { method: 'PATCH', url: '/api/v1/comment-threads/ct_00000000000000000000000000' },
    { method: 'PATCH', url: '/api/v1/comments/cm_00000000000000000000000000' },
    { method: 'DELETE', url: '/api/v1/comments/cm_00000000000000000000000000' },
    { method: 'PUT', url: '/api/v1/pages/pg_00000000000000000000000000/cursor' },
    { method: 'PUT', url: '/api/v1/pages/pg_00000000000000000000000000/database' },
    { method: 'DELETE', url: '/api/v1/pages/pg_00000000000000000000000000/database' },
    { method: 'POST', url: '/api/v1/pages/pg_00000000000000000000000000/database/rows' },
    {
      method: 'PATCH',
      url: '/api/v1/pages/pg_00000000000000000000000000/database/rows/rw_00000000000000000000000000',
    },
    {
      method: 'DELETE',
      url: '/api/v1/pages/pg_00000000000000000000000000/database/rows/rw_00000000000000000000000000',
    },
    { method: 'PUT', url: '/api/v1/favorites/pg_00000000000000000000000000' },
    { method: 'DELETE', url: '/api/v1/favorites/pg_00000000000000000000000000' },
    { method: 'POST', url: '/api/v1/spaces' },
    { method: 'PATCH', url: '/api/v1/spaces/eng' },
    { method: 'DELETE', url: '/api/v1/spaces/eng' },
    { method: 'POST', url: '/api/v1/assets' },
    { method: 'POST', url: '/api/v1/git/pull' },
    { method: 'POST', url: '/api/v1/git/push' },
    { method: 'POST', url: '/api/v1/git/commit' },
    { method: 'POST', url: '/api/v1/git/resolve' },
    { method: 'PATCH', url: '/api/v1/me' },
    { method: 'POST', url: '/api/v1/me/password' },
    { method: 'POST', url: '/api/v1/me/avatar' },
    { method: 'DELETE', url: '/api/v1/me/avatar' },
    { method: 'POST', url: '/api/v1/me/slack' },
    { method: 'DELETE', url: '/api/v1/me/slack' },
    { method: 'POST', url: '/api/v1/me/handle' },
    { method: 'PATCH', url: '/api/v1/users/us_00000000000000000000000000' },
    { method: 'POST', url: '/api/v1/users/us_00000000000000000000000000/handle' },
    { method: 'DELETE', url: '/api/v1/users/us_00000000000000000000000000' },
    { method: 'POST', url: '/api/v1/emoji' },
    { method: 'DELETE', url: '/api/v1/emoji/ce_00000000000000000000000000' },
    { method: 'POST', url: '/api/v1/invites' },
    { method: 'DELETE', url: '/api/v1/invites/iv_00000000000000000000000000' },
    { method: 'POST', url: '/api/v1/agents' },
    { method: 'PATCH', url: '/api/v1/agents/ag_00000000000000000000000000' },
    { method: 'DELETE', url: '/api/v1/agents/ag_00000000000000000000000000' },
    { method: 'POST', url: '/api/v1/agents/ag_00000000000000000000000000/token' },
    { method: 'POST', url: '/api/v1/agents/ag_00000000000000000000000000/avatar' },
    { method: 'DELETE', url: '/api/v1/agents/ag_00000000000000000000000000/avatar' },
    { method: 'POST', url: '/api/v1/mcp' },
    { method: 'DELETE', url: '/api/v1/mcp' },
    { method: 'POST', url: '/api/v1/workspaces' },
    { method: 'POST', url: '/api/v1/workspaces/import' },
    { method: 'PATCH', url: '/api/v1/workspaces/ws_00000000000000000000000000' },
    { method: 'DELETE', url: '/api/v1/workspaces/ws_00000000000000000000000000' },
    { method: 'POST', url: '/api/v1/workspaces/ws_00000000000000000000000000/members' },
    {
      method: 'PATCH',
      url: '/api/v1/workspaces/ws_00000000000000000000000000/members/us_00000000000000000000000000',
    },
    {
      method: 'DELETE',
      url: '/api/v1/workspaces/ws_00000000000000000000000000/members/us_00000000000000000000000000',
    },
  ];

  it('answers 401 on every mutation route when no credential is sent', async () => {
    const harness = await harnessFor();

    for (const route of MUTATIONS) {
      const response = await harness.app.inject({
        method: route.method,
        url: route.url,
        payload: { path: 'eng/sneaky', title: 'Sneaky', slug: 'sneaky', name: 'Sneaky' },
      });
      expect(`${route.method} ${route.url} -> ${response.statusCode}`).toBe(
        `${route.method} ${route.url} -> 401`,
      );
    }

    expect(existsSync(join(harness.contentDir, 'eng'))).toBe(false);
  });

  it('covers every mutating route the app registers', async () => {
    const harness = await harnessFor();
    const printed = harness.app.printRoutes({ commonPrefix: false });
    const verbs = [...printed.matchAll(/\(([A-Z, ]+)\)/g)]
      .flatMap((match) => (match[1] ?? '').split(','))
      .map((verb) => verb.trim())
      .filter((verb) => verb.length > 0 && !['GET', 'HEAD', 'OPTIONS'].includes(verb));

    // Setup, login, logout and register stay reachable without a credential; the rest is audited.
    expect(verbs).toHaveLength(MUTATIONS.length + 4);
  });
});

describe('cookie sessions', () => {
  /** Claim a fresh server and keep the session cookie the setup call handed back. */
  async function claim(harness: Harness): Promise<string> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { email: 'ada@example.com', name: 'Ada Lovelace', password: 'correct horse battery' },
    });
    expect(response.statusCode).toBe(200);
    return cookiePair(response);
  }

  it('signs in with an account, then authenticates with the cookie alone', async () => {
    const harness = await harnessFor();
    await claim(harness);

    const wrong = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ada@example.com', password: 'wrong password' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(bodyOf(wrong, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ada@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);
    expect(bodyOf(login, OkResponseSchema).ok).toBe(true);

    const header = rawCookie(login);
    expect(header).toContain(SESSION_COOKIE);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/');
    expect(header).toContain('SameSite=Lax');

    const cookie = cookiePair(login);
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(bodyOf(listed, SpacesResponseSchema).spaces).toEqual([]);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { cookie },
      payload: { slug: 'eng', name: 'Engineering' },
    });
    expect(created.statusCode).toBe(200);

    const loggedOut = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(loggedOut.statusCode).toBe(200);
    expect(rawCookie(loggedOut)).toContain(`${SESSION_COOKIE}=;`);
  });

  /**
   * A TLS-terminating proxy speaks plain http to the app, so the socket alone always says
   * "not secure". Without X-Forwarded-Proto the cookie loses its Secure flag and a private
   * browser window drops it, which reads as a login screen that never goes away.
   */
  it('marks the cookie Secure from X-Forwarded-Proto when the proxy is trusted', async () => {
    const harness = await harnessFor({ env: { TABLINUM_TRUST_PROXY: 'true' } });
    await claim(harness);

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { email: 'ada@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);
    expect(rawCookie(login)).toContain('Secure');
  });

  it('leaves the cookie insecure on plain http, or a local install could never log in', async () => {
    const harness = await harnessFor({ env: { TABLINUM_TRUST_PROXY: 'true' } });
    await claim(harness);

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ada@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);
    expect(rawCookie(login)).not.toContain('Secure');
  });

  it('ignores a forwarded header from an untrusted client', async () => {
    const harness = await harnessFor();
    await claim(harness);

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { email: 'ada@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);
    expect(rawCookie(login)).not.toContain('Secure');
  });

  it('rejects an unsigned cookie value', async () => {
    const harness = await harnessFor();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: { cookie: `${SESSION_COOKIE}=u1.not-a-real-session` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a login without an address, because every session names somebody', async () => {
    const harness = await harnessFor();
    await claim(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'correct horse battery' },
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('throttles repeated wrong passwords', async () => {
    const harness = await harnessFor();
    await claim(harness);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'ada@example.com', password: `guess-${attempt}` },
      });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ada@example.com', password: 'correct horse battery' },
    });
    expect(blocked.statusCode).toBe(401);
    expect(bodyOf(blocked, ErrorBodySchema).error.message).toContain('Too many');
  });
});

describe('a server with no account yet', () => {
  it('refuses every read and write until the first account exists', async () => {
    const harness = await harnessFor({ noToken: true });

    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/pages' });
    expect(listed.statusCode).toBe(401);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      payload: { slug: 'open', name: 'Open space' },
    });
    expect(created.statusCode).toBe(401);
  });

  it('lets the first visitor claim it, then works on the cookie alone', async () => {
    const harness = await harnessFor({ noToken: true });

    const setup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { email: 'ada@example.com', name: 'Ada Lovelace', password: 'correct horse battery' },
    });
    expect(setup.statusCode).toBe(200);

    const cookie = cookiePair(setup);
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: { cookie },
      payload: { slug: 'eng', name: 'Engineering' },
    });
    expect(created.statusCode).toBe(200);
  });
});

describe('token only', () => {
  it('ignores a cookie that names no session', async () => {
    const harness = await harnessFor();

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(401);

    await seed(harness);
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(bodyOf(listed, PageListResponseSchema).pages.length).toBeGreaterThan(0);
  });
});
