import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ErrorBodySchema,
  PageResponseSchema,
  SpaceResponseSchema,
  SpacesResponseSchema,
  TreeResponseSchema,
} from '@gitdocs/shared';
import { bodyOf, makeHarness, seed, type Harness } from './support/harness.js';

let harness: Harness;

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
});

describe('tree', () => {
  it('nests child pages under their parent', async () => {
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
    const deploy = space?.tree.find((node) => node.path === 'eng/deploy');
    expect(deploy?.children.map((node) => node.path)).toEqual([
      'eng/deploy/steps',
      'eng/deploy/rollback',
    ]);
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
});
