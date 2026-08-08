import { AppError, newPageId } from '@gitdocs/shared';
import { describe, expect, it } from 'vitest';
import { GitdocsClient } from '../src/client.js';
import { normalizeRef, refLabel, resolvePage, resolvePageId } from '../src/refs.js';
import { makePage, mockFetch } from './helpers.js';

const BASE = 'http://gitdocs.test';

describe('normalizeRef', () => {
  it('accepts a page id', () => {
    const id = newPageId();
    expect(normalizeRef({ id })).toEqual({ kind: 'id', id });
  });

  it('accepts a page path', () => {
    expect(normalizeRef({ path: 'eng/runbooks/deploy' })).toEqual({
      kind: 'path',
      path: 'eng/runbooks/deploy',
    });
  });

  it('prefers the id when both are given', () => {
    const id = newPageId();
    expect(normalizeRef({ id, path: 'eng/deploy' })).toEqual({ kind: 'id', id });
  });

  it('trims whitespace around both fields', () => {
    expect(normalizeRef({ path: '  eng/deploy  ' })).toEqual({ kind: 'path', path: 'eng/deploy' });
  });

  it('tells the caller to use path when a path arrives as id', () => {
    const error = (() => {
      try {
        normalizeRef({ id: 'eng/deploy' });
        return null;
      } catch (err) {
        return err;
      }
    })();

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION');
    expect((error as AppError).message).toContain('pass it as "path" instead');
  });

  it('rejects an id that is neither an id nor a path', () => {
    expect(() => normalizeRef({ id: 'nope' })).toThrowError(/page id like/);
  });

  it('rejects a malformed path with advice', () => {
    expect(() => normalizeRef({ path: '/eng/deploy/' })).toThrowError(/no leading or trailing slash/);
  });

  it('rejects a path that ends in .md', () => {
    expect(() => normalizeRef({ path: 'eng/deploy.md' })).toThrowError(/page path/);
  });

  it('names both options when neither is given', () => {
    expect(() => normalizeRef({})).toThrowError(/Provide either "id".*or "path"/s);
  });

  it('treats empty strings as missing', () => {
    expect(() => normalizeRef({ id: '   ', path: '' })).toThrowError(/Provide either/);
  });

  it('labels a ref for output', () => {
    expect(refLabel({ path: 'eng/deploy' })).toBe('eng/deploy');
  });
});

describe('resolving a ref against the API', () => {
  it('fetches by id without a lookup', async () => {
    const page = makePage();
    const mock = mockFetch({ [`GET /api/v1/pages/${page.id}`]: { page } });
    const client = new GitdocsClient({ baseUrl: BASE, token: null, fetch: mock.fetch });

    await expect(resolvePage(client, { id: page.id })).resolves.toMatchObject({ id: page.id });
    expect(mock.calls).toHaveLength(1);
  });

  it('fetches by path with the path query', async () => {
    const page = makePage({ path: 'eng/runbooks/deploy' });
    const mock = mockFetch({ 'GET /api/v1/pages': { page } });
    const client = new GitdocsClient({ baseUrl: BASE, token: null, fetch: mock.fetch });

    await resolvePage(client, { path: 'eng/runbooks/deploy' });

    expect(mock.last().query).toEqual({ path: 'eng/runbooks/deploy' });
  });

  it('resolvePageId returns the id straight away and makes no request', async () => {
    const id = newPageId();
    const mock = mockFetch({});
    const client = new GitdocsClient({ baseUrl: BASE, token: null, fetch: mock.fetch });

    await expect(resolvePageId(client, { id })).resolves.toBe(id);
    expect(mock.calls).toHaveLength(0);
  });

  it('resolvePageId looks a path up exactly once', async () => {
    const page = makePage();
    const mock = mockFetch({ 'GET /api/v1/pages': { page } });
    const client = new GitdocsClient({ baseUrl: BASE, token: null, fetch: mock.fetch });

    await expect(resolvePageId(client, { path: page.path })).resolves.toBe(page.id);
    expect(mock.calls).toHaveLength(1);
  });
});
