import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_SLUG,
  ErrorBodySchema,
  PageListResponseSchema,
  PageResponseSchema,
  SpacesResponseSchema,
  TreeResponseSchema,
  WORKSPACE_HEADER,
  WorkspaceMembersResponseSchema,
  WorkspaceResponseSchema,
  WorkspacesResponseSchema,
} from '@tablinum/shared';
import { readZip } from '../src/zip.js';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';
import { multipart } from './support/multipart.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

/** Headers that point a request at one workspace. */
function inside(slug: string): Record<string, string> {
  return { ...harness.authHeaders(), [WORKSPACE_HEADER]: slug };
}

async function createWorkspace(name = 'Handbook') {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    headers: harness.authHeaders(),
    payload: { name },
  });
  expect(response.statusCode).toBe(201);
  return bodyOf(response, WorkspaceResponseSchema).workspace;
}

const PASSWORD = 'correct horse battery staple';

/** The cookie half of a Set-Cookie header. */
function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response carries no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

/** An account and the cookie it signs in with: a machine credential cannot do everything. */
async function signIn(email: string, name: string, role: 'admin' | 'member' = 'member') {
  const account = harness.accounts.createUser({ email, name, password: PASSWORD, role });
  const login = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  return { account, cookie: cookieOf(login) };
}

describe('workspaces', () => {
  it('starts with the workspace the server was configured with', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: harness.authHeaders(),
    });
    const body = bodyOf(response, WorkspacesResponseSchema);
    expect(body.workspaces.map((one) => one.slug)).toEqual([DEFAULT_WORKSPACE_SLUG]);
    expect(body.current).toBe(DEFAULT_WORKSPACE_SLUG);
  });

  it('creates a workspace with a slug of its own and a space to start from', async () => {
    const created = await createWorkspace('Team Handbook');
    expect(created.slug).toBe('team-handbook');

    const spaces = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: inside(created.slug),
    });
    expect(bodyOf(spaces, SpacesResponseSchema).spaces.map((one) => one.slug)).toEqual(['general']);
  });

  it('keeps the pages of two workspaces apart', async () => {
    await seed(harness);
    const other = await createWorkspace();

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: harness.authHeaders(),
    });
    expect(bodyOf(mine, PageListResponseSchema).pages.map((page) => page.path)).toContain('eng/deploy');

    const theirs = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: inside(other.slug),
    });
    const paths = bodyOf(theirs, PageListResponseSchema).pages.map((page) => page.path);
    expect(paths).toEqual(['general']);

    // A page written in the second workspace stays there.
    const written = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: inside(other.slug),
      payload: { path: 'general/welcome', title: 'Welcome', markdown: 'Hello.' },
    });
    expect(written.statusCode).toBe(201);

    const again = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: harness.authHeaders(),
    });
    const home = bodyOf(again, PageListResponseSchema).pages.map((page) => page.path);
    expect(home).not.toContain('general/welcome');
  });

  it('takes the workspace from the query string too', async () => {
    const other = await createWorkspace();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/spaces?workspace=${other.slug}`,
      headers: harness.authHeaders(),
    });
    expect(bodyOf(response, SpacesResponseSchema).spaces.map((one) => one.slug)).toEqual(['general']);
  });

  it('answers NOT_FOUND for a workspace nobody created', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: inside('nowhere'),
    });
    expect(response.statusCode).toBe(404);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('NOT_FOUND');
  });

  it('renames a workspace and refuses to delete the configured one', async () => {
    const created = await createWorkspace();

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${created.id}`,
      headers: harness.authHeaders(),
      payload: { name: 'The Handbook', icon: '📗' },
    });
    const after = bodyOf(patched, WorkspaceResponseSchema).workspace;
    expect(after.name).toBe('The Handbook');
    expect(after.icon).toBe('📗');

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: harness.authHeaders(),
    });
    const defaultId = bodyOf(listed, WorkspacesResponseSchema).workspaces.find(
      (one) => one.slug === DEFAULT_WORKSPACE_SLUG,
    )?.id;

    const refused = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${defaultId ?? ''}`,
      headers: harness.authHeaders(),
    });
    expect(refused.statusCode).toBe(400);

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${created.id}`,
      headers: harness.authHeaders(),
    });
    expect(removed.statusCode).toBe(200);

    const gone = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: inside(created.slug),
    });
    expect(gone.statusCode).toBe(404);
  });
});

describe('workspace members', () => {
  it('adds a person, changes their role and takes them out again', async () => {
    const created = await createWorkspace();
    const sam = harness.accounts.createUser({
      email: 'sam@example.com',
      name: 'Sam Rivers',
      password: 'correct horse battery staple',
    });

    const added = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${created.id}/members`,
      headers: harness.authHeaders(),
      payload: { userId: sam.id },
    });
    expect(added.statusCode).toBe(200);

    // The roster is for people, so it takes an account rather than the api token.
    const ada = await signIn('ada@example.com', 'Ada Lovelace', 'admin');
    const listed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${created.id}/members`,
      headers: { cookie: ada.cookie },
    });
    const members = bodyOf(listed, WorkspaceMembersResponseSchema).members;
    expect(members.map((one) => one.account.id)).toEqual([sam.id]);
    expect(members[0]?.role).toBe('member');

    const promoted = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${created.id}/members/${sam.id}`,
      headers: harness.authHeaders(),
      payload: { role: 'admin' },
    });
    expect(promoted.statusCode).toBe(200);
    expect(harness.accounts.memberRole(created.id, sam.id)).toBe('admin');

    // An admin has to stay behind, so Ada joins before Sam goes.
    const second = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${created.id}/members`,
      headers: harness.authHeaders(),
      payload: { userId: ada.account.id, role: 'admin' },
    });
    expect(second.statusCode).toBe(200);

    const dropped = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${created.id}/members/${sam.id}`,
      headers: harness.authHeaders(),
    });
    expect(dropped.statusCode).toBe(200);
    expect(harness.accounts.memberRole(created.id, sam.id)).toBeNull();
  });

  it('refuses a role change for somebody who is not a member', async () => {
    const created = await createWorkspace();
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${created.id}/members/us_00000000000000000000000000`,
      headers: harness.authHeaders(),
      payload: { role: 'admin' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('revoking a membership revokes access', () => {
  it('answers 401 instead of handing over the default workspace', async () => {
    await seed(harness);
    const other = await createWorkspace();
    const bob = await signIn('bob@example.com', 'Bob Reyes');
    harness.accounts.addMember(other.id, bob.account.id);

    const mine = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tree',
      headers: { cookie: bob.cookie },
    });
    expect(mine.statusCode).toBe(200);
    expect(bodyOf(mine, TreeResponseSchema).spaces.map((one) => one.slug)).toEqual(['general']);

    const dropped = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${other.id}/members/${bob.account.id}`,
      headers: harness.authHeaders(),
    });
    expect(dropped.statusCode).toBe(200);

    // The cookie dies with the membership it was reaching the workspace through.
    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tree',
      headers: { cookie: bob.cookie },
    });
    expect(after.statusCode).toBe(401);

    // And signing in again reaches nothing, not the workspace he was never a member of.
    const again = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'bob@example.com', password: PASSWORD },
    });
    const refused = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tree',
      headers: { cookie: cookieOf(again) },
    });
    expect(refused.statusCode).toBe(401);
    expect(bodyOf(refused, ErrorBodySchema).error.message).toContain('not in any workspace');
  });

  it('refuses to remove yourself, or the last admin of a workspace', async () => {
    const other = await createWorkspace();
    const ada = await signIn('ada@example.com', 'Ada Lovelace');
    harness.accounts.addMember(other.id, ada.account.id, 'admin');

    const self = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${other.id}/members/${ada.account.id}`,
      headers: { cookie: ada.cookie },
    });
    expect(self.statusCode).toBe(409);
    expect(harness.accounts.memberRole(other.id, ada.account.id)).toBe('admin');

    const lastAdmin = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${other.id}/members/${ada.account.id}`,
      headers: harness.authHeaders(),
    });
    expect(lastAdmin.statusCode).toBe(409);
    expect(bodyOf(lastAdmin, ErrorBodySchema).error.message).toContain('at least one admin');
  });
});

describe('workspace export and import', () => {
  it('exports the repository as a zip and imports it back as a new workspace', async () => {
    await seed(harness);
    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/workspaces',
      headers: harness.authHeaders(),
    });
    const mine = bodyOf(listed, WorkspacesResponseSchema).workspaces[0];
    expect(mine).toBeDefined();

    const exported = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${mine?.id ?? ''}/export`,
      headers: harness.authHeaders(),
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toBe('application/zip');
    expect(exported.headers['content-disposition']).toBe(`attachment; filename="${mine?.slug}.zip"`);

    const archive = exported.rawPayload;
    const names = readZip(archive).map((entry) => entry.name);
    expect(names).toContain('eng/deploy.md');
    // The history travels with it, which is the whole point of shipping the repository.
    expect(names.some((name) => name.startsWith('.git/'))).toBe(true);

    const built = multipart({
      fields: { name: 'Copy of Engineering' },
      filename: 'main.zip',
      contentType: 'application/zip',
      data: archive,
    });
    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/import',
      headers: { ...harness.authHeaders(), ...built.headers },
      payload: built.payload,
    });
    expect(imported.statusCode).toBe(201);
    const copy = bodyOf(imported, WorkspaceResponseSchema).workspace;
    expect(copy.name).toBe('Copy of Engineering');
    expect(copy.slug).toBe('copy-of-engineering');

    const pages = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: inside(copy.slug),
    });
    const paths = bodyOf(pages, PageListResponseSchema).pages.map((page) => page.path);
    expect(paths).toContain('eng/deploy');
    expect(paths).toContain('eng/oncall');

    // The copy is a repository of its own: a write to it leaves the original alone.
    const edited = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${
        bodyOf(pages, PageListResponseSchema).pages.find((page) => page.path === 'eng/deploy')?.id ?? ''
      }`,
      headers: inside(copy.slug),
      payload: { markdown: 'Rewritten in the copy.' },
    });
    expect(bodyOf(edited, PageResponseSchema).page.markdown).toBe('Rewritten in the copy.');

    const original = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages?path=eng/deploy',
      headers: harness.authHeaders(),
    });
    expect(bodyOf(original, PageResponseSchema).page.markdown).not.toBe('Rewritten in the copy.');
  });

  /** The export commits before it zips, so another site must not be able to fire it. */
  it('refuses an export another site navigated to, and allows one from the app', async () => {
    const url = `/api/v1/workspaces/${DEFAULT_WORKSPACE_SLUG}/export`;

    const foreign = await harness.app.inject({
      method: 'GET',
      url,
      headers: { ...harness.authHeaders(), 'sec-fetch-site': 'cross-site' },
    });
    expect(foreign.statusCode).toBe(401);
    expect(bodyOf(foreign, ErrorBodySchema).error.code).toBe('UNAUTHORIZED');

    const ours = await harness.app.inject({
      method: 'GET',
      url,
      headers: { ...harness.authHeaders(), 'sec-fetch-site': 'same-origin' },
    });
    expect(ours.statusCode).toBe(200);
    expect(ours.headers['content-type']).toBe('application/zip');
  });

  it('names the workspace after the file when the upload carries no name', async () => {
    const built = multipart({
      filename: 'field-notes.zip',
      contentType: 'application/zip',
      data: (
        await harness.app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${DEFAULT_WORKSPACE_SLUG}/export`,
          headers: harness.authHeaders(),
        })
      ).rawPayload,
    });
    const imported = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/import',
      headers: { ...harness.authHeaders(), ...built.headers },
      payload: built.payload,
    });
    expect(bodyOf(imported, WorkspaceResponseSchema).workspace.name).toBe('field notes');
  });

  it('refuses an upload that is not a zip', async () => {
    const built = multipart({
      filename: 'notes.zip',
      contentType: 'application/zip',
      data: Buffer.from('this is not an archive'),
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/workspaces/import',
      headers: { ...harness.authHeaders(), ...built.headers },
      payload: built.payload,
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });
});

describe('agents and workspaces', () => {
  it('pins an agent token to the workspace it was made in', async () => {
    const other = await createWorkspace();

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: inside(other.slug),
      payload: { name: 'Doc Bot', identity: 'You keep the handbook tidy.' },
    });
    const token = JSON.parse(created.body).token as string;
    const headers = { authorization: `Bearer ${token}` };

    // Even asked for the default workspace by header, the agent only ever sees its own.
    const spaces = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: { ...headers, [WORKSPACE_HEADER]: DEFAULT_WORKSPACE_SLUG },
    });
    expect(bodyOf(spaces, SpacesResponseSchema).spaces.map((one) => one.slug)).toEqual(['general']);
  });
});
