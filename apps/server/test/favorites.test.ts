import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthResponseSchema,
  ErrorBodySchema,
  FavoriteResponseSchema,
  FavoritesResponseSchema,
  InviteResponseSchema,
  OkResponseSchema,
} from '@tablinum/shared';
import { bodyOf, makeHarness, seed, TEST_TOKEN, type Harness } from './support/harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

const ADMIN = { email: 'ada@example.com', name: 'Ada Lovelace', password: 'stack-of-pancakes' };

function cookiePair(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

/** Claim the server with the first admin and return the cookie that account signs in with. */
async function claim(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    payload: ADMIN,
  });
  expect(response.statusCode).toBe(200);
  return cookiePair(response);
}

/** Invite somebody into the workspace the admin is in, and sign them in. */
async function invite(adminCookie: string, name: string, email: string): Promise<string> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/invites',
    headers: { cookie: adminCookie },
    payload: { email },
  });
  const issued = bodyOf(created, InviteResponseSchema);
  const token = issued.url.slice(issued.url.lastIndexOf('/') + 1);

  const registered = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { token, name, password: 'nanoseconds-please' },
  });
  expect(bodyOf(registered, AuthResponseSchema).user?.role).toBe('member');
  return cookiePair(registered);
}

/** Two pages to pin, plus the admin cookie that made them. */
async function pagesWithAdmin(): Promise<{ cookie: string; first: string; second: string }> {
  const cookie = await claim();
  const { pageIds } = await seed(harness);
  const [first, second] = pageIds;
  if (first === undefined || second === undefined) throw new Error('The seed made too few pages');
  return { cookie, first, second };
}

function pin(cookie: string, pageId: string) {
  return harness.app.inject({
    method: 'PUT',
    url: `/api/v1/favorites/${pageId}`,
    headers: { cookie },
  });
}

function unpin(cookie: string, pageId: string) {
  return harness.app.inject({
    method: 'DELETE',
    url: `/api/v1/favorites/${pageId}`,
    headers: { cookie },
  });
}

async function listPins(cookie: string): Promise<string[]> {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/favorites',
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return bodyOf(response, FavoritesResponseSchema).favorites.map((one) => one.pageId);
}

describe('favorites', () => {
  it('pins a page, lists it back, then takes the pin off', async () => {
    const { cookie, first } = await pagesWithAdmin();

    const pinned = await pin(cookie, first);
    expect(pinned.statusCode).toBe(200);
    expect(bodyOf(pinned, FavoriteResponseSchema).favorite.pageId).toBe(first);
    expect(await listPins(cookie)).toEqual([first]);

    const removed = await unpin(cookie, first);
    expect(bodyOf(removed, OkResponseSchema).ok).toBe(true);
    expect(await listPins(cookie)).toEqual([]);
  });

  it('keeps the pins in the order they were made', async () => {
    const { cookie, first, second } = await pagesWithAdmin();

    await pin(cookie, first);
    await pin(cookie, second);

    expect(await listPins(cookie)).toEqual([first, second]);
  });

  it('takes a second pin and a second unpin without complaint', async () => {
    const { cookie, first } = await pagesWithAdmin();

    expect((await pin(cookie, first)).statusCode).toBe(200);
    expect((await pin(cookie, first)).statusCode).toBe(200);
    expect(await listPins(cookie)).toEqual([first]);

    expect((await unpin(cookie, first)).statusCode).toBe(200);
    expect((await unpin(cookie, first)).statusCode).toBe(200);
  });

  it('keeps one account out of the pins of another', async () => {
    const { cookie, first, second } = await pagesWithAdmin();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');

    await pin(cookie, first);
    await pin(member, second);

    expect(await listPins(cookie)).toEqual([first]);
    expect(await listPins(member)).toEqual([second]);
  });

  it('drops the pins of a page that was deleted, for everybody', async () => {
    const { cookie, first, second } = await pagesWithAdmin();
    const member = await invite(cookie, 'Grace Hopper', 'grace@example.com');
    await pin(cookie, first);
    await pin(member, first);
    await pin(cookie, second);

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${first}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(200);

    expect(await listPins(cookie)).toEqual([second]);
    expect(await listPins(member)).toEqual([]);
  });

  it('answers NOT_FOUND for a page nobody has', async () => {
    const cookie = await claim();

    const response = await pin(cookie, 'pg_00000000000000000000000000');

    expect(response.statusCode).toBe(404);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('NOT_FOUND');
  });

  it('turns an unauthenticated caller away', async () => {
    const { first } = await pagesWithAdmin();

    expect((await harness.app.inject({ method: 'GET', url: '/api/v1/favorites' })).statusCode).toBe(401);
    expect(
      (await harness.app.inject({ method: 'PUT', url: `/api/v1/favorites/${first}` })).statusCode,
    ).toBe(401);
  });

  it('gives an agent token no pins of its own', async () => {
    const { first } = await pagesWithAdmin();

    // A token is not a person, so there is nobody whose pins it could read or write.
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/favorites',
      headers: harness.authHeaders(),
    });
    expect(listed.statusCode).toBe(401);

    const written = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/favorites/${first}`,
      headers: harness.authHeaders(),
    });
    expect(written.statusCode).toBe(401);
  });
});
