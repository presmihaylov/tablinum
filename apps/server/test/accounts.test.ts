import { afterEach, describe, expect, it } from 'vitest';
import {
  AuthResponseSchema,
  AuthStateResponseSchema,
  AvatarResponseSchema,
  ErrorBodySchema,
  InvitePreviewResponseSchema,
  InviteResponseSchema,
  InvitesResponseSchema,
  MeResponseSchema,
  OkResponseSchema,
  UserResponseSchema,
  UsersResponseSchema,
} from '@gitdocs/shared';
import { bodyOf, makeHarness, TEST_TOKEN, type Harness } from './support/harness.js';

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

const ADMIN = { email: 'ada@example.com', name: 'Ada Lovelace', password: 'stack-of-pancakes' };

function cookiePair(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

/** Claim the server with the first admin and return the cookie that account signs in with. */
async function claim(harness: Harness): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    payload: ADMIN,
  });
  expect(response.statusCode).toBe(200);
  return cookiePair(response);
}

/** A 1x1 png, small enough to be an avatar and real enough to have a mime type. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Build a multipart body by hand: inject() has no form helper. */
function multipart(field: string, filename: string, mime: string, bytes: Buffer): {
  headers: Record<string, string>;
  payload: Buffer;
} {
  const boundary = '----gitdocstest0123456789';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, bytes, tail]),
  };
}

describe('first-time setup', () => {
  it('reports an unclaimed server, then claims it with the first admin', async () => {
    const harness = await harnessFor();
    const headers = { authorization: `Bearer ${TEST_TOKEN}` };

    const before = await harness.app.inject({ method: 'GET', url: '/api/v1/auth/state', headers });
    const state = bodyOf(before, AuthStateResponseSchema);
    expect(state.accounts).toBe(false);
    expect(state.setupRequired).toBe(true);
    expect(state.user).toBeNull();

    const cookie = await claim(harness);

    const after = await harness.app.inject({ method: 'GET', url: '/api/v1/auth/state', headers: { cookie } });
    const claimed = bodyOf(after, AuthStateResponseSchema);
    expect(claimed.accounts).toBe(true);
    expect(claimed.setupRequired).toBe(false);
    expect(claimed.user?.email).toBe(ADMIN.email);
    expect(claimed.user?.role).toBe('admin');
  });

  it('refuses a second setup once an account exists', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const again = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: { cookie },
      payload: { email: 'bob@example.com', name: 'Bob', password: 'another-long-one' },
    });
    expect(again.statusCode).toBe(409);
    expect(bodyOf(again, ErrorBodySchema).error.code).toBe('CONFLICT');
  });

  it('refuses setup from a stranger on a protected server', async () => {
    const harness = await harnessFor();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: ADMIN,
    });
    expect(response.statusCode).toBe(401);
  });

  it('closes an open server as soon as the first account exists', async () => {
    const harness = await harnessFor({ open: true });

    const setup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: ADMIN,
    });
    expect(setup.statusCode).toBe(200);

    const anonymous = await harness.app.inject({ method: 'GET', url: '/api/v1/pages' });
    expect(anonymous.statusCode).toBe(401);

    const signedIn = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: { cookie: cookiePair(setup) },
    });
    expect(signedIn.statusCode).toBe(200);
  });
});

describe('account login', () => {
  it('signs in with an email and password, then authenticates with the cookie', async () => {
    const harness = await harnessFor();
    await claim(harness);

    const wrong = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN.email, password: 'not the password' },
    });
    expect(wrong.statusCode).toBe(401);

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ' Ada@Example.com ', password: ADMIN.password },
    });
    expect(login.statusCode).toBe(200);
    expect(bodyOf(login, AuthResponseSchema).user?.name).toBe(ADMIN.name);

    const me = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookiePair(login) },
    });
    expect(bodyOf(me, MeResponseSchema).user?.email).toBe(ADMIN.email);
  });

  it('drops the session row on logout, so a copied cookie stops working', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const out = await harness.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);

    const replay = await harness.app.inject({ method: 'GET', url: '/api/v1/pages', headers: { cookie } });
    expect(replay.statusCode).toBe(401);
  });

  it('leaves the shared password login working beside accounts', async () => {
    const harness = await harnessFor();
    await claim(harness);

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'correct horse battery staple' },
    });
    expect(login.statusCode).toBe(200);
    expect(bodyOf(login, OkResponseSchema).ok).toBe(true);
    expect(bodyOf(login, AuthResponseSchema).user).toBeNull();
  });
});

describe('invites', () => {
  it('invites a person, previews the link and registers them', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/invites',
      headers: { cookie },
      payload: { email: 'grace@example.com' },
    });
    expect(created.statusCode).toBe(200);
    const issued = bodyOf(created, InviteResponseSchema);
    expect(issued.invite.email).toBe('grace@example.com');
    expect(issued.url).toContain('/invite/');

    const token = issued.url.slice(issued.url.lastIndexOf('/') + 1);

    // The invited person has no credential at all until they register.
    const preview = await harness.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${token}` });
    expect(preview.statusCode).toBe(200);
    const seen = bodyOf(preview, InvitePreviewResponseSchema);
    expect(seen.email).toBe('grace@example.com');
    expect(seen.invitedBy).toBe(ADMIN.name);

    const registered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { token, name: 'Grace Hopper', password: 'nanoseconds-please' },
    });
    expect(registered.statusCode).toBe(200);
    const account = bodyOf(registered, AuthResponseSchema).user;
    expect(account?.email).toBe('grace@example.com');
    expect(account?.role).toBe('member');

    const spent = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { token, name: 'Impostor', password: 'nanoseconds-please' },
    });
    expect(spent.statusCode).toBe(404);
  });

  it('revokes an invite before it is used', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/invites',
      headers: { cookie },
      payload: {},
    });
    const issued = bodyOf(created, InviteResponseSchema);
    const token = issued.url.slice(issued.url.lastIndexOf('/') + 1);

    const revoked = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/invites/${issued.invite.id}`,
      headers: { cookie },
    });
    expect(revoked.statusCode).toBe(200);

    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/invites', headers: { cookie } });
    expect(bodyOf(listed, InvitesResponseSchema).invites[0]?.revoked).toBe(true);

    const used = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { token, email: 'late@example.com', name: 'Late', password: 'too-late-friend' },
    });
    expect(used.statusCode).toBe(404);
  });

  it('refuses to invite when the caller is not an admin', async () => {
    const harness = await harnessFor();
    const adminCookie = await claim(harness);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/invites',
      headers: { cookie: adminCookie },
      payload: { email: 'member@example.com' },
    });
    const issued = bodyOf(created, InviteResponseSchema);
    const token = issued.url.slice(issued.url.lastIndexOf('/') + 1);

    const registered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { token, name: 'A Member', password: 'members-only-here' },
    });
    const memberCookie = cookiePair(registered);

    const attempt = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/invites',
      headers: { cookie: memberCookie },
      payload: {},
    });
    expect(attempt.statusCode).toBe(401);
    expect(bodyOf(attempt, ErrorBodySchema).error.message).toContain('admin');
  });
});

describe('profile', () => {
  it('renames the account and changes the password', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { name: 'Ada L' },
    });
    expect(bodyOf(renamed, UserResponseSchema).user.name).toBe('Ada L');

    const refused = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      headers: { cookie },
      payload: { current: 'wrong password', next: 'a-brand-new-one' },
    });
    expect(refused.statusCode).toBe(401);

    const changed = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      headers: { cookie },
      payload: { current: ADMIN.password, next: 'a-brand-new-one' },
    });
    expect(changed.statusCode).toBe(200);

    // The old cookie is dead, because changing a password signs every other browser out.
    const stale = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(stale.statusCode).toBe(401);

    const fresh = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookiePair(changed) },
    });
    expect(bodyOf(fresh, MeResponseSchema).user?.name).toBe('Ada L');

    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN.email, password: 'a-brand-new-one' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('stores an avatar, serves it and removes it', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const form = multipart('file', 'me.png', 'image/png', PNG);
    const uploaded = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });
    expect(uploaded.statusCode).toBe(200);
    const avatar = bodyOf(uploaded, AvatarResponseSchema);
    expect(avatar.url).toContain(avatar.rev);

    const served = await harness.app.inject({ method: 'GET', url: avatar.url, headers: { cookie } });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.rawPayload.equals(PNG)).toBe(true);

    const me = await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(bodyOf(me, MeResponseSchema).user?.avatarRev).toBe(avatar.rev);

    const cleared = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/me/avatar',
      headers: { cookie },
    });
    expect(cleared.statusCode).toBe(200);

    const gone = await harness.app.inject({ method: 'GET', url: avatar.url, headers: { cookie } });
    expect(gone.statusCode).toBe(404);
  });

  it('refuses an avatar that is not an image', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const form = multipart('file', 'notes.txt', 'text/plain', Buffer.from('hello', 'utf8'));
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('answers /me with no user for an agent holding a bearer token', async () => {
    const harness = await harnessFor();
    await claim(harness);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response, MeResponseSchema).user).toBeNull();
  });
});

describe('the roster', () => {
  it('lists accounts and lets an admin change a role', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/invites',
      headers: { cookie },
      payload: { email: 'grace@example.com' },
    });
    const issued = bodyOf(created, InviteResponseSchema);
    const token = issued.url.slice(issued.url.lastIndexOf('/') + 1);
    const registered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { token, name: 'Grace Hopper', password: 'nanoseconds-please' },
    });
    const member = bodyOf(registered, AuthResponseSchema).user;
    expect(member).not.toBeNull();

    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie } });
    expect(bodyOf(listed, UsersResponseSchema).users).toHaveLength(2);

    const promoted = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${member?.id ?? ''}`,
      headers: { cookie },
      payload: { role: 'admin' },
    });
    expect(bodyOf(promoted, UserResponseSchema).user.role).toBe('admin');

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${member?.id ?? ''}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);
    const after = await harness.app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie } });
    expect(bodyOf(after, UsersResponseSchema).users).toHaveLength(1);
  });

  it('refuses to remove the account you are signed in as', async () => {
    const harness = await harnessFor();
    const cookie = await claim(harness);
    const me = bodyOf(
      await harness.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } }),
      MeResponseSchema,
    ).user;

    const response = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${me?.id ?? ''}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(409);
  });
});
