import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceRecord } from '@tablinum/accounts';
import {
  AssetResponseSchema,
  PageListResponseSchema,
  PageResponseSchema,
  RescanResponseSchema,
  SearchResponseSchema,
  assetDirRelPath,
  newPageId,
  type Account,
  type Page,
} from '@tablinum/shared';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';
import { multipart } from './support/multipart.js';

/**
 * The rescan route: the one way an operator asks the server to read a working tree somebody
 * else rewrote, and the only thing that collects attachments orphaned before a page delete
 * took them with it.
 */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PASSWORD = 'correct horse battery staple';

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

function rescan(extra: Record<string, string> = headers()) {
  return harness.app.inject({ method: 'POST', url: '/api/v1/rescan', headers: extra });
}

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

async function createPage(path: string, title: string, markdown: string): Promise<Page> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: headers(),
    payload: { path, title, markdown },
  });
  expect(response.statusCode).toBe(201);
  return bodyOf(response, PageResponseSchema).page;
}

async function upload(pageId: string, filename: string): Promise<string> {
  const built = multipart({ fields: { pageId }, filename, contentType: 'image/png', data: PNG });
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/assets',
    headers: { ...headers(), ...built.headers },
    payload: built.payload,
  });
  expect(response.statusCode).toBe(200);
  return bodyOf(response, AssetResponseSchema).url;
}

/** Write a page file straight to disk, the way a restore or a checkout would. */
async function writePageFile(relFile: string, title: string, body: string): Promise<void> {
  const text = [
    '---',
    `id: ${newPageId()}`,
    `title: ${JSON.stringify(title)}`,
    'created: "2026-01-01T00:00:00.000Z"',
    'updated: "2026-01-01T00:00:00.000Z"',
    '---',
    '',
    body,
    '',
  ].join('\n');
  await writeFile(join(harness.contentDir, relFile), text, 'utf8');
}

async function found(query: string): Promise<string[]> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/search?q=${encodeURIComponent(query)}`,
    headers: headers(),
  });
  return bodyOf(response, SearchResponseSchema).hits.map((hit) => hit.path);
}

async function pageCount(): Promise<number> {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/pages',
    headers: headers(),
  });
  return bodyOf(response, PageListResponseSchema).pages.length;
}

function assetDir(pageId: string): string {
  return join(harness.contentDir, assetDirRelPath(pageId));
}

/** Open a comment thread on a page, straight into the account database the routes write to. */
function comment(pageId: string, body: string): void {
  const author = harness.accounts.createUser({
    email: `${pageId}@example.com`,
    name: 'Ines Roy',
    password: PASSWORD,
  });
  harness.accounts.createThread(defaultWorkspace().id, { pageId, author: author.id, body });
}

describe('POST /rescan', () => {
  it('lets an admin of the workspace rescan, and nobody else', async () => {
    await seed(harness);
    const { account, cookie } = await signIn();

    // Nobody at all, then somebody who is only a member of the workspace.
    expect((await rescan({})).statusCode).toBe(401);
    expect((await rescan({ cookie })).statusCode).toBe(401);

    harness.accounts.addMember(defaultWorkspace().id, account.id, 'admin');

    const allowed = await rescan({ cookie });
    expect(allowed.statusCode).toBe(200);
  });

  it('rebuilds the store index and the search index, in that order', async () => {
    await seed(harness);
    // A file written behind the server's back, and one taken away behind its back.
    await writePageFile('eng/restored.md', 'Restored runbook', 'Turbolift the pangolin.');
    await rm(join(harness.contentDir, 'eng/oncall.md'));

    expect(await found('pangolin')).toEqual([]);
    expect(await found('escalate')).toEqual(['eng/oncall']);

    // The store must be read back before the search index is built from it, so the order is
    // part of what the route promises.
    const order: string[] = [];
    const rebuild = harness.store.rebuild.bind(harness.store);
    harness.store.rebuild = async (): Promise<void> => {
      order.push('store');
      await rebuild();
    };
    const reindexAll = harness.search.reindexAll.bind(harness.search);
    harness.search.reindexAll = async (pages): Promise<number> => {
      order.push('search');
      return reindexAll(pages);
    };

    const response = await rescan();
    expect(response.statusCode).toBe(200);
    const body = bodyOf(response, RescanResponseSchema);

    expect(order).toEqual(['store', 'search']);
    expect(body.pages).toBe(await pageCount());
    // The page nobody told the server about is searchable, and the one that went is not.
    expect(await found('pangolin')).toEqual(['eng/restored']);
    expect(await found('escalate')).toEqual([]);
  });

  it('collects the attachments of a page that is already gone', async () => {
    await seed(harness);
    const page = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    await upload(page.id, 'plan.png');

    // What the buggy delete left: the page file went, the attachments stayed, and no delete
    // will ever name this id again.
    await rm(join(harness.contentDir, 'eng/plan.md'));
    expect(existsSync(assetDir(page.id))).toBe(true);

    const body = bodyOf(await rescan(), RescanResponseSchema);

    expect(body.removedAssets).toEqual([`${assetDirRelPath(page.id)}/plan.png`]);
    expect(existsSync(assetDir(page.id))).toBe(false);
  });

  it('keeps an attachment a surviving page still points at', async () => {
    await seed(harness);
    const page = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    const url = await upload(page.id, 'plan.png');
    // What "Duplicate page" writes: the copy carries the original's attachment urls.
    await createPage('eng/plan-copy', 'Plan copy', `![plan](${url})`);
    await rm(join(harness.contentDir, 'eng/plan.md'));

    const body = bodyOf(await rescan(), RescanResponseSchema);

    expect(body.removedAssets).toEqual([]);
    expect(existsSync(assetDir(page.id))).toBe(true);
  });

  it('keeps the attachments of a page that is still there', async () => {
    await seed(harness);
    const page = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    await upload(page.id, 'plan.png');

    const body = bodyOf(await rescan(), RescanResponseSchema);

    expect(body.removedAssets).toEqual([]);
    expect(existsSync(assetDir(page.id))).toBe(true);
  });
});

/**
 * A comment renders markdown, so a comment body is a reference like any other. Bodies live in
 * the account database rather than in the content tree, so the store cannot see them and the
 * sweep has to be handed them.
 */
describe('the sweep and comment bodies', () => {
  it('keeps an attachment only a comment points at', async () => {
    await seed(harness);
    const page = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    const url = await upload(page.id, 'plan.png');
    const other = await createPage('eng/notes', 'Notes', 'Nothing yet.');
    comment(other.id, `Still true? ![plan](${url})`);

    await rm(join(harness.contentDir, 'eng/plan.md'));

    const body = bodyOf(await rescan(), RescanResponseSchema);

    expect(body.removedAssets).toEqual([]);
    expect(existsSync(assetDir(page.id))).toBe(true);
  });

  it('still collects one no page and no comment points at', async () => {
    await seed(harness);
    const page = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    await upload(page.id, 'plan.png');
    // A comment that names somebody else's attachment must not save this one.
    const other = await createPage('eng/notes', 'Notes', 'Nothing yet.');
    comment(other.id, `Look: ![x](/${assetDirRelPath(newPageId())}/x.png)`);

    await rm(join(harness.contentDir, 'eng/plan.md'));

    const body = bodyOf(await rescan(), RescanResponseSchema);

    expect(body.removedAssets).toEqual([`${assetDirRelPath(page.id)}/plan.png`]);
    expect(existsSync(assetDir(page.id))).toBe(false);
  });

  it('keeps everything when the comment source cannot be read', async () => {
    await seed(harness);
    const page = await createPage('eng/plan', 'Plan', 'Nothing yet.');
    await upload(page.id, 'plan.png');
    await rm(join(harness.contentDir, 'eng/plan.md'));

    // A database that will not answer says nothing about references, and "nothing" must never
    // be read as "none": deleting an attachment out of a private space is unrecoverable.
    harness.accounts.commentBodiesContaining = (): string[] => {
      throw new Error('the account database is locked');
    };

    const body = bodyOf(await rescan(), RescanResponseSchema);

    expect(body.removedAssets).toEqual([]);
    expect(existsSync(assetDir(page.id))).toBe(true);
  });
});
