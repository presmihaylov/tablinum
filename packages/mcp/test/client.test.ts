import { AppError } from '@tablinum/shared';
import { describe, expect, it } from 'vitest';
import { TablinumClient } from '../src/client.js';
import { makePage, makeStatus, mockFetch, networkError, reply, replyText } from './helpers.js';

const BASE = 'http://tablinum.test';

function clientWith(routes: Parameters<typeof mockFetch>[0], token: string | null = 'tok_1') {
  const mock = mockFetch(routes);
  return { mock, client: new TablinumClient({ baseUrl: BASE, token, fetch: mock.fetch }) };
}

async function captureError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the call to throw');
}

describe('TablinumClient requests', () => {
  it('sends the bearer token and JSON headers', async () => {
    const page = makePage();
    const { mock, client } = clientWith({ 'GET /api/v1/pages': { page } });

    await client.getPageByPath('eng/deploy');

    expect(mock.last().headers['authorization']).toBe('Bearer tok_1');
    expect(mock.last().headers['accept']).toBe('application/json');
    expect(mock.last().query).toEqual({ path: 'eng/deploy' });
  });

  it('omits the authorization header when no token is configured', async () => {
    const { mock, client } = clientWith({ 'GET /api/v1/spaces': { spaces: [] } }, null);

    await client.listSpaces();

    expect(mock.last().headers['authorization']).toBeUndefined();
  });

  it('trims a trailing slash from the base URL', async () => {
    const mock = mockFetch({ 'GET /api/v1/health': { ok: true, version: '0.1.0', contentDir: '/c' } });
    const client = new TablinumClient({ baseUrl: `${BASE}/`, token: null, fetch: mock.fetch });

    await client.health();

    expect(mock.last().url).toBe(`${BASE}/api/v1/health`);
  });

  it('percent-encodes the page id in the path', async () => {
    const page = makePage();
    const { mock, client } = clientWith({ [`GET /api/v1/pages/${page.id}`]: { page } });

    await client.getPageById(page.id);

    expect(mock.last().pathname).toBe(`/api/v1/pages/${page.id}`);
  });

  it('drops empty query parameters', async () => {
    const { mock, client } = clientWith({ 'GET /api/v1/search': { hits: [] } });

    await client.search({ q: 'deploy', space: undefined, limit: 5 });

    expect(mock.last().query).toEqual({ q: 'deploy', limit: '5' });
  });

  it('only adds recursive=true when deleting recursively', async () => {
    const page = makePage();
    const { mock, client } = clientWith({
      [`DELETE /api/v1/pages/${page.id}`]: { deleted: ['eng/deploy'] },
    });

    await client.deletePage(page.id, false);
    expect(mock.last().query).toEqual({});

    await client.deletePage(page.id, true);
    expect(mock.last().query).toEqual({ recursive: 'true' });
  });

  it('returns the parsed git status', async () => {
    const status = makeStatus({ ahead: 2 });
    const { client } = clientWith({ 'GET /api/v1/git/status': { status } });

    await expect(client.gitStatus()).resolves.toMatchObject({ ahead: 2, branch: 'main' });
  });
});

describe('TablinumClient error mapping', () => {
  it('keeps the code and message of a tablinum error envelope', async () => {
    const { client } = clientWith({
      'GET /api/v1/pages': reply(404, { error: { code: 'NOT_FOUND', message: 'No page at eng/nope' } }),
    });

    const error = await captureError(() => client.getPageByPath('eng/nope'));

    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('No page at eng/nope');
    expect(error.status).toBe(404);
  });

  it('maps a 409 envelope to CONFLICT', async () => {
    const { client } = clientWith({
      'POST /api/v1/pages': reply(409, { error: { code: 'CONFLICT', message: 'Page exists' } }),
    });

    const error = await captureError(() =>
      client.createPage({ path: 'eng/deploy', title: 'Deploy', markdown: '' }),
    );

    expect(error.code).toBe('CONFLICT');
  });

  it('maps a bare 401 with no envelope to UNAUTHORIZED', async () => {
    const { client } = clientWith({ 'GET /api/v1/spaces': replyText(401, 'Unauthorized') });

    const error = await captureError(() => client.listSpaces());

    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toContain('401');
  });

  it('maps an unrecognised status to INTERNAL', async () => {
    const { client } = clientWith({ 'GET /api/v1/spaces': replyText(503, '<html>gateway</html>') });

    const error = await captureError(() => client.listSpaces());

    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('gateway');
  });

  it('maps a 502 to GIT_ERROR', async () => {
    const { client } = clientWith({ 'POST /api/v1/git/push': replyText(502, 'remote rejected') });

    const error = await captureError(() => client.gitPush());

    expect(error.code).toBe('GIT_ERROR');
  });

  it('explains an unreachable server', async () => {
    const { client } = clientWith({ 'GET /api/v1/health': networkError('ECONNREFUSED') });

    const error = await captureError(() => client.health());

    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('Cannot reach the tablinum server');
    expect(error.message).toContain('TABLINUM_URL');
  });

  it('reports invalid JSON from the server', async () => {
    const { client } = clientWith({ 'GET /api/v1/spaces': replyText(200, 'not json at all') });

    const error = await captureError(() => client.listSpaces());

    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('invalid JSON');
  });

  it('reports a response that does not match the shared schema', async () => {
    const { client } = clientWith({ 'GET /api/v1/spaces': { spaces: [{ slug: 'eng' }] } });

    const error = await captureError(() => client.listSpaces());

    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('unexpected');
  });
});
