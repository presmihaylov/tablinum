import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthResponseSchema,
  CommentThreadResponseSchema,
  DeleteSpaceResponseSchema,
  ErrorBodySchema,
  InviteResponseSchema,
  PageResponseSchema,
  SearchResponseSchema,
  SpaceResponseSchema,
  SpacesResponseSchema,
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

/** Invite a second person into the workspace and sign them in. They are a member, not an admin. */
async function invite(
  adminCookie: string,
  name = 'Grace Hopper',
  email = 'grace@example.com',
): Promise<string> {
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

function deleteSpace(slug: string, headers: Record<string, string>, recursive = false) {
  const query = recursive ? '?recursive=true' : '';
  return harness.app.inject({ method: 'DELETE', url: `/api/v1/spaces/${slug}${query}`, headers });
}

async function slugs(headers: Record<string, string>): Promise<string[]> {
  const response = await harness.app.inject({ method: 'GET', url: '/api/v1/spaces', headers });
  return bodyOf(response, SpacesResponseSchema).spaces.map((space) => space.slug);
}

/** A private space with one page in it, owned by whoever this cookie signs in. */
async function privateSpace(cookie: string, slug = 'notes'): Promise<string> {
  const created = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/spaces',
    headers: { cookie },
    payload: { slug, name: 'Notes', private: true },
  });
  expect(created.statusCode).toBe(200);
  expect(bodyOf(created, SpaceResponseSchema).space.owner).toBeDefined();

  const page = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: { cookie },
    payload: { path: `${slug}/salary`, title: 'Salary', markdown: 'The word here is aardvark.' },
  });
  expect(page.statusCode).toBe(201);
  return bodyOf(page, PageResponseSchema).page.id;
}

async function excludeFile(): Promise<string> {
  const file = join(harness.contentDir, '.git', 'info', 'exclude');
  return existsSync(file) ? readFile(file, 'utf8') : '';
}

describe('DELETE /api/v1/spaces/:slug', () => {
  it('refuses a member, because the delete takes every page in the space', async () => {
    const admin = await claim();
    const member = await invite(admin);
    await seed(harness);

    const response = await deleteSpace('eng', { cookie: member }, true);
    expect(response.statusCode).toBe(401);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');
    expect(await slugs({ cookie: admin })).toContain('eng');
    expect(existsSync(join(harness.contentDir, 'eng/_space.yml'))).toBe(true);
  });

  it('refuses a space that holds pages when the flag is absent', async () => {
    await seed(harness);

    const response = await deleteSpace('eng', harness.authHeaders());
    expect(response.statusCode).toBe(409);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('CONFLICT');
    expect(await slugs(harness.authHeaders())).toContain('eng');
    expect(existsSync(join(harness.contentDir, 'eng/deploy.md'))).toBe(true);
  });

  it('deletes a space that holds only its home page without the flag', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'empty', name: 'Empty' },
    });
    expect(created.statusCode).toBe(200);

    const response = await deleteSpace('empty', harness.authHeaders());
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response, DeleteSpaceResponseSchema).deleted).toEqual(['empty']);
    expect(existsSync(join(harness.contentDir, 'empty'))).toBe(false);
  });

  it('takes the descriptor and every page with it when the flag is set', async () => {
    await seed(harness);

    const response = await deleteSpace('eng', harness.authHeaders(), true);
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response, DeleteSpaceResponseSchema);
    expect(body.slug).toBe('eng');
    expect(body.deleted).toEqual(['eng', 'eng/deploy', 'eng/oncall']);
    // A public space is committed, so git is where the pages went.
    expect(body.recoverable).toBe(true);
    expect(body.recovery).toContain('git log');

    expect(await slugs(harness.authHeaders())).not.toContain('eng');
    expect(existsSync(join(harness.contentDir, 'eng'))).toBe(false);
  });

  it('answers NOT_FOUND for a space nobody made', async () => {
    const response = await deleteSpace('ghost', harness.authHeaders(), true);
    expect(response.statusCode).toBe(404);
    // The route has to answer, so the message names the space. A missing route says "no route".
    expect(bodyOf(response, ErrorBodySchema).error.message).toBe('No space ghost');
  });

  it('drops the .git/info/exclude line that hid a private space', async () => {
    const admin = await claim();
    await seed(harness);
    await privateSpace(admin);

    expect(harness.git.excluded).toContain('notes');
    expect(await excludeFile()).toContain('/notes/');

    const response = await deleteSpace('notes', { cookie: admin }, true);
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response, DeleteSpaceResponseSchema);
    // No commit ever held a private space, so there is nothing in git to go back to.
    expect(body.recoverable).toBe(false);
    expect(body.recovery).toContain('private');

    expect(harness.git.excluded).not.toContain('notes');
    expect(await excludeFile()).not.toContain('/notes/');
    expect(existsSync(join(harness.contentDir, 'notes'))).toBe(false);
  });

  it('lets the owner of a private space delete it, though the owner is no admin', async () => {
    const admin = await claim();
    const member = await invite(admin);
    await seed(harness);
    await privateSpace(member);

    const response = await deleteSpace('notes', { cookie: member }, true);
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response, DeleteSpaceResponseSchema);
    expect(body.deleted).toEqual(['notes', 'notes/salary']);
    expect(body.recoverable).toBe(false);

    expect(await slugs({ cookie: member })).not.toContain('notes');
    expect(existsSync(join(harness.contentDir, 'notes'))).toBe(false);
    expect(harness.git.excluded).not.toContain('notes');
    expect(await excludeFile()).not.toContain('/notes/');
  });

  it('answers NOT_FOUND, never UNAUTHORIZED, for the private space of somebody else', async () => {
    const admin = await claim();
    const owner = await invite(admin);
    const stranger = await invite(admin, 'Alan Turing', 'alan@example.com');
    await privateSpace(owner);

    // A 401 would say the slug is taken. An unclaimed slug has to answer the same way.
    for (const cookie of [stranger, admin]) {
      const hidden = await deleteSpace('notes', { cookie }, true);
      const unclaimed = await deleteSpace('ghost', { cookie }, true);
      expect(hidden.statusCode).toBe(404);
      expect(bodyOf(hidden, ErrorBodySchema).error.code).toBe('NOT_FOUND');
      expect(unclaimed.statusCode).toBe(hidden.statusCode);
      expect(bodyOf(unclaimed, ErrorBodySchema).error.code).toBe(
        bodyOf(hidden, ErrorBodySchema).error.code,
      );
    }

    expect(await slugs({ cookie: owner })).toContain('notes');
    expect(existsSync(join(harness.contentDir, 'notes/_space.yml'))).toBe(true);
  });

  it('still lets an install admin delete a space that belongs to nobody', async () => {
    const admin = await claim();
    await invite(admin);
    await seed(harness);

    const response = await deleteSpace('eng', { cookie: admin }, true);
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response, DeleteSpaceResponseSchema).deleted).toEqual([
      'eng',
      'eng/deploy',
      'eng/oncall',
    ]);
    expect(existsSync(join(harness.contentDir, 'eng'))).toBe(false);
  });

  it('takes the deleted pages out of the search index', async () => {
    await seed(harness);
    const before = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=pipeline',
      headers: harness.authHeaders(),
    });
    expect(bodyOf(before, SearchResponseSchema).hits.map((hit) => hit.path)).toContain('eng/deploy');

    expect((await deleteSpace('eng', harness.authHeaders(), true)).statusCode).toBe(200);

    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=pipeline',
      headers: harness.authHeaders(),
    });
    expect(bodyOf(after, SearchResponseSchema).hits).toEqual([]);
  });

  it('takes the comment threads anchored to the deleted pages with it', async () => {
    const admin = await claim();
    const { pageIds } = await seed(harness);
    const pageId = pageIds[0];
    if (pageId === undefined) throw new Error('The seed made no page');

    const opened = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/pages/${pageId}/comments`,
      headers: { cookie: admin },
      payload: { body: 'Does this still hold?' },
    });
    expect(opened.statusCode).toBe(201);
    expect(bodyOf(opened, CommentThreadResponseSchema).thread.pageId).toBe(pageId);

    const workspaceId = harness.accounts.listWorkspaces()[0]?.id;
    if (workspaceId === undefined) throw new Error('The install has no workspace');
    expect(harness.accounts.listThreads(workspaceId, pageId)).toHaveLength(1);

    expect((await deleteSpace('eng', { cookie: admin }, true)).statusCode).toBe(200);
    expect(harness.accounts.listThreads(workspaceId, pageId)).toEqual([]);
  });

  it('leaves the git working tree with nothing left to commit', async () => {
    await seed(harness);
    await harness.git.flush();
    expect(await harness.git.lsFiles()).toContain('eng/deploy.md');

    expect((await deleteSpace('eng', harness.authHeaders(), true)).statusCode).toBe(200);

    await harness.git.flush();
    expect((await harness.git.lsFiles()).filter((file) => file.startsWith('eng/'))).toEqual([]);
    expect((await harness.git.status()).dirtyFiles).toEqual([]);
  });
});
