import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ErrorBodySchema,
  PageResponseSchema,
  SpaceResponseSchema,
  SpacesResponseSchema,
  TreeResponseSchema,
  newPageId,
} from '@tablinum/shared';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';

let harness: Harness;

/** A page file a hand-made directory can hold, so the test is about the descriptor and not the parser. */
function pageFile(title: string): string {
  const now = new Date().toISOString();
  return `---\nid: ${newPageId()}\ntitle: ${title}\ncreated: ${now}\nupdated: ${now}\n---\n\n`;
}

beforeEach(async () => {
  harness = await makeHarness();
});

afterEach(async () => {
  await harness.close();
});

describe('spaces', () => {
  it('creates a space with a descriptor file and a home page', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'docs', name: 'Product docs', icon: '📘', order: 1 },
    });
    expect(created.statusCode).toBe(200);
    expect(bodyOf(created, SpaceResponseSchema).space).toEqual({
      slug: 'docs',
      name: 'Product docs',
      icon: '📘',
      order: 1,
    });
    expect(existsSync(join(harness.contentDir, 'docs/_space.yml'))).toBe(true);
    expect(existsSync(join(harness.contentDir, 'docs/index.md'))).toBe(true);

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
    });
    expect(bodyOf(listed, SpacesResponseSchema).spaces.map((space) => space.slug)).toEqual(['docs']);
  });

  it('rejects a duplicate slug with CONFLICT', async () => {
    await seed(harness);
    const again = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'eng', name: 'Engineering again' },
    });
    expect(again.statusCode).toBe(409);
    expect(bodyOf(again, ErrorBodySchema).error.code).toBe('CONFLICT');
  });

  it('renames a space and sets then clears its icon', async () => {
    await seed(harness);

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/spaces/eng',
      headers: harness.authHeaders(),
      payload: { name: 'Platform', icon: '🚀' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(bodyOf(renamed, SpaceResponseSchema).space).toEqual({
      slug: 'eng',
      name: 'Platform',
      icon: '🚀',
    });

    const cleared = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/spaces/eng',
      headers: harness.authHeaders(),
      payload: { icon: null },
    });
    expect(bodyOf(cleared, SpaceResponseSchema).space).toEqual({ slug: 'eng', name: 'Platform' });

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
    });
    expect(bodyOf(listed, SpacesResponseSchema).spaces[0]?.name).toBe('Platform');
  });

  it('answers NOT_FOUND when the space is unknown', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/spaces/ghost',
      headers: harness.authHeaders(),
      payload: { name: 'Ghost' },
    });
    expect(response.statusCode).toBe(404);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('NOT_FOUND');
  });

  it('rejects a multi-segment slug with VALIDATION', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'eng/sub', name: 'Nope' },
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('adopts a bare directory of markdown that has no descriptor', async () => {
    // Somebody dropped a folder of notes into the content repo by hand. The descriptor decides
    // whether a space exists, not the directory, so this is an adoption and not a clash.
    await mkdir(join(harness.contentDir, 'loose'), { recursive: true });
    await writeFile(join(harness.contentDir, 'loose/index.md'), pageFile('Loose'), 'utf8');

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'loose', name: 'Loose notes' },
    });
    expect(created.statusCode).toBe(200);
    expect(bodyOf(created, SpaceResponseSchema).space.name).toBe('Loose notes');
    expect(existsSync(join(harness.contentDir, 'loose/_space.yml'))).toBe(true);
  });

  it('names a directory with no descriptor after its slug, made readable', async () => {
    await mkdir(join(harness.contentDir, 'loose-ends'), { recursive: true });
    await writeFile(join(harness.contentDir, 'loose-ends/index.md'), pageFile('Ends'), 'utf8');

    const listed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
    });
    expect(bodyOf(listed, SpacesResponseSchema).spaces).toEqual([
      { slug: 'loose-ends', name: 'Loose ends' },
    ]);
  });

  it('normalises an icon of only whitespace away rather than storing it', async () => {
    await seed(harness);
    const patched = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/spaces/eng',
      headers: harness.authHeaders(),
      payload: { icon: '   ' },
    });
    expect(patched.statusCode).toBe(200);
    expect(bodyOf(patched, SpaceResponseSchema).space.icon).toBeUndefined();
  });
});

describe('tree', () => {
  it('roots the tree at the space home page and nests every page beneath it', async () => {
    await seed(harness);
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: harness.authHeaders(),
      payload: { path: 'eng/deploy/steps', title: 'Steps', order: 1 },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: harness.authHeaders(),
      payload: { path: 'eng/deploy/rollback', title: 'Rollback', order: 2 },
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tree',
      headers: harness.authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const { spaces } = bodyOf(response, TreeResponseSchema);
    expect(spaces).toHaveLength(1);

    const space = spaces[0];
    expect(space?.slug).toBe('eng');
    // The home page is the only root. The web reads `space.tree[0]` to redirect to it, and the
    // sidebar hangs the whole space off it.
    expect(space?.tree.map((node) => node.path)).toEqual(['eng']);

    const home = space?.tree[0];
    expect(home?.title).toBe('Engineering');
    expect(home?.children.map((node) => node.path)).toEqual(['eng/deploy', 'eng/oncall']);

    const deploy = home?.children.find((node) => node.path === 'eng/deploy');
    expect(deploy?.children.map((node) => node.path)).toEqual([
      'eng/deploy/steps',
      'eng/deploy/rollback',
    ]);
  });

  it('gives a space with no pages a tree of just its home page', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'empty', name: 'Empty' },
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tree',
      headers: harness.authHeaders(),
    });
    const space = bodyOf(response, TreeResponseSchema).spaces[0];
    expect(space?.tree.map((node) => node.path)).toEqual(['empty']);
    expect(space?.tree[0]?.children).toEqual([]);
  });

  it('exposes the space home page as a normal page', async () => {
    await seed(harness);
    const home = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages?path=eng',
      headers: harness.authHeaders(),
    });
    expect(home.statusCode).toBe(200);
    const page = bodyOf(home, PageResponseSchema).page;
    expect(page.title).toBe('Engineering');
    expect(page.hasChildren).toBe(true);
  });

  it('reports hasChildren false on a space home page with no pages under it', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: harness.authHeaders(),
      payload: { slug: 'empty', name: 'Empty' },
    });

    const home = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/pages?path=empty',
      headers: harness.authHeaders(),
    });
    expect(home.statusCode).toBe(200);
    // The home page always lives in an index.md, so "is an index file" is not "has children".
    expect(bodyOf(home, PageResponseSchema).page.hasChildren).toBe(false);
  });
});
