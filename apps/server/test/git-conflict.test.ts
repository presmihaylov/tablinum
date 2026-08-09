import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GitConflictResponseSchema,
  GitResolveResponseSchema,
  PageResponseSchema,
  hasConflictMarkers,
  type Account,
} from '@tablinum/shared';
import type { WorkspaceRecord } from '@tablinum/accounts';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

function headers(): Record<string, string> {
  return harness.authHeaders();
}

const FILE = 'eng/deploy.md';
const PASSWORD = 'correct horse battery staple';

/** The default workspace, the one the harness was configured with. */
function defaultWorkspace(): WorkspaceRecord {
  const record = harness.accounts.listWorkspaces()[0];
  if (record === undefined) throw new Error('The harness has no workspace');
  return record;
}

/** A signed-in member of the default workspace, plus the cookie half of its Set-Cookie. */
async function signIn(): Promise<{ account: Account; cookie: string }> {
  const email = 'mia@example.com';
  const account = harness.accounts.createUser({ email, name: 'Mia Novak', password: PASSWORD });
  harness.accounts.addMember(defaultWorkspace().id, account.id, 'member');

  const login = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  const raw = login.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The login set no cookie');
  return { account, cookie: first.split(';')[0] ?? '' };
}

function pageFile(id: string, body: string): string {
  return [
    '---',
    `id: ${id}`,
    'title: "Deploy runbook"',
    'created: "2026-01-01T00:00:00.000Z"',
    'updated: "2026-01-01T00:00:00.000Z"',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** Pretend a pull stopped on a conflict, with the three versions git would hand over. */
function armConflict(id: string, base: string, local: string, remote: string): void {
  harness.git.conflict = {
    files: [FILE],
    message: 'CONFLICT (content): Merge conflict in eng/deploy.md',
    at: '2026-01-01T00:00:00.000Z',
  };
  harness.git.versions = [
    {
      file: FILE,
      base: pageFile(id, base),
      local: pageFile(id, local),
      remote: pageFile(id, remote),
    },
  ];
}

describe('git conflict endpoints', () => {
  it('says there is nothing to resolve on a clean repo', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/git/conflict',
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response, GitConflictResponseSchema);
    expect(body.conflict).toBeNull();
    expect(body.files).toEqual([]);
  });

  it('merges the two sides when they touch different lines', async () => {
    const { pageIds } = await seed(harness);
    const id = pageIds[0] ?? '';
    armConflict(
      id,
      'one\ntwo\nthree\n',
      'ONE\ntwo\nthree\n',
      'one\ntwo\nTHREE\n',
    );

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/git/conflict',
      headers: headers(),
    });
    const body = bodyOf(response, GitConflictResponseSchema);
    expect(body.conflict?.files).toEqual([FILE]);
    expect(body.files).toHaveLength(1);

    const file = body.files[0];
    expect(file?.clean).toBe(true);
    expect(file?.path).toBe('eng/deploy');
    expect(file?.title).toBe('Deploy runbook');
    expect(file?.merged).toContain('ONE');
    expect(file?.merged).toContain('THREE');
    expect(hasConflictMarkers(file?.merged ?? '')).toBe(false);
  });

  it('marks the file unclean and keeps both sides when the same line moved', async () => {
    const { pageIds } = await seed(harness);
    armConflict(pageIds[0] ?? '', 'one\n', 'local wins\n', 'remote wins\n');

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/git/conflict',
      headers: headers(),
    });
    const file = bodyOf(response, GitConflictResponseSchema).files[0];
    expect(file?.clean).toBe(false);
    expect(hasConflictMarkers(file?.merged ?? '')).toBe(true);
    expect(file?.merged).toContain('local wins');
    expect(file?.merged).toContain('remote wins');
  });

  it('writes the chosen text, clears the conflict and republishes the page', async () => {
    const { pageIds } = await seed(harness);
    const id = pageIds[0] ?? '';
    armConflict(id, 'one\n', 'local wins\n', 'remote wins\n');

    const resolved = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/resolve',
      headers: headers(),
      payload: { files: [{ file: FILE, content: pageFile(id, 'agreed text') }] },
    });
    expect(resolved.statusCode).toBe(200);
    const body = bodyOf(resolved, GitResolveResponseSchema);
    expect(body.resolved).toEqual([FILE]);
    expect(body.status.conflict).toBeNull();

    const onDisk = await readFile(join(harness.contentDir, FILE), 'utf8');
    expect(onDisk).toContain('agreed text');

    const page = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${id}`,
      headers: headers(),
    });
    expect(bodyOf(page, PageResponseSchema).page.markdown.trim()).toBe('agreed text');
  });

  it('rejects a resolution with no files', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/resolve',
      headers: headers(),
      payload: { files: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a resolution that names git metadata', async () => {
    const { pageIds } = await seed(harness);
    armConflict(pageIds[0] ?? '', 'one\n', 'local wins\n', 'remote wins\n');
    const config = join(harness.contentDir, '.git', 'config');
    const before = await readFile(config, 'utf8');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/resolve',
      headers: headers(),
      payload: { files: [{ file: '.git/config', content: '[core]\n\tfsmonitor = "touch x"\n' }] },
    });

    expect(response.statusCode).toBe(400);
    expect(await readFile(config, 'utf8')).toBe(before);
  });

  it('rejects a commit message that carries the git log separators', async () => {
    const { pageIds } = await seed(harness);
    const id = pageIds[0] ?? '';
    armConflict(id, 'one\n', 'local wins\n', 'remote wins\n');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/resolve',
      headers: headers(),
      payload: {
        files: [{ file: FILE, content: pageFile(id, 'agreed text') }],
        message: `docs: fix${String.fromCharCode(30)}forged`,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('lets an admin of the workspace resolve, and nobody else', async () => {
    const { pageIds } = await seed(harness);
    const id = pageIds[0] ?? '';
    armConflict(id, 'one\n', 'local wins\n', 'remote wins\n');
    const { account, cookie } = await signIn();
    const payload = { files: [{ file: FILE, content: pageFile(id, 'agreed text') }] };

    const refused = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/resolve',
      headers: { cookie },
      payload,
    });
    expect(refused.statusCode).toBe(401);
    expect(harness.git.conflict).not.toBeNull();

    harness.accounts.addMember(defaultWorkspace().id, account.id, 'admin');

    const allowed = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/git/resolve',
      headers: { cookie },
      payload,
    });
    expect(allowed.statusCode).toBe(200);
    expect(harness.git.conflict).toBeNull();
  });
});
