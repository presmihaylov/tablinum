import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BacklinksResponseSchema,
  CursorResponseSchema,
  DeletePageResponseSchema,
  ErrorBodySchema,
  PageListResponseSchema,
  PageResponseSchema,
  SpacesResponseSchema,
} from '@tablinum/shared';
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
      order: 5,
    });
    expect(created.statusCode).toBe(201);
    const page = bodyOf(created, PageResponseSchema).page;
    expect(page.path).toBe('eng/rollback');
    expect(page.space).toBe('eng');
    expect(page.icon).toBe('⏪');
    expect(page.order).toBe(5);
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
      payload: { title: 'Rollback runbook', markdown: 'Updated body.' },
    });
    const updated = bodyOf(patched, PageResponseSchema).page;
    expect(updated.title).toBe('Rollback runbook');
    expect(updated.markdown).toBe('Updated body.');
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

  it('lists pages by path, so a parent always precedes its children', async () => {
    await seed(harness);
    await createPage({ path: 'eng/deploy/steps', title: 'Steps' });

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages',
      headers: headers(),
    });
    expect(bodyOf(list, PageListResponseSchema).pages.map((summary) => summary.path)).toEqual([
      'eng',
      'eng/deploy',
      'eng/deploy/steps',
      'eng/oncall',
    ]);
  });
});

describe('creating into a space that does not exist yet', () => {
  it('names the space into existence rather than refusing the page', async () => {
    const created = await createPage({ path: 'brandnew/note', title: 'Note' });
    expect(created.statusCode).toBe(201);
    expect(bodyOf(created, PageResponseSchema).page.space).toBe('brandnew');

    expect(existsSync(join(harness.contentDir, 'brandnew/_space.yml'))).toBe(true);
    expect(existsSync(join(harness.contentDir, 'brandnew/index.md'))).toBe(true);
    expect(existsSync(join(harness.contentDir, 'brandnew/note.md'))).toBe(true);

    const spaces = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: headers(),
    });
    const found = bodyOf(spaces, SpacesResponseSchema).spaces.find(
      (space) => space.slug === 'brandnew',
    );
    expect(found?.name).toBe('Brandnew');
    // Nobody owns it, so the space the page invented is one the whole workspace reads.
    expect(found?.owner).toBeUndefined();
  });

  it('gives a depth-1 page its own space and a home page in one write', async () => {
    const created = await createPage({ path: 'solo', title: 'Solo' });
    expect(created.statusCode).toBe(201);
    expect(bodyOf(created, PageResponseSchema).page.path).toBe('solo');
    expect(existsSync(join(harness.contentDir, 'solo/_space.yml'))).toBe(true);
    expect(existsSync(join(harness.contentDir, 'solo/index.md'))).toBe(true);
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

  it('refuses to move a space home page with CONFLICT', async () => {
    await seed(harness);
    const home = bodyOf(
      await harness.app.inject({
        method: 'GET',
        url: '/api/v1/pages?path=eng',
        headers: headers(),
      }),
      PageResponseSchema,
    ).page;

    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${home.id}`,
      headers: headers(),
      payload: { path: 'eng/moved' },
    });
    expect(response.statusCode).toBe(409);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('CONFLICT');
  });

  it('rejects a move onto its own descendant with CONFLICT', async () => {
    await seed(harness);
    const parent = bodyOf(
      await createPage({ path: 'eng/platform', title: 'Platform' }),
      PageResponseSchema,
    ).page;
    await createPage({ path: 'eng/platform/scaling', title: 'Scaling' });

    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${parent.id}`,
      headers: headers(),
      payload: { path: 'eng/platform/scaling/inner' },
    });
    expect(response.statusCode).toBe(409);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('CONFLICT');
  });

  it('names a missing space and its missing parents into existence on a move', async () => {
    await seed(harness);
    const page = bodyOf(
      await createPage({ path: 'eng/legacy', title: 'Legacy' }),
      PageResponseSchema,
    ).page;

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page.id}`,
      headers: headers(),
      payload: { path: 'ghost/deep/legacy' },
    });
    expect(moved.statusCode).toBe(200);
    expect(bodyOf(moved, PageResponseSchema).page.path).toBe('ghost/deep/legacy');

    expect(existsSync(join(harness.contentDir, 'ghost/_space.yml'))).toBe(true);
    expect(existsSync(join(harness.contentDir, 'ghost/index.md'))).toBe(true);
    expect(existsSync(join(harness.contentDir, 'ghost/deep/index.md'))).toBe(true);

    const spaces = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: headers(),
    });
    // No owner, so the invented space is public. See the note in the PR that added this test.
    expect(bodyOf(spaces, SpacesResponseSchema).spaces).toContainEqual({
      slug: 'ghost',
      name: 'Ghost',
    });
  });
});

describe('a patch that changes nothing', () => {
  it('leaves updated alone', async () => {
    await seed(harness);
    const before = bodyOf(
      await createPage({ path: 'eng/steady', title: 'Steady', markdown: 'No change here.' }),
      PageResponseSchema,
    ).page;

    await new Promise((resolve) => setTimeout(resolve, 10));
    const again = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${before.id}`,
      headers: headers(),
      payload: { title: 'Steady', markdown: 'No change here.' },
    });
    expect(again.statusCode).toBe(200);
    expect(bodyOf(again, PageResponseSchema).page.updated).toBe(before.updated);
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

describe('the caret an agent leaves on a page', () => {
  /** A page with three blocks, which is what the cursor arithmetic addresses. */
  async function pageWithBlocks() {
    await seed(harness);
    const created = await createPage({
      path: 'eng/release',
      title: 'Release',
      markdown: '# Deploy\n\nRun the pipeline from main.\n\n- build\n- ship\n',
    });
    return bodyOf(created, PageResponseSchema).page;
  }

  async function readCursor(id: string) {
    return harness.app.inject({ method: 'GET', url: `/api/v1/pages/${id}/cursor`, headers: headers() });
  }

  async function writeCursor(id: string, payload: Record<string, unknown>) {
    return harness.app.inject({
      method: 'PUT',
      url: `/api/v1/pages/${id}/cursor`,
      headers: headers(),
      payload,
    });
  }

  it('has no caret until one is put there, then hands the same one back', async () => {
    const page = await pageWithBlocks();

    const empty = await readCursor(page.id);
    expect(empty.statusCode).toBe(200);
    expect(bodyOf(empty, CursorResponseSchema).cursor).toBeNull();

    const put = await writeCursor(page.id, {
      anchor: { block: 1, offset: 4 },
      head: { block: 1, offset: 16 },
    });
    expect(put.statusCode).toBe(200);
    const written = bodyOf(put, CursorResponseSchema).cursor;
    expect(written?.anchor).toEqual({ block: 1, offset: 4 });
    expect(written?.head).toEqual({ block: 1, offset: 16 });
    expect(written?.path).toBe('eng/release');

    const again = await readCursor(page.id);
    expect(bodyOf(again, CursorResponseSchema).cursor?.head).toEqual({ block: 1, offset: 16 });
  });

  it('leaves the caret where the anchor is when no head is given', async () => {
    const page = await pageWithBlocks();
    const put = await writeCursor(page.id, { anchor: { block: 2, offset: 7 } });
    const cursor = bodyOf(put, CursorResponseSchema).cursor;
    expect(cursor?.head).toEqual({ block: 2, offset: 7 });
  });

  it('moves a caret past the end back onto text that exists', async () => {
    const page = await pageWithBlocks();
    const put = await writeCursor(page.id, { anchor: { block: 99, offset: 900 } });
    expect(bodyOf(put, CursorResponseSchema).cursor?.anchor).toEqual({ block: 2, offset: 14 });
  });

  it('keeps a caret on a page that has since been cut short, inside the text left', async () => {
    const page = await pageWithBlocks();
    await writeCursor(page.id, { anchor: { block: 2, offset: 14 } });

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page.id}`,
      headers: headers(),
      payload: { markdown: 'Just one line now.\n' },
    });

    const after = await readCursor(page.id);
    expect(bodyOf(after, CursorResponseSchema).cursor?.anchor).toEqual({ block: 0, offset: 14 });
  });

  it('refuses a caret on a page that does not exist', async () => {
    await seed(harness);
    const missing = await writeCursor('pg_00000000000000000000000000', {
      anchor: { block: 0, offset: 0 },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects a caret with a negative block', async () => {
    const page = await pageWithBlocks();
    const bad = await writeCursor(page.id, { anchor: { block: -1, offset: 0 } });
    expect(bad.statusCode).toBe(400);
    expect(bodyOf(bad, ErrorBodySchema).error.code).toBe('VALIDATION');
  });
});
