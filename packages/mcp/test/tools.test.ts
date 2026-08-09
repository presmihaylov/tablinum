import { AppError, newPageId } from '@tablinum/shared';
import { describe, expect, it } from 'vitest';
import { TablinumClient } from '../src/client.js';
import { TOOL_SPECS, getToolSpec } from '../src/tools.js';
import {
  makeHit,
  makeNode,
  makePage,
  makeRevision,
  makeSpaceTree,
  makeStatus,
  mockFetch,
  reply,
  type Routes,
} from './helpers.js';

const BASE = 'http://tablinum.test';

function harness(routes: Routes) {
  const mock = mockFetch(routes);
  const client = new TablinumClient({ baseUrl: BASE, token: 'tok_1', fetch: mock.fetch });
  return {
    mock,
    run: (name: string, args: unknown) => getToolSpec(name).run(client, args),
  };
}

async function expectError(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the tool to throw');
}

describe('tool catalogue', () => {
  it('exposes exactly the documented tools', () => {
    expect(TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'tablinum_search',
      'tablinum_get_page',
      'tablinum_list_tree',
      'tablinum_create_page',
      'tablinum_update_page',
      'tablinum_append_page',
      'tablinum_move_page',
      'tablinum_delete_page',
      'tablinum_page_history',
      'tablinum_git_sync',
    ]);
  });

  it('gives every tool a title, a substantial description and a schema', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(120);
      expect(Object.keys(spec.inputShape).length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown tool name with the list of real names', () => {
    expect(() => getToolSpec('tablinum_nope')).toThrowError(/tablinum_search/);
  });

  it('validates arguments before it calls the API', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() => run('tablinum_search', { query: '' }));
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_search', () => {
  it('passes every filter through and formats the hits', async () => {
    const { run, mock } = harness({
      'GET /api/v1/search': { hits: [makeHit({ path: 'eng/deploy' })] },
    });

    const text = await run('tablinum_search', { query: 'deploy', space: 'eng', limit: 5 });

    expect(mock.last().query).toEqual({ q: 'deploy', space: 'eng', limit: '5' });
    expect(text).toContain('[eng/deploy]');
  });

  it('returns guidance when there is no hit', async () => {
    const { run } = harness({ 'GET /api/v1/search': { hits: [] } });
    await expect(run('tablinum_search', { query: 'zzz' })).resolves.toContain('No page matches');
  });
});

describe('tablinum_get_page', () => {
  it('reads by path', async () => {
    const page = makePage({ markdown: '## Steps\n\nDo it.\n' });
    const { run, mock } = harness({ 'GET /api/v1/pages': { page } });

    const text = await run('tablinum_get_page', { path: 'eng/deploy' });

    expect(mock.last().query).toEqual({ path: 'eng/deploy' });
    expect(text).toContain('## Steps\n\nDo it.\n');
  });

  it('reads by id', async () => {
    const page = makePage();
    const { run, mock } = harness({ [`GET /api/v1/pages/${page.id}`]: { page } });

    const text = await run('tablinum_get_page', { id: page.id });

    expect(mock.last().pathname).toBe(`/api/v1/pages/${page.id}`);
    expect(text).toContain(`id: ${page.id}`);
  });

  it('refuses a call with neither id nor path', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() => run('tablinum_get_page', {}));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('tablinum_list_tree');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_list_tree', () => {
  const spaces = [
    makeSpaceTree({ tree: [makeNode({ path: 'eng/deploy', title: 'Deploy' })] }),
    makeSpaceTree({ slug: 'ops', name: 'Operations', tree: [] }),
  ];

  it('renders every space', async () => {
    const { run } = harness({ 'GET /api/v1/tree': { spaces } });
    const text = await run('tablinum_list_tree', {});
    expect(text).toContain('(space "eng")');
    expect(text).toContain('(space "ops")');
  });

  it('filters to one space', async () => {
    const { run } = harness({ 'GET /api/v1/tree': { spaces } });
    const text = await run('tablinum_list_tree', { space: 'ops' });
    expect(text).toContain('(space "ops")');
    expect(text).not.toContain('(space "eng")');
  });

  it('lists the real slugs when the space is unknown', async () => {
    const { run } = harness({ 'GET /api/v1/tree': { spaces } });
    const error = await expectError(() => run('tablinum_list_tree', { space: 'nope' }));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain('eng, ops');
  });
});

describe('tablinum_create_page', () => {
  it('sends every supplied field and nothing else', async () => {
    const page = makePage({ path: 'eng/runbooks/deploy' });
    const { run, mock } = harness({ 'POST /api/v1/pages': { page } });

    const text = await run('tablinum_create_page', {
      path: 'eng/runbooks/deploy',
      title: 'Deploy runbook',
      markdown: 'Body.',
      icon: '🚀',
      order: 2,
    });

    expect(mock.last().body).toEqual({
      path: 'eng/runbooks/deploy',
      title: 'Deploy runbook',
      markdown: 'Body.',
      icon: '🚀',
      order: 2,
    });
    expect(text).toContain('Created page.');
    expect(text).toContain(`id=${page.id}`);
  });

  it('rejects a path that carries the .md extension', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() =>
      run('tablinum_create_page', { path: 'eng/deploy.md', title: 'x', markdown: '' }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });

  it('surfaces a CONFLICT from the server', async () => {
    const { run } = harness({
      'POST /api/v1/pages': reply(409, {
        error: { code: 'CONFLICT', message: 'A page already exists at eng/deploy' },
      }),
    });

    const error = await expectError(() =>
      run('tablinum_create_page', { path: 'eng/deploy', title: 'x', markdown: '' }),
    );
    expect(error.code).toBe('CONFLICT');
  });
});

describe('tablinum_update_page partial body', () => {
  it('does NOT send markdown when markdown is omitted', async () => {
    const page = makePage();
    const { run, mock } = harness({
      [`PATCH /api/v1/pages/${page.id}`]: { page: makePage({ id: page.id, title: 'New title' }) },
    });

    await run('tablinum_update_page', { id: page.id, title: 'New title' });

    const body = mock.last().body as Record<string, unknown>;
    expect(body).toEqual({ title: 'New title' });
    expect('markdown' in body).toBe(false);
  });

  it('sends only the metadata fields that were given', async () => {
    const page = makePage();
    const { run, mock } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page } });

    await run('tablinum_update_page', { id: page.id, icon: '🚀', order: 4 });

    expect(mock.last().body).toEqual({ icon: '🚀', order: 4 });
  });

  it('sends markdown when it is explicitly given, even an empty string', async () => {
    const page = makePage();
    const { run, mock } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page } });

    await run('tablinum_update_page', { id: page.id, markdown: '' });

    expect(mock.last().body).toEqual({ markdown: '' });
  });

  it('passes null through to clear the icon and the order', async () => {
    const page = makePage();
    const { run, mock } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page } });

    await run('tablinum_update_page', { id: page.id, icon: null, order: null });

    expect(mock.last().body).toEqual({ icon: null, order: null });
  });

  it('refuses an update with no changed field and makes no request', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() => run('tablinum_update_page', { id: newPageId() }));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toContain('Nothing to update');
    expect(mock.calls).toHaveLength(0);
  });

  it('resolves a path to an id before it patches', async () => {
    const page = makePage();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`PATCH /api/v1/pages/${page.id}`]: { page },
    });

    await run('tablinum_update_page', { path: page.path, title: 'New title' });

    expect(mock.calls.map((call) => `${call.method} ${call.pathname}`)).toEqual([
      'GET /api/v1/pages',
      `PATCH /api/v1/pages/${page.id}`,
    ]);
  });

  it('reports which fields changed', async () => {
    const page = makePage();
    const { run } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page } });
    const text = await run('tablinum_update_page', { id: page.id, title: 'T', order: null });
    expect(text).toContain('Updated title, order.');
  });
});

describe('tablinum_append_page', () => {
  it('appends after a blank line and sends only markdown', async () => {
    const page = makePage({ markdown: 'Intro paragraph.\n' });
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`PATCH /api/v1/pages/${page.id}`]: { page },
    });

    await run('tablinum_append_page', { path: page.path, markdown: '## New section\n\nDetails.' });

    const body = mock.last().body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['markdown']);
    expect(body['markdown']).toBe('Intro paragraph.\n\n## New section\n\nDetails.\n');
  });

  it('does not add a leading blank line to an empty page', async () => {
    const page = makePage({ markdown: '' });
    const { run, mock } = harness({
      [`GET /api/v1/pages/${page.id}`]: { page },
      [`PATCH /api/v1/pages/${page.id}`]: { page },
    });

    await run('tablinum_append_page', { id: page.id, markdown: 'First line.' });

    expect((mock.last().body as Record<string, unknown>)['markdown']).toBe('First line.\n');
  });

  it('keeps indentation inside the appended block', async () => {
    const page = makePage({ markdown: 'Intro.' });
    const { run, mock } = harness({
      [`GET /api/v1/pages/${page.id}`]: { page },
      [`PATCH /api/v1/pages/${page.id}`]: { page },
    });

    await run('tablinum_append_page', { id: page.id, markdown: '\n- one\n  - nested\n' });

    expect((mock.last().body as Record<string, unknown>)['markdown']).toBe(
      'Intro.\n\n- one\n  - nested\n',
    );
  });

  it('rejects whitespace-only markdown before any request', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() =>
      run('tablinum_append_page', { id: newPageId(), markdown: '   \n ' }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_move_page', () => {
  it('patches the path only', async () => {
    const page = makePage();
    const moved = makePage({ id: page.id, path: 'ops/deploy' });
    const { run, mock } = harness({ [`PATCH /api/v1/pages/${page.id}`]: { page: moved } });

    const text = await run('tablinum_move_page', { id: page.id, newPath: 'ops/deploy' });

    expect(mock.last().body).toEqual({ path: 'ops/deploy' });
    expect(text).toContain('Moved page to ops/deploy.');
  });

  it('rejects an invalid target path before any request', async () => {
    const { run, mock } = harness({});
    const error = await expectError(() =>
      run('tablinum_move_page', { id: newPageId(), newPath: 'ops/deploy/' }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(mock.calls).toHaveLength(0);
  });
});

describe('tablinum_delete_page', () => {
  it('deletes a single page without the recursive flag', async () => {
    const page = makePage();
    const { run, mock } = harness({
      [`DELETE /api/v1/pages/${page.id}`]: { deleted: ['eng/deploy'] },
    });

    const text = await run('tablinum_delete_page', { id: page.id });

    expect(mock.last().query).toEqual({});
    expect(text).toContain('Deleted 1 page:');
    expect(text).toContain('- eng/deploy');
  });

  it('passes recursive=true and lists every deleted path', async () => {
    const page = makePage();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`DELETE /api/v1/pages/${page.id}`]: { deleted: ['eng/runbooks', 'eng/runbooks/deploy'] },
    });

    const text = await run('tablinum_delete_page', { path: 'eng/runbooks', recursive: true });

    expect(mock.last().query).toEqual({ recursive: 'true' });
    expect(text).toContain('Deleted 2 pages:');
    expect(text).toContain('- eng/runbooks/deploy');
  });
});

describe('tablinum_page_history', () => {
  it('resolves the page then reads its commits', async () => {
    const page = makePage();
    const { run, mock } = harness({
      'GET /api/v1/pages': { page },
      [`GET /api/v1/pages/${page.id}/history`]: { revisions: [makeRevision()] },
    });

    const text = await run('tablinum_page_history', { path: page.path, limit: 5 });

    expect(mock.last().query).toEqual({ limit: '5' });
    expect(text).toContain('1 revision of eng/deploy');
    expect(text).toContain('a1b2c3d4');
  });

  it('rejects a limit above the API maximum', async () => {
    const { run } = harness({});
    const error = await expectError(() =>
      run('tablinum_page_history', { id: newPageId(), limit: 5000 }),
    );
    expect(error.code).toBe('VALIDATION');
  });
});

describe('tablinum_git_sync', () => {
  const routes = (): Routes => ({
    'POST /api/v1/git/commit': { sha: 'abc1234def5678' },
    'POST /api/v1/git/pull': { status: makeStatus({ behind: 0 }), pulled: 2 },
    'POST /api/v1/git/push': { status: makeStatus(), pushed: true },
  });

  it('commits and pulls, and skips the push by default', async () => {
    const { run, mock } = harness(routes());

    const text = await run('tablinum_git_sync', {});

    expect(mock.calls.map((call) => call.pathname)).toEqual([
      '/api/v1/git/commit',
      '/api/v1/git/pull',
    ]);
    expect(text).toContain('Committed pending edits as abc1234d.');
    expect(text).toContain('Pulled 2 commits from the remote.');
    expect(text).toContain('Skipped the push.');
    expect(text).toContain('branch: main');
  });

  it('pushes when asked', async () => {
    const { run, mock } = harness(routes());

    const text = await run('tablinum_git_sync', { push: true });

    expect(mock.calls.map((call) => call.pathname)).toEqual([
      '/api/v1/git/commit',
      '/api/v1/git/pull',
      '/api/v1/git/push',
    ]);
    expect(text).toContain('Pushed to the remote.');
  });

  it('says when there was nothing to commit and nothing to push', async () => {
    const { run } = harness({
      ...routes(),
      'POST /api/v1/git/commit': { sha: null },
      'POST /api/v1/git/pull': { status: makeStatus(), pulled: 0 },
      'POST /api/v1/git/push': { status: makeStatus(), pushed: false },
    });

    const text = await run('tablinum_git_sync', { push: true });

    expect(text).toContain('No pending edit to commit.');
    expect(text).toContain('Pulled 0 commits from the remote.');
    expect(text).toContain('Nothing to push');
  });

  it('maps a failed push to GIT_ERROR', async () => {
    const { run } = harness({
      ...routes(),
      'POST /api/v1/git/push': reply(502, {
        error: { code: 'GIT_ERROR', message: 'remote rejected the push' },
      }),
    });

    const error = await expectError(() => run('tablinum_git_sync', { push: true }));
    expect(error.code).toBe('GIT_ERROR');
  });
});
