import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthResponseSchema,
  BacklinksResponseSchema,
  ErrorBodySchema,
  InviteResponseSchema,
  PageListResponseSchema,
  PageResponseSchema,
  SearchResponseSchema,
  SpaceResponseSchema,
  SpacesResponseSchema,
  TreeResponseSchema,
} from '@tablinum/shared';
import { bodyOf, makeHarness, seed, TEST_TOKEN, type Harness } from './support/harness.js';
import { multipart } from './support/multipart.js';

const run = promisify(execFile);

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

/** Invite a second person into the workspace and sign them in. */
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
  expect(registered.statusCode).toBe(200);
  expect(bodyOf(registered, AuthResponseSchema).user?.role).toBe('member');
  return cookiePair(registered);
}

function makeSpace(cookie: string, slug: string, name: string, isPrivate: boolean) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/spaces',
    headers: { cookie },
    payload: { slug, name, private: isPrivate },
  });
}

/** A private space with one page in it, plus the cookie of the person who owns it. */
async function ownedSpace(): Promise<{ owner: string; member: string; pageId: string }> {
  const owner = await claim();
  const member = await invite(owner, 'Grace Hopper', 'grace@example.com');
  await seed(harness);

  const created = await makeSpace(owner, 'notes', 'Notes', true);
  expect(created.statusCode).toBe(200);

  const page = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: { cookie: owner },
    payload: { path: 'notes/salary', title: 'Salary', markdown: 'The word here is aardvark.' },
  });
  expect(page.statusCode).toBe(201);
  return { owner, member, pageId: bodyOf(page, PageResponseSchema).page.id };
}

function slugsOf(response: { body: string }): string[] {
  return bodyOf(response, SpacesResponseSchema).spaces.map((space) => space.slug);
}

function get(url: string, headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url, headers });
}

async function gitLines(args: string[]): Promise<string[]> {
  const { stdout } = await run('git', args, { cwd: harness.contentDir });
  return stdout.split('\n').filter((line) => line.trim().length > 0);
}

describe('private spaces', () => {
  it('lets the owner see the space, its tree and its pages', async () => {
    const { owner, pageId } = await ownedSpace();

    expect(slugsOf(await get('/api/v1/spaces', { cookie: owner }))).toContain('notes');

    const tree = bodyOf(await get('/api/v1/tree', { cookie: owner }), TreeResponseSchema);
    expect(tree.spaces.map((space) => space.slug)).toContain('notes');

    const pages = bodyOf(await get('/api/v1/pages', { cookie: owner }), PageListResponseSchema);
    expect(pages.pages.map((page) => page.path)).toContain('notes/salary');

    const byId = await get(`/api/v1/pages/${pageId}`, { cookie: owner });
    expect(bodyOf(byId, PageResponseSchema).page.path).toBe('notes/salary');
  });

  it('hides the space from every other person, and says NOT_FOUND rather than FORBIDDEN', async () => {
    const { member, pageId } = await ownedSpace();
    const headers = { cookie: member };

    expect(slugsOf(await get('/api/v1/spaces', headers))).not.toContain('notes');

    const tree = bodyOf(await get('/api/v1/tree', headers), TreeResponseSchema);
    expect(tree.spaces.map((space) => space.slug)).not.toContain('notes');

    const pages = bodyOf(await get('/api/v1/pages', headers), PageListResponseSchema);
    expect(pages.pages.map((page) => page.path)).not.toContain('notes/salary');

    const byId = await get(`/api/v1/pages/${pageId}`, headers);
    expect(byId.statusCode).toBe(404);
    expect(bodyOf(byId, ErrorBodySchema).error.code).toBe('NOT_FOUND');

    const byPath = await get('/api/v1/pages?path=notes/salary', headers);
    expect(byPath.statusCode).toBe(404);
  });

  it('hides the space from an admin too, because an admin is not the owner', async () => {
    const owner = await claim();
    const member = await invite(owner, 'Grace Hopper', 'grace@example.com');
    // The member owns this one, so the admin who claimed the server is the outsider.
    expect((await makeSpace(member, 'grace', 'Grace notes', true)).statusCode).toBe(200);

    expect(slugsOf(await get('/api/v1/spaces', { cookie: member }))).toContain('grace');
    expect(slugsOf(await get('/api/v1/spaces', { cookie: owner }))).not.toContain('grace');
  });

  it('hides the space from an API token, which is nobody', async () => {
    const { pageId } = await ownedSpace();
    const headers = harness.authHeaders();

    expect(slugsOf(await get('/api/v1/spaces', headers))).not.toContain('notes');
    expect((await get(`/api/v1/pages/${pageId}`, headers)).statusCode).toBe(404);
  });

  it('keeps a private page out of another person search results', async () => {
    const { owner, member } = await ownedSpace();

    const mine = bodyOf(await get('/api/v1/search?q=aardvark', { cookie: owner }), SearchResponseSchema);
    expect(mine.hits.map((hit) => hit.path)).toContain('notes/salary');

    const theirs = bodyOf(
      await get('/api/v1/search?q=aardvark', { cookie: member }),
      SearchResponseSchema,
    );
    expect(theirs.hits).toEqual([]);
  });

  it('keeps a private page out of the backlinks of a public one', async () => {
    const { owner, member } = await ownedSpace();
    const target = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: { cookie: owner },
      payload: { path: 'eng/policy', title: 'Policy', markdown: 'The rules.' },
    });
    const targetId = bodyOf(target, PageResponseSchema).page.id;

    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: { cookie: owner },
      payload: { path: 'notes/gripe', title: 'Gripe', markdown: 'See [[eng/policy]].' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: { cookie: owner },
      payload: { path: 'eng/onboarding', title: 'Onboarding', markdown: 'Read [[eng/policy]].' },
    });

    const mine = bodyOf(
      await get(`/api/v1/pages/${targetId}/backlinks`, { cookie: owner }),
      BacklinksResponseSchema,
    );
    expect(mine.backlinks.map((link) => link.path).sort()).toEqual(['eng/onboarding', 'notes/gripe']);

    const theirs = bodyOf(
      await get(`/api/v1/pages/${targetId}/backlinks`, { cookie: member }),
      BacklinksResponseSchema,
    );
    expect(theirs.backlinks.map((link) => link.path)).toEqual(['eng/onboarding']);
  });

  it('refuses a write into a space the caller cannot see', async () => {
    const { member, pageId } = await ownedSpace();
    const headers = { cookie: member };

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers,
      payload: { path: 'notes/intrusion', title: 'Intrusion', markdown: 'Hello?' },
    });
    expect(created.statusCode).toBe(404);

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${pageId}`,
      headers,
      payload: { title: 'Renamed' },
    });
    expect(patched.statusCode).toBe(404);

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${pageId}`,
      headers,
    });
    expect(deleted.statusCode).toBe(404);

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/spaces/notes',
      headers,
      payload: { name: 'Taken over' },
    });
    expect(renamed.statusCode).toBe(404);
  });

  it('refuses a move of a public page into a space the caller cannot see', async () => {
    const owner = await claim();
    const member = await invite(owner, 'Grace Hopper', 'grace@example.com');
    const { pageIds } = await seed(harness);
    expect((await makeSpace(owner, 'notes', 'Notes', true)).statusCode).toBe(200);

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${pageIds[0] ?? ''}`,
      headers: { cookie: member },
      payload: { path: 'notes/stolen' },
    });
    expect(moved.statusCode).toBe(404);
  });

  it('refuses a private space to a caller who is not a person', async () => {
    await seed(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'notes', name: 'Notes', private: true },
    });
    expect(response.statusCode).toBe(401);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');
  });

  it('leaves a space public when the body does not ask for a private one', async () => {
    const owner = await claim();
    await seed(harness);

    const created = await makeSpace(owner, 'team', 'Team', false);
    expect(bodyOf(created, SpaceResponseSchema).space.owner).toBeUndefined();
    expect(harness.git.excluded).toEqual([]);
  });

  it('excludes the space from git before any of its files exist', async () => {
    await ownedSpace();

    expect(harness.git.excluded).toContain('notes');
    await harness.git.flush();

    const tracked = await gitLines(['ls-files']);
    expect(tracked.filter((file) => file.startsWith('notes/'))).toEqual([]);
    expect(tracked).toContain('eng/deploy.md');
    // Nothing is left over for a later commit to pick up either.
    expect((await harness.git.status()).dirtyFiles).toEqual([]);
  });

  it('excludes the attachments of a private page, which live outside its space', async () => {
    const { owner, pageId } = await ownedSpace();

    const built = multipart({
      fields: { pageId },
      filename: 'plan.png',
      contentType: 'image/png',
      data: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    });
    const uploaded = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { cookie: owner, ...built.headers },
      payload: built.payload,
    });
    expect(uploaded.statusCode).toBe(200);

    expect(harness.git.excluded).toContain(`_assets/${pageId}`);
    await harness.git.flush();
    expect((await gitLines(['ls-files'])).filter((file) => file.startsWith('_assets/'))).toEqual([]);
  });

  it('keeps the owner through a rename, so a patch cannot make the space public', async () => {
    const { owner, member } = await ownedSpace();

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/spaces/notes',
      headers: { cookie: owner },
      payload: { name: 'Private notes' },
    });
    expect(bodyOf(renamed, SpaceResponseSchema).space.owner).toBeDefined();
    expect(slugsOf(await get('/api/v1/spaces', { cookie: member }))).not.toContain('notes');
  });
});
