import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBodySchema, PageResponseSchema, SearchResponseSchema } from '@tablinum/shared';
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

async function createPage(payload: Record<string, unknown>): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/pages',
    headers: headers(),
    payload,
  });
  return bodyOf(response, PageResponseSchema).page.id;
}

/** GET /search, optionally narrowed to some columns of the index. */
async function search(q: string, fields?: string) {
  const scope = fields === undefined ? '' : `&fields=${encodeURIComponent(fields)}`;
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/search?q=${encodeURIComponent(q)}${scope}`,
    headers: headers(),
  });
  expect(response.statusCode).toBe(200);
  return bodyOf(response, SearchResponseSchema).hits;
}

describe('search', () => {
  it('finds a page immediately after it is written', async () => {
    await seed(harness);
    const id = await createPage({
      path: 'eng/kubernetes',
      title: 'Kubernetes notes',
      markdown: 'Drain the node before an upgrade.',
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=drain',
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const { hits } = bodyOf(response, SearchResponseSchema);
    expect(hits.map((hit) => hit.id)).toContain(id);
  });

  it('reflects an update and drops a deleted page', async () => {
    await seed(harness);
    const id = await createPage({
      path: 'eng/canary',
      title: 'Canary',
      markdown: 'The word here is aardvark.',
    });

    const before = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=aardvark',
      headers: headers(),
    });
    expect(bodyOf(before, SearchResponseSchema).hits).toHaveLength(1);

    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${id}`,
      headers: headers(),
      payload: { markdown: 'Now it says buffalo instead.' },
    });

    const afterUpdate = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=aardvark',
      headers: headers(),
    });
    expect(bodyOf(afterUpdate, SearchResponseSchema).hits).toHaveLength(0);

    const buffalo = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=buffalo',
      headers: headers(),
    });
    expect(bodyOf(buffalo, SearchResponseSchema).hits).toHaveLength(1);

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${id}`,
      headers: headers(),
    });

    const afterDelete = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=buffalo',
      headers: headers(),
    });
    expect(bodyOf(afterDelete, SearchResponseSchema).hits).toHaveLength(0);
  });

  it('indexes the ancestors a deep create had to write', async () => {
    await seed(harness);
    await createPage({ path: 'eng/handbook/hiring/interviews', title: 'Interviews' });

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=handbook',
      headers: headers(),
    });
    const paths = bodyOf(response, SearchResponseSchema).hits.map((hit) => hit.path);
    expect(paths).toContain('eng/handbook');
    expect(paths).toContain('eng/handbook/hiring');
  });

  it('rejects a missing query with VALIDATION', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/search',
      headers: headers(),
    });
    expect(response.statusCode).toBe(400);
    expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
  });

  it('returns the icon of a page, and omits the field when it has none', async () => {
    await seed(harness);
    await createPage({ path: 'eng/octopus', title: 'Octopus', icon: '🐙' });
    await createPage({ path: 'eng/plain', title: 'Plain page' });

    const octopus = await search('octopus');
    expect(octopus[0]?.icon).toBe('🐙');

    const plain = await search('plain');
    expect(plain[0]).not.toHaveProperty('icon');
  });
});

describe('search fields', () => {
  beforeEach(async () => {
    await seed(harness);
    await createPage({
      // The path names the page nothing like its title, so one column is visible on its own.
      path: 'eng/mustard-notes',
      title: 'Ferret playbook',
      // "zebracoffee" reads in the body alone. It names no page.
      markdown: 'We roll out with zebracoffee tooling.\n',
    });
  });

  it('answers a body-only word with full text, and with nothing when the name is asked for', async () => {
    expect((await search('zebracoffee')).map((hit) => hit.title)).toEqual(['Ferret playbook']);
    expect(await search('zebracoffee', 'title,path')).toEqual([]);
  });

  it('still finds the page by a prefix of its name', async () => {
    expect((await search('ferr', 'title,path')).map((hit) => hit.title)).toEqual([
      'Ferret playbook',
    ]);
    expect((await search('ferret play', 'title,path')).map((hit) => hit.title)).toEqual([
      'Ferret playbook',
    ]);
  });

  it('accepts one column on its own', async () => {
    expect((await search('mustard', 'title,path')).map((hit) => hit.title)).toEqual([
      'Ferret playbook',
    ]);
    expect(await search('mustard', 'title')).toEqual([]);
  });

  it('rejects a column nobody indexes with VALIDATION', async () => {
    for (const fields of ['owner', 'title,owner', '']) {
      const response = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/search?q=deploy&fields=${encodeURIComponent(fields)}`,
        headers: headers(),
      });
      expect(response.statusCode).toBe(400);
      expect(bodyOf(response, ErrorBodySchema).error.code).toBe('VALIDATION');
    }
  });
});
