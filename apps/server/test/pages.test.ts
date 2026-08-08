import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BacklinksResponseSchema,
  DeletePageResponseSchema,
  ErrorBodySchema,
  PageListResponseSchema,
  PageResponseSchema,
} from '@gitdocs/shared';
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

async function createPage(payload: Record<string, unknown>) {
  return harness.app.inject({ method: 'POST', url: '/api/v1/pages', headers: headers(), payload });
}

describe('page lifecycle', () => {
  it('creates, reads, lists, updates and deletes a page', async () => {
    await seed(harness);

    const created = await createPage({
      path: 'eng/rollback',
      title: 'Rollback',
      markdown: 'Roll back with one command.',
      icon: '⏪',
      tags: ['ops'],
      order: 5,
      props: { status: 'draft' },
    });
    expect(created.statusCode).toBe(201);
    const page = bodyOf(created, PageResponseSchema).page;
    expect(page.path).toBe('eng/rollback');
    expect(page.space).toBe('eng');
    expect(page.icon).toBe('⏪');
    expect(page.tags).toEqual(['ops']);
    expect(page.order).toBe(5);
    expect(page.props).toEqual({ status: 'draft' });
    expect(page.hasChildren).toBe(false);
    expect(existsSync(join(harness.contentDir, 'eng/rollback.md'))).toBe(true);

    const byId = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${page.id}`,
      headers: headers(),
    });
    expect(byId.statusCode).toBe(200);
    expect(bodyOf(byId, PageResponseSchema).page.markdown).toContain('Roll back');

    const byPath = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages?path=eng/rollback',
      headers: headers(),
    });
    expect(bodyOf(byPath, PageResponseSchema).page.id).toBe(page.id);

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: headers(),
    });
    const paths = bodyOf(list, PageListResponseSchema).pages.map((summary) => summary.path);
    expect(paths).toContain('eng/rollback');
    expect(paths).toContain('eng/deploy');
    expect(paths).toContain('eng');

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page.id}`,
      headers: headers(),
      payload: { title: 'Rollback runbook', markdown: 'Updated body.', props: { status: 'live' } },
    });
    const updated = bodyOf(patched, PageResponseSchema).page;
    expect(updated.title).toBe('Rollback runbook');
    expect(updated.markdown).toBe('Updated body.');
    expect(updated.props).toEqual({ status: 'live' });
    expect(updated.id).toBe(page.id);
    expect(updated.created).toBe(page.created);

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${page.id}`,
      headers: headers(),
    });
    expect(removed.statusCode).toBe(200);
    expect(bodyOf(removed, DeletePageResponseSchema).deleted).toEqual(['eng/rollback']);
    expect(existsSync(join(harness.contentDir, 'eng/rollback.md'))).toBe(false);

    const gone = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${page.id}`,
      headers: headers(),
    });
    expect(gone.statusCode).toBe(404);
    expect(bodyOf(gone, ErrorBodySchema).error.code).toBe('NOT_FOUND');
  });

  it('clears an icon and an order with an explicit null', async () => {
    await seed(harness);
    const created = bodyOf(
      await createPage({ path: 'eng/tmp', title: 'Temp', icon: '🧪', order: 3 }),
      PageResponseSchema,
    ).page;

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${created.id}`,
      headers: headers(),
      payload: { icon: null, order: null },
    });
    const page = bodyOf(patched, PageResponseSchema).page;
    expect(page.icon).toBeUndefined();
    expect(page.order).toBeUndefined();
  });
});

describe('parent promotion and demotion', () => {
  it('promotes a leaf parent to index.md when a child is created', async () => {
    await seed(harness);
    expect(existsSync(join(harness.contentDir, 'eng/deploy.md'))).toBe(true);

    const child = await createPage({ path: 'eng/deploy/steps', title: 'Steps' });
    expect(child.statusCode).toBe(201);

    expect(existsSync(join(harness.contentDir, 'eng/deploy.md'))).toBe(false);
    expect(existsSync(join(harness.contentDir, 'eng/deploy/index.md'))).toBe(true);
    expect(existsSync(join(harness.contentDir, 'eng/deploy/steps.md'))).toBe(true);

    const parent = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages?path=eng/deploy',
      headers: headers(),
    });
    const parentPage = bodyOf(parent, PageResponseSchema).page;
    expect(parentPage.hasChildren).toBe(true);
    expect(parentPage.title).toBe('Deploy runbook');
  });

  it('demotes the parent back to a leaf when its last child is deleted', async () => {
    await seed(harness);
    const child = bodyOf(
      await createPage({ path: 'eng/deploy/steps', title: 'Steps' }),
      PageResponseSchema,
    ).page;

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${child.id}`,
      headers: headers(),
    });

    expect(existsSync(join(harness.contentDir, 'eng/deploy.md'))).toBe(true);
    expect(existsSync(join(harness.contentDir, 'eng/deploy'))).toBe(false);
  });
});

describe('moving pages', () => {
  it('keeps the page id and updates the path', async () => {
    await seed(harness);
    const before = bodyOf(
      await createPage({ path: 'eng/legacy', title: 'Legacy', markdown: 'Body stays.' }),
      PageResponseSchema,
    ).page;

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${before.id}`,
      headers: headers(),
      payload: { path: 'eng/archive' },
    });
    const page = bodyOf(moved, PageResponseSchema).page;
    expect(page.id).toBe(before.id);
    expect(page.path).toBe('eng/archive');
    expect(page.markdown).toBe('Body stays.');

    const oldPath = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages?path=eng/legacy',
      headers: headers(),
    });
    expect(oldPath.statusCode).toBe(404);

    const stillThere = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${before.id}`,
      headers: headers(),
    });
    expect(bodyOf(stillThere, PageResponseSchema).page.path).toBe('eng/archive');
  });

  it('moves a whole subtree and rewrites descendant paths', async () => {
    await seed(harness);
    const parent = bodyOf(
      await createPage({ path: 'eng/platform', title: 'Platform' }),
      PageResponseSchema,
    ).page;
    const child = bodyOf(
      await createPage({ path: 'eng/platform/scaling', title: 'Scaling' }),
      PageResponseSchema,
    ).page;

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${parent.id}`,
      headers: headers(),
      payload: { path: 'eng/infra' },
    });

    const movedChild = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${child.id}`,
      headers: headers(),
    });
    expect(bodyOf(movedChild, PageResponseSchema).page.path).toBe('eng/infra/scaling');
  });

  it('rejects a move onto an occupied path with CONFLICT', async () => {
    const { pageIds } = await seed(harness);
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${pageIds[0]}`,
      headers: headers(),
      payload: { path: 'eng/oncall' },
    });
    expect(response.statusCode).toBe(409);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('CONFLICT');
  });
});

describe('deleting pages with children', () => {
  it('refuses a non-recursive delete and succeeds with recursive=true', async () => {
    await seed(harness);
    const parent = bodyOf(
      await createPage({ path: 'eng/guides', title: 'Guides' }),
      PageResponseSchema,
    ).page;
    await createPage({ path: 'eng/guides/first', title: 'First' });
    await createPage({ path: 'eng/guides/second', title: 'Second' });

    const refused = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${parent.id}`,
      headers: headers(),
    });
    expect(refused.statusCode).toBe(409);
    expect(bodyOf(refused, ErrorBodySchema).error.code).toBe('CONFLICT');
    expect(existsSync(join(harness.contentDir, 'eng/guides/first.md'))).toBe(true);

    const done = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${parent.id}?recursive=true`,
      headers: headers(),
    });
    expect(done.statusCode).toBe(200);
    expect(bodyOf(done, DeletePageResponseSchema).deleted).toEqual([
      'eng/guides',
      'eng/guides/first',
      'eng/guides/second',
    ]);
    expect(existsSync(join(harness.contentDir, 'eng/guides'))).toBe(false);
  });
});

describe('backlinks', () => {
  it('reports pages that wikilink to the page', async () => {
    const { pageIds } = await seed(harness);
    await createPage({
      path: 'eng/index-of-runbooks',
      title: 'Runbook index',
      markdown: 'See [[eng/deploy|the deploy runbook]] for details.',
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${pageIds[0]}/backlinks`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const { backlinks } = bodyOf(response, BacklinksResponseSchema);
    expect(backlinks.map((link) => link.path)).toEqual(['eng/index-of-runbooks']);
  });
});
